"use client";

import { useEffect, useState } from "react";
import { api, Booking, currency, Payment, PaymentType } from "@/lib/api";

// Shared "payment management" panel — used inside both app/admin/page.tsx's
// booking cards and app/admin/calendar/page.tsx's booking detail modal (see
// components/ApartmentChatbot.tsx for the project's existing precedent of a
// shared component under /components). Covers: recording an advance
// payment, recording the remaining balance, itemized payment history,
// payment method, and generating/downloading/sending the invoice.
//
// Deliberately additive alongside each page's existing simple "set total
// paid amount" input (PATCH /bookings/:id/payment, unchanged) rather than
// replacing it — this panel's POST /bookings/:id/payments endpoint is
// incremental ("record what just came in"), which is the more natural way
// staff described this feature, but the older absolute-correction path
// still has its own valid use case (fixing a data-entry mistake) and stays
// exactly as it was.

const PAYMENT_TYPE_LABELS: Record<PaymentType, string> = {
  advance: "Advance",
  remaining: "Remaining balance",
  other: "Other"
};

const PAYMENT_METHODS = ["cash", "bank_transfer", "esewa", "khalti"] as const;

type FormKind = "advance" | "remaining" | "other" | null;

export default function PaymentInvoicePanel({
  booking,
  onUpdated
}: {
  booking: Booking;
  onUpdated: (booking: Booking) => void;
}) {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [historyError, setHistoryError] = useState("");

  const [formKind, setFormKind] = useState<FormKind>(null);
  const [amountDraft, setAmountDraft] = useState("");
  const [methodDraft, setMethodDraft] = useState<string>("cash");
  const [noteDraft, setNoteDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const [invoiceBusy, setInvoiceBusy] = useState(false);
  const [invoiceMessage, setInvoiceMessage] = useState("");

  const remaining = Math.max(0, booking.totalPrice - booking.amountPaid);
  const guestEmail = booking.user?.email || booking.guestEmail || null;

  async function loadHistory() {
    setLoadingHistory(true);
    try {
      const data = await api<{ payments: Payment[] }>(`/bookings/${booking.id}/payments`);
      setPayments(data.payments);
      setHistoryError("");
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : "Could not load payment history.");
    } finally {
      setLoadingHistory(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
    void loadHistory();
  }, [booking.id]);

  function openForm(kind: "advance" | "remaining" | "other") {
    setFormError("");
    setFormKind(kind);
    setMethodDraft("cash");
    setNoteDraft("");
    if (kind === "remaining") {
      setAmountDraft(String(remaining));
    } else if (kind === "advance") {
      // Suggested advance per the 50% policy (05_Booking_Policies.md), never
      // more than what's actually still owed.
      const suggested = Math.min(remaining, Math.max(0, Math.round(booking.totalPrice * 0.5) - booking.amountPaid) || remaining);
      setAmountDraft(String(suggested || remaining));
    } else {
      setAmountDraft("");
    }
  }

  function closeForm() {
    setFormKind(null);
    setFormError("");
  }

  async function submitPayment(event: React.FormEvent) {
    event.preventDefault();
    if (!formKind) return;
    const amount = Number(amountDraft);
    if (!Number.isFinite(amount) || amount <= 0) {
      setFormError("Enter a valid amount greater than zero.");
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      const result = await api<{ booking: Booking; payment: Payment }>(`/bookings/${booking.id}/payments`, {
        method: "POST",
        body: JSON.stringify({ amount, method: methodDraft, type: formKind, note: noteDraft || undefined })
      });
      onUpdated(result.booking);
      setFormKind(null);
      void loadHistory();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not record this payment.");
    } finally {
      setSaving(false);
    }
  }

  async function openInvoice() {
    setInvoiceBusy(true);
    setInvoiceMessage("");
    try {
      let token = booking.invoice?.accessToken;
      if (!token) {
        const data = await api<{ invoice: { accessToken: string } }>(`/bookings/${booking.id}/invoice`);
        token = data.invoice.accessToken;
      }
      window.open(`${window.location.origin}/invoice/${token}`, "_blank", "noreferrer");
    } catch (err) {
      setInvoiceMessage(err instanceof Error ? err.message : "Could not generate the invoice.");
    } finally {
      setInvoiceBusy(false);
    }
  }

  async function sendInvoice() {
    setInvoiceBusy(true);
    setInvoiceMessage("");
    try {
      const result = await api<{ sent: boolean; reason: string | null }>(`/bookings/${booking.id}/invoice/send`, { method: "POST" });
      if (result.sent) {
        setInvoiceMessage("Invoice emailed to the guest.");
      } else if (result.reason === "not_configured") {
        setInvoiceMessage("Email isn't configured on this server (SMTP settings) — the invoice was not sent.");
      } else {
        setInvoiceMessage("Could not send the invoice email.");
      }
    } catch (err) {
      setInvoiceMessage(err instanceof Error ? err.message : "Could not send the invoice.");
    } finally {
      setInvoiceBusy(false);
    }
  }

  return (
    <div className="payment-invoice-panel">
      <div className="pip-summary">
        <div><span className="muted">Total</span><strong>{currency(booking.totalPrice)}</strong></div>
        <div><span className="muted">Paid</span><strong>{currency(booking.amountPaid)}</strong></div>
        <div><span className="muted">Remaining</span><strong>{currency(remaining)}</strong></div>
      </div>

      <div className="status-actions pip-quick-actions">
        <button type="button" className="small-button" onClick={() => openForm("advance")} disabled={remaining <= 0}>Record advance payment</button>
        <button type="button" className="small-button" onClick={() => openForm("remaining")} disabled={remaining <= 0}>Record remaining balance</button>
        <button type="button" className="small-button" onClick={() => openForm("other")}>Record other payment</button>
      </div>
      {remaining <= 0 && <p className="muted" style={{ marginTop: 6 }}>This booking is fully paid.</p>}

      {formKind && (
        <form className="form-grid pip-payment-form" onSubmit={submitPayment}>
          <p className="muted" style={{ margin: 0 }}>{PAYMENT_TYPE_LABELS[formKind]}</p>
          {formError && <p className="message error">{formError}</p>}
          <label>Amount<input type="number" min="1" max={remaining || undefined} value={amountDraft} onChange={(e) => setAmountDraft(e.target.value)} required /></label>
          <label>Payment method<select value={methodDraft} onChange={(e) => setMethodDraft(e.target.value)}>
            {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m.replace("_", " ")}</option>)}
          </select></label>
          <label>Note (optional)<input value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} /></label>
          <div className="status-actions">
            <button type="submit" className="button primary" disabled={saving}>Save payment</button>
            <button type="button" className="button secondary" onClick={closeForm}>Cancel</button>
          </div>
        </form>
      )}

      <div className="pip-history">
        <h4>Payment history</h4>
        {loadingHistory && <p className="muted">Loading…</p>}
        {historyError && <p className="message error">{historyError}</p>}
        {!loadingHistory && payments.length === 0 && <p className="muted">No payments recorded yet.</p>}
        {payments.length > 0 && (
          <div className="table pip-history-list">
            {payments.map((payment) => (
              <div className="pip-history-row" key={payment.id}>
                <span>{new Date(payment.recordedAt).toLocaleDateString()}</span>
                <span>{PAYMENT_TYPE_LABELS[payment.type]}</span>
                <span className="muted">{payment.method ? payment.method.replace("_", " ") : "-"}</span>
                <strong>{currency(payment.amount)}</strong>
                {payment.recordedByUser && <span className="muted">by {payment.recordedByUser.name}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="pip-invoice">
        <h4>Invoice</h4>
        {invoiceMessage && <p className="message">{invoiceMessage}</p>}
        <div className="status-actions">
          <button type="button" className="button secondary" onClick={() => void openInvoice()} disabled={invoiceBusy}>
            View / download invoice (PDF)
          </button>
          <button type="button" className="button secondary" onClick={() => void sendInvoice()} disabled={invoiceBusy || !guestEmail} title={!guestEmail ? "This guest has no email on file" : undefined}>
            Send invoice to guest
          </button>
        </div>
        {!guestEmail && <p className="muted" style={{ marginTop: 6 }}>No email on file for this guest — &quot;Send invoice to guest&quot; is unavailable, but the invoice can still be downloaded above.</p>}
      </div>
    </div>
  );
}
