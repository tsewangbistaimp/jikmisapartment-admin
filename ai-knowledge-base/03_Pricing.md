# Jikmis Apartment — Pricing

All pricing below is sourced from the AI chatbot's source-of-truth data (`app/api/chat/route.ts`), cross-checked against the homepage room showcase (`app/page.tsx`), which lists identical figures.

## 1. Nightly (Daily) Pricing

| Room Type | Price per Night |
|---|---|
| Single Studio Room | NPR 1,500 |
| Double Studio Room | NPR 2,500 |
| 2BHK Family Room | NPR 4,000 |

**Daily/nightly prices are not negotiable.** This is an explicit rule in the project's chatbot instructions — the AI should never offer a discount on nightly rates.

## 2. Monthly (Long-Term) Pricing

| Room Type | Standard Monthly Price |
|---|---|
| Single Studio Room | NPR 37,000 |
| Double Studio Room | NPR 47,000 |
| 2BHK Family Room | NPR 65,000 |

## 3. Monthly Negotiation Rules

Monthly rates *may* be negotiable, but **only with staff/owner approval** and only under these specific guest-count conditions found in the project:

| Room Type | Max Guests for Negotiation | Negotiation Condition | Negotiated Rate |
|---|---|---|---|
| Single Studio | 2 | If 1 guest only | NPR 37,000 → NPR 35,000 |
| Double Studio | 3 | If fewer than 3 guests | NPR 47,000 → NPR 45,000 |
| 2BHK Family Room | 4 | If 2-3 guests | NPR 65,000 → NPR 60,000 |
| 2BHK Family Room | 4 | If 1 guest | NPR 65,000 → NPR 55,000 |

Rules for the AI Reservations Manager when discussing negotiation:
- Never confirm a negotiated rate as final — always state that final approval must come from staff or the owner.
- Never negotiate nightly/daily prices under any circumstance.
- Only offer the negotiated monthly figures above when the guest's stated guest count matches the condition.

## 4. Weekly Pricing

**Not found in current project.** No weekly rate is defined anywhere in the codebase — only nightly and monthly rates exist. If a guest asks for a weekly rate, the AI should not invent one; it should offer the nightly rate multiplied by the number of nights, or suggest the monthly rate if the stay is close to a month, and offer to have staff confirm.

## 5. Seasonal / Peak Pricing

**Not found in current project.** There is no seasonal pricing table, peak-season multiplier, or holiday surcharge anywhere in the codebase.

## 6. Extra Guest Charges

**Not found in current project.** No per-extra-guest fee is defined. Guest-count limits exist per room (see `02_Room_Types.md`), but there is no stated surcharge for additional guests within or beyond that limit — this should be confirmed with staff if asked.

## 7. Taxes / Service Charges

**Not found in current project.** No tax, VAT, or service charge is mentioned anywhere in the codebase or on the website. The listed nightly/monthly prices should be treated as the only prices found, with no confirmed additional tax line.

## 8. Discounts (Non-Monthly)

Beyond the monthly negotiation rules in section 3, **no other discount program (e.g., long-stay discount tiers, promo codes, referral discounts) is found in the current project.**

## 9. Additional Charged Services

| Service | Price |
|---|---|
| Laundry (self-service washing machine) | NPR 200 per load (approx. 8-9 kg per load) |

Laundry is **not included** in the room rate — it is confirmed as a separately charged service in the chatbot's rule set.

## 10. Deposit

The project states: "No security deposit is currently required unless otherwise informed." This should be relayed to guests as-is — there is no fixed deposit amount defined anywhere in the project.

## 11. Payment Requirement Summary

See `05_Booking_Policies.md` for the full advance-payment and payment-method policy (50% advance, remaining 50% within 2 days of check-in, accepted via cash, bank transfer, eSewa, or Khalti).
