"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, currency, PublicInvoice } from "@/lib/api";

// Public, unauthenticated page — the accessToken in the URL is the security
// boundary (see server/src/controllers/invoiceController.js). This page IS
// the "Generate invoice PDF" / "Download invoice" feature: no PDF-generation
// library is installable in this project's sandbox (confirmed again while
// building payment management — a real `npm install` still fails with the
// same pre-existing ENOTEMPTY error), so rather than silently skip the
// feature or claim something that doesn't work, this renders a clean,
// print-optimized invoice and uses the browser's own native "Print > Save
// as PDF" as the actual PDF mechanism. See 15_Admin_Guide.md's payment
// management section for the staff-facing explanation.

const STATUS_LABELS: Record<string, string> = {
  unpaid: "Unpaid",
  partially_paid: "Partially paid",
  fully_paid: "Fully paid"
};

const PAYMENT_TYPE_LABELS: Record<string, string> = {
  advance: "Advance",
  remaining: "Remaining balance",
  other: "Payment"
};

export default function InvoicePage({ params }: { params: { token: string } }) {
  const [invoice, setInvoice] = useState<PublicInvoice | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<PublicInvoice>(`/invoices/${params.token}`)
      .then(setInvoice)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load this invoice."))
      .finally(() => setLoading(false));
  }, [params.token]);

  if (loading) {
    return (
      <main className="invoice-shell">
        <p className="muted">Loading invoice…</p>
      </main>
    );
  }

  if (error || !invoice) {
    return (
      <main className="invoice-shell">
        <p className="message error">{error || "Invoice not found."}</p>
        <Link className="text-link" href="/">Return to Jikmis Apartment</Link>
      </main>
    );
  }

  const nights = Math.max(
    1,
    Math.round((new Date(invoice.checkOut).getTime() - new Date(invoice.checkIn).getTime()) / 86400000)
  );

  return (
    <main className="invoice-shell">
      <div className="invoice-toolbar no-print">
        <Link className="text-link" href="/">&larr; Jikmis Apartment</Link>
        <button type="button" className="button primary" onClick={() => window.print()}>
          Print / Save as PDF
        </button>
      </div>
      <p className="muted no-print" style={{ marginBottom: 20 }}>
        Use your browser&apos;s print dialog and choose &quot;Save as PDF&quot; (or &quot;Microsoft Print to PDF&quot;) as the destination to download this invoice.
      </p>

      <div className="invoice-paper">
        <header className="invoice-header">
          <div>
            <h1 className="invoice-brand">{invoice.apartmentName}</h1>
            <p className="muted">Boudha, Kathmandu, Nepal</p>
          </div>
          <div className="invoice-meta">
            <p><strong>Invoice</strong> {invoice.invoiceNumber}</p>
            <p className="muted">Issued {new Date(invoice.issuedAt).toLocaleDateString()}</p>
            <span className={`invoice-status-badge status-${invoice.paymentStatus}`}>
              {STATUS_LABELS[invoice.paymentStatus] || invoice.paymentStatus}
            </span>
          </div>
        </header>

        <div className="invoice-grid">
          <div>
            <h3>Billed to</h3>
            <p>{invoice.guest.name}</p>
            {invoice.guest.phone && <p className="muted">{invoice.guest.phone}</p>}
            {invoice.guest.email && <p className="muted">{invoice.guest.email}</p>}
          </div>
          <div>
            <h3>Room</h3>
            <p>{invoice.room.title} ({invoice.room.type})</p>
            <p className="muted">{currency(invoice.room.pricePerNight)} / night</p>
          </div>
          <div>
            <h3>Stay dates</h3>
            <p>{new Date(invoice.checkIn).toLocaleDateString()} to {new Date(invoice.checkOut).toLocaleDateString()}</p>
            <p className="muted">{nights} night{nights === 1 ? "" : "s"} - {invoice.guestCount} guest{invoice.guestCount === 1 ? "" : "s"}</p>
          </div>
        </div>

        <table className="invoice-amounts-table">
          <tbody>
            <tr><td>Subtotal</td><td>{currency(invoice.subtotal)}</td></tr>
            <tr><td>Tax</td><td>{currency(invoice.taxAmount)}</td></tr>
            <tr className="invoice-total-row"><td>Total amount</td><td>{currency(invoice.totalAmount)}</td></tr>
            <tr><td>Paid amount</td><td>{currency(invoice.amountPaid)}</td></tr>
            <tr className="invoice-remaining-row"><td>Remaining amount</td><td>{currency(invoice.remaining)}</td></tr>
          </tbody>
        </table>

        {invoice.payments.length > 0 && (
          <div className="invoice-payment-history">
            <h3>Payment history</h3>
            <table className="invoice-history-table">
              <thead>
                <tr><th>Date</th><th>Type</th><th>Method</th><th>Amount</th></tr>
              </thead>
              <tbody>
                {invoice.payments.map((payment) => (
                  <tr key={payment.id}>
                    <td>{new Date(payment.recordedAt).toLocaleDateString()}</td>
                    <td>{PAYMENT_TYPE_LABELS[payment.type] || payment.type}</td>
                    <td className="muted">{payment.method || "-"}</td>
                    <td>{currency(payment.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <footer className="invoice-footer">
          <p>Thank you for staying with Jikmis Apartment.</p>
          <p className="muted">WhatsApp/Call: 9708538395 / 9869035191 - Email: jikmisdonkhang@gmail.com</p>
        </footer>
      </div>
    </main>
  );
}
