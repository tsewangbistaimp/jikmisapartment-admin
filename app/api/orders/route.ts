import { google } from "googleapis";
import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { isWithinRateLimit, rateLimitedResponse } from "@/lib/rateLimit";

export const runtime = "nodejs";

type OrderPayload = {
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  orderType?: string;
  product?: string;
  quantity?: string;
  notes?: string;
};

const requiredEnv = [
  "GOOGLE_SHEET_ID",
  "GOOGLE_SHEET_TAB_NAME",
  "GOOGLE_CLIENT_EMAIL",
  "GOOGLE_PRIVATE_KEY",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASS",
  "SMTP_USER",
  "ORDER_NOTIFICATION_EMAIL",
  "CUSTOMER_EMAIL_FROM",
  "CUSTOMER_REPLY_TO"
] as const;

function cleanValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function getMissingEnv() {
  return requiredEnv.filter((key) => !process.env[key]);
}

function formatPrivateKey(privateKey: string) {
  return privateKey.replace(/^"|"$/g, "").replace(/\\n/g, "\n");
}

function sheetRange(tabName: string, range: string) {
  return `'${tabName.replace(/'/g, "''")}'!${range}`;
}

async function appendOrderToSheet(order: Required<OrderPayload>, orderId: string) {
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_CLIENT_EMAIL,
    key: formatPrivateKey(process.env.GOOGLE_PRIVATE_KEY || ""),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });

  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const tabName = process.env.GOOGLE_SHEET_TAB_NAME || "Sheet1";
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const hasSheet = spreadsheet.data.sheets?.some(
    (sheet) => sheet.properties?.title === tabName
  );

  if (!hasSheet) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: tabName
              }
            }
          }
        ]
      }
    });
  }

  const headerResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: sheetRange(tabName, "A1:J1")
  });

  if (!headerResponse.data.values?.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: sheetRange(tabName, "A1:J1"),
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [
          [
            "Submitted At",
            "Order ID",
            "Customer Name",
            "Customer Email",
            "Customer Phone",
            "Order Type",
            "Product / Service",
            "Quantity / Budget",
            "Notes",
            "Status"
          ]
        ]
      }
    });
  }

  const values = [
    [
      new Date().toISOString(),
      orderId,
      order.customerName,
      order.customerEmail,
      order.customerPhone,
      order.orderType,
      order.product,
      order.quantity,
      order.notes,
      "Received"
    ]
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: sheetRange(tabName, "A:J"),
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values }
  });
}

async function sendOrderEmails(order: Required<OrderPayload>, orderId: string) {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS?.replace(/\s/g, "")
    }
  });

  const orderLines = `
Order ID: ${orderId}
Customer: ${order.customerName}
Email: ${order.customerEmail}
Phone: ${order.customerPhone}
Type: ${order.orderType}
Product / Service: ${order.product}
Quantity / Budget: ${order.quantity}
Notes: ${order.notes}
`;

  await transporter.sendMail({
    from: process.env.CUSTOMER_EMAIL_FROM,
    to: process.env.ORDER_NOTIFICATION_EMAIL,
    replyTo: order.customerEmail,
    subject: `New order received: ${order.orderType} (${orderId})`,
    text: `A new order was submitted from the portfolio website.\n\n${orderLines}`
  });

  await transporter.sendMail({
    from: process.env.CUSTOMER_EMAIL_FROM,
    to: order.customerEmail,
    replyTo: process.env.CUSTOMER_REPLY_TO,
    subject: `Order received - ${orderId}`,
    text: `Hi ${order.customerName},\n\nThank you. Your order has been received and Tsewang Bista will contact you soon.\n\n${orderLines}\n\nTsewangBistaX\nTechnology, Business & Innovation`
  });
}

export async function POST(request: Request) {
  // Public, unauthenticated endpoint that, on success, sends TWO real
  // outbound emails per request — one of them (the customer confirmation) to
  // an address the caller fully controls, with caller-controlled content in
  // the body — see lib/rateLimit.ts's header comment. Without a limit this
  // is a mail-relay abuse vector (spamming/email-bombing an arbitrary
  // address using this site's SMTP reputation). 10/hour per IP mirrors the
  // equivalent register-endpoint limiter on the Express side
  // (server/src/routes/authRoutes.js).
  if (!isWithinRateLimit(request, "orders", { windowMs: 60 * 60 * 1000, max: 10 })) {
    return rateLimitedResponse("Too many order submissions from this connection. Please try again later.");
  }

  try {
    const missingEnv = getMissingEnv();
    if (missingEnv.length > 0) {
      // Log the specific missing variable NAMES server-side only — the
      // previous version echoed this list directly to any unauthenticated
      // caller, which is free reconnaissance of this deployment's internal
      // configuration for no guest-facing benefit.
      console.error(`[api/orders] Missing required environment variable(s): ${missingEnv.join(", ")}`);
      return NextResponse.json(
        { message: "Order system is temporarily unavailable. Please try again later or contact us directly." },
        { status: 500 }
      );
    }

    const body = (await request.json()) as OrderPayload;
    const order = {
      customerName: cleanValue(body.customerName),
      customerEmail: cleanValue(body.customerEmail),
      customerPhone: cleanValue(body.customerPhone),
      orderType: cleanValue(body.orderType),
      product: cleanValue(body.product),
      quantity: cleanValue(body.quantity),
      notes: cleanValue(body.notes)
    };

    const missingFields = Object.entries(order)
      .filter(([, value]) => !value)
      .map(([key]) => key);

    if (missingFields.length > 0) {
      return NextResponse.json(
        { message: `Please complete all required fields: ${missingFields.join(", ")}` },
        { status: 400 }
      );
    }

    const orderId = `TBX-${Date.now()}`;
    await appendOrderToSheet(order, orderId);
    await sendOrderEmails(order, orderId);

    return NextResponse.json({
      message: `Order received. Your confirmation email has been sent. Order ID: ${orderId}`
    });
  } catch (error) {
    console.error("Order submission failed", error);
    return NextResponse.json(
      { message: "Order could not be submitted. Please try again or contact us on WhatsApp." },
      { status: 500 }
    );
  }
}
