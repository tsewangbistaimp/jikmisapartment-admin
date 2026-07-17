# Jikmis Apartment — Check-in / Check-out

Source: `app/api/chat/route.ts`, "House rules and policies" section.

## 1. Standard Times

| Event | Time |
|---|---|
| Check-in | From 2:00 PM onwards |
| Check-out | Before 12:00 PM (noon) |

## 2. Early Check-in / Late Check-out

Early check-in and late check-out are **subject to room availability.** Guests should contact the property in advance to request either. The AI must never guarantee early check-in or late check-out — it should explain that these depend on availability and confirmation from staff.

## 3. Required Documents at Check-in

All guests must present one of the following, as required by Nepal regulations:

- Valid government-issued ID, **or**
- Citizenship certificate, **or**
- Passport

## 4. Self Check-in

**Not found in current project.** No self-check-in process (e.g., lockbox, keypad code sent in advance) is documented. The project does state that guests can enter "at any time using the access information provided after check-in," which implies access details are shared after an in-person or staff-assisted check-in, but no fully unattended/self-check-in workflow is described.

## 5. Late-Night Arrival

Guests may enter at any time using the access information provided to them after check-in, but are asked to enter quietly, respecting quiet hours (10:00 PM – 7:00 AM).

## 6. Process Summary

1. Guest arrives from 2:00 PM onward on the confirmed check-in date.
2. Guest presents valid ID/citizenship/passport.
3. Guest completes any outstanding payment steps per `05_Booking_Policies.md` (remaining 50% due within 2 days of check-in, if not already paid).
4. Access information is provided to the guest for the duration of the stay.
5. Guest checks out before 12:00 PM (noon) on the confirmed check-out date.

## 7. Not Found in Current Project

- A formal check-in desk location or reception hours
- Luggage storage before check-in / after check-out
- A specific early check-in or late check-out fee
- Key/access method details (physical key vs. keypad vs. app-based access)
