export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

// USER: guest self-service account. ADMIN: Owner/Admin (full access).
// RECEPTION: Reception Staff (front-desk operations, no rooms/pricing/staff/
// settings access) — see server/src/middleware/auth.js.
export type Role = "USER" | "ADMIN" | "RECEPTION";

export type StaffUser = {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  role: Role;
  isActive: boolean;
  createdAt: string;
};

export type Room = {
  id: string;
  title: string;
  type: "STUDIO" | "SINGLE" | "DOUBLE" | "FAMILY";
  pricePerNight: number;
  pricePerMonth: number;
  description: string;
  facilities: string[];
  rules: string[];
  images: string[];
  isAvailable: boolean;
  maxGuests: number;
  totalUnits: number;
};

// Hospitality-style lifecycle: PENDING -> CONFIRMED (staff verified the
// advance payment) -> CHECKED_IN -> CHECKED_OUT, or CANCELLED at any point.
export type BookingStatus = "PENDING" | "CONFIRMED" | "CHECKED_IN" | "CHECKED_OUT" | "CANCELLED";

export const BOOKING_STATUSES: BookingStatus[] = ["PENDING", "CONFIRMED", "CHECKED_IN", "CHECKED_OUT", "CANCELLED"];

// advance/remaining mirror the 50/50 policy in 05_Booking_Policies.md;
// "other" covers anything else (a correction, a discount adjustment, etc.).
export type PaymentType = "advance" | "remaining" | "other";

// One itemized row from the Payment ledger (payment management's "Payment
// history") — see server/src/controllers/bookingController.js's
// listPayments/recordPayment.
export type Payment = {
  id: string;
  amount: number;
  method?: string | null;
  type: PaymentType;
  note?: string | null;
  recordedAt: string;
  recordedByUser?: { id: string; name: string } | null;
};

export type Invoice = {
  id: string;
  invoiceNumber: string;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  accessToken?: string | null;
  issuedAt: string;
};

export type PaymentStatus = "unpaid" | "partially_paid" | "fully_paid";

// Full sanitized shape returned by the PUBLIC GET /invoices/:token endpoint
// (server/src/controllers/invoiceController.js) — used by the printable
// invoice page, app/invoice/[token]/page.tsx.
export type PublicInvoice = {
  apartmentName: string;
  invoiceNumber: string;
  issuedAt: string;
  guest: { name: string; email?: string | null; phone?: string | null };
  room: { title: string; type: Room["type"]; pricePerNight: number };
  checkIn: string;
  checkOut: string;
  guestCount: number;
  totalAmount: number;
  subtotal: number;
  taxAmount: number;
  amountPaid: number;
  remaining: number;
  paymentStatus: PaymentStatus;
  bookingStatus: BookingStatus;
  payments: Array<{ id: string; amount: number; method?: string | null; type: PaymentType; recordedAt: string }>;
};

// GET /admin/analytics response shape (server/src/controllers/adminController.js's
// analytics()) — powers app/admin/analytics/page.tsx. Owner-only, same gate
// as GET /admin/dashboard.
export type RevenueTrendPoint = { month: string; label: string; revenue: number };

export type BookingSourceCount = { channel: string; count: number };

export type AnalyticsData = {
  totalBookings: number;
  todaysCheckIns: number;
  todaysCheckOuts: number;
  occupiedRooms: number;
  availableRooms: number;
  totalRoomUnits: number;
  monthlyRevenue: number;
  revenueTrend: RevenueTrendPoint[];
  pendingPayments: { amount: number; count: number };
  bookingSources: BookingSourceCount[];
};

export type Booking = {
  id: string;
  checkIn: string;
  checkOut: string;
  totalPrice: number;
  amountPaid: number;
  paymentMethod?: string | null;
  status: BookingStatus;
  guestCount: number;
  channel: string;
  guestName?: string | null;
  guestPhone?: string | null;
  guestWhatsapp?: string | null;
  guestEmail?: string | null;
  specialRequests?: string | null;
  room: Room;
  user?: { name: string; email: string; phone?: string } | null;
  // Present once an invoice has been generated (auto on CONFIRMED, or
  // on-demand via payment management's "generate invoice" action) — see
  // getOrCreateInvoice() in bookingController.js. Absent/null otherwise.
  invoice?: Invoice | null;
};

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = typeof window !== "undefined" ? localStorage.getItem("jikmis_token") : null;
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers
    },
    cache: "no-store"
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(data.message || "Request failed.");
  return data;
}

export function currency(value: number) {
  return new Intl.NumberFormat("en-NP", {
    style: "currency",
    currency: "NPR",
    maximumFractionDigits: 0
  }).format(value);
}
