# Jikmis Apartment — Booking Policies

Source: `app/api/chat/route.ts` (SYSTEM_PROMPT "Booking and payment" section and the rule-based fallback logic), cross-checked against the live homepage booking form.

## 1. Information Required to Make a Booking Inquiry

To process a booking inquiry, the following must be collected from the guest:

1. Room type
2. Check-in date
3. Check-out date
4. Number of guests
5. Full name
6. Phone number
7. Email address
8. ID / citizenship / passport (for check-in — see `07_Checkin_Checkout.md`)
9. Payment method preference

After these details are collected, the AI should present a clean, organized booking inquiry summary back to the guest before proceeding.

> Note: the website's live booking form (`app/page.tsx`) collects Room Type, Guests, Check-in, Check-out, Full Name, Email, and Phone — it does not itself capture ID/passport or payment method (those are collected conversationally through the chatbot or by staff after the initial inquiry).

## 2. Advance Payment Requirement

- **50% advance payment is required to confirm a booking.**
- The **remaining 50% must be paid within 2 days of check-in.**
- Guests **cannot reserve a room without payment** — an inquiry alone does not hold a room.

## 3. Accepted Payment Methods

- Cash
- Bank transfer
- eSewa
- Khalti

## 4. Payment Handling Rules (for the AI Reservations Manager)

- **Never accept payment inside the chat.** The AI must never process, request card numbers for, or claim to have received a payment through the chat interface.
- After a guest completes payment through one of the approved methods, ask them to send a payment screenshot via WhatsApp.
- Viewing/inspection of a room is allowed if the room is available, but this does not replace the payment/confirmation process for an actual booking.

## 5. Automatic Notification Behavior

Once a guest shares **both** their email address and phone number during a chat conversation, the website automatically:
1. Emails the full conversation transcript to the property's team (jikmisdonkhang@gmail.com) via Formspree, and
2. Opens a WhatsApp chat pre-filled with the guest's email, phone number, and the conversation transcript.

Because of this, the AI should **actively and naturally ask for the guest's email and phone number** as part of collecting booking details — this is what triggers the automatic hand-off to the human team.

The direct booking form on the homepage follows the same dual-channel notification pattern — the team still gets an email (via Formspree) and the guest still gets a pre-filled WhatsApp confirmation link — but it's no longer just an inquiry: submitting the form now creates a real, database-backed booking (validated dates, checked availability, calculated price) exactly like the AI chat booking flow does, not only an email/WhatsApp hand-off for staff to manually action. See `12_System_Logic.md`, section 19.

## 6. Booking Modification Policy

**Not found in current project.** No explicit modification policy (e.g., how to change dates or room type on an existing confirmed booking) is defined anywhere in the codebase. Guests asking about modifications should be directed to contact the team directly via WhatsApp, call, or email.

## 7. Cancellation & Refund Policy

The project's only stated line on this topic is: **"Cancellation/refund depends on booking conditions and will be shared during reservation."**

There is **no concrete cancellation window, refund percentage, or fee schedule found anywhere in the project.** The AI must not invent one. When asked about cancellation or refunds, the correct answer is that the policy depends on the specific booking conditions and will be shared at the time of reservation, and the guest should contact the team directly for specifics:

> "Please WhatsApp or call 9708538395 / 9869035191, or email jikmisdonkhang@gmail.com."

## 8. No-Show Policy

**Not found in current project.** No no-show policy, forfeiture rule, or grace period is defined.

## 9. Confirmation Process Summary

1. Guest inquires (via chatbot, WhatsApp, or the website booking form).
2. AI/staff collects the required details (section 1).
3. AI presents a summary of the inquiry.
4. Guest is instructed that 50% advance payment is required to confirm.
5. Guest pays via cash, bank transfer, eSewa, or Khalti (never inside the chat).
6. Guest sends a payment screenshot via WhatsApp.
7. Remaining 50% is due within 2 days of check-in.
8. Guest checks in with valid ID/citizenship/passport (see `07_Checkin_Checkout.md`).

## 10. Security Deposit

No security deposit is currently required, unless the guest is otherwise informed by staff at time of booking.

## 11. Availability Confirmation Rule

The AI must only use the specific current-availability data documented in `02_Room_Types.md` (section 4). It must **never invent different availability dates** and must never guarantee final availability without staff confirmation — availability shown by the AI is provisional until confirmed by a human.
