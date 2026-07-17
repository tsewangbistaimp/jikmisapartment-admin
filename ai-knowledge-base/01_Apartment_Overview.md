# Jikmis Apartment — Property Overview

## 1. Business Summary

Jikmis Apartment is a family-run serviced apartment property located in Boudha, Kathmandu, Nepal, within a 5-10 minute walk of the Boudhanath Stupa. The property offers fully furnished studio and family-style apartments for both short-term (nightly) stays and long-term monthly rentals, along with an on-site café.

The website (`apartment.tsewangbista.com`) is a single-page Next.js application that combines property marketing, a direct inquiry/booking form, and a 24/7 AI receptionist chatbot that answers guest questions about rooms, pricing, availability, booking, facilities, rules, and location.

## 2. Property Identity

| Field | Value |
|---|---|
| Property name | Jikmis Apartment |
| Property type | Serviced apartments (studio and family units) + on-site café (Jikmis Café) |
| Location | Boudha, Kathmandu, Nepal |
| Landmark proximity | Approx. 5-10 minutes' walk to Boudhanath Stupa |
| Airport distance | Approx. 5 km from Tribhuvan International Airport, approx. 15-20 minutes by car (traffic-dependent) |
| Google Maps (canonical, used on live booking/contact section) | https://maps.app.goo.gl/aRgUNak3RATee21c8 |
| Google Maps (used inside the AI chatbot's location answer — see note below) | https://maps.app.goo.gl/8GBvpWXkh6NiQihz8?g_st=ic |
| Primary contact | WhatsApp / Call: 9708538395 or 9869035191 |
| Primary email | jikmisdonkhang@gmail.com |
| Total rooms | 5 units: 2 Single Studio Rooms, 2 Double Studio Rooms, 1 2BHK Family Room |
| Stay types | Short-term nightly stays and long-term monthly rentals |
| On-site amenity | Jikmis Café (coffee, tea, cold drinks, bakery items) — open daily |

> **Data discrepancy to flag:** two different Google Maps links appear in the project. The direct-booking "Find Us" section of the homepage and its "Open Google Maps" button use `https://maps.app.goo.gl/aRgUNak3RATee21c8`. The AI chatbot's built-in `locationReply()` function instead cites `https://maps.app.goo.gl/8GBvpWXkh6NiQihz8?g_st=ic`. Both are documented here; the property owner should confirm which one is current and correct the other.

## 3. Target Guests

Based on the site's messaging and the chatbot's stay-type logic, Jikmis Apartment targets:

- Short-stay leisure travelers and pilgrims visiting Boudhanath Stupa
- Long-term/monthly renters (students, remote workers, and families relocating temporarily to Kathmandu)
- Families and small groups needing a multi-bedroom unit (the 2BHK Family Room)
- Guests who want a quiet, home-like stay with a private kitchen rather than a hotel room

*Not found in current project: no explicit "mission statement" or brand values document exists. The description above is drawn directly from the homepage copy and chatbot system prompt, not invented.*

## 4. Property Highlights (as marketed on the website)

Taken verbatim/near-verbatim from the homepage hero and About section:

- "Serviced studios and family apartments with warm interiors, private kitchens, hot water, and direct booking assistance in the heart of Boudha."
- "A quiet serviced apartment designed for comfort in Boudha."
- "Jikmis Apartment offers fully furnished serviced apartments for short stays, long stays, families, students, and guests who want a calm base near Boudhanath Stupa."
- Key stat callouts shown on the homepage: Studio & family rooms, 24/7 hot water, Direct booking help.

## 5. Core Value Propositions

| Highlight | Detail |
|---|---|
| Location | Steps from Boudhanath Stupa, one of the most visited landmarks in Kathmandu |
| Private kitchens | Every room type includes its own kitchen setup |
| Hot water | Available 24/7 across all rooms |
| Direct booking | Guests can book directly via the website form, WhatsApp, or the AI chatbot — no third-party OTA required |
| On-site café | Jikmis Café serves guests and outside visitors daily |
| Flexible stays | Both nightly and monthly (long-term) pricing available for every room type |

## 6. Business Channels

| Channel | Purpose |
|---|---|
| Website booking form (`#contact` / `#booking-form` section) | **Updated** — collects room type, dates, guest count, name, email, phone; creates a real booking in the same database `/admin` reads from (checks live availability, calculates price), emails the team, and opens WhatsApp with a confirmation link. See `12_System_Logic.md`, section 19. |
| Navbar "Book Now" button | Opens a full-screen (on mobile) booking modal with the same form |
| AI chatbot (bottom-right floating widget) | Answers guest questions 24/7; auto-forwards conversation to the team by email + WhatsApp once a guest shares both an email and a phone number in chat |
| WhatsApp | `https://wa.me/9779708538395` — primary real-time booking channel |
| Email | jikmisdonkhang@gmail.com |
| Legacy account system (`/login`, `/register`, `/booking`, `/rooms`, `/admin`) | An older Prisma/Express-backed booking and admin system. Per the project's own README, "the main homepage now focuses on inquiry and AI receptionist behavior, not a booking checkout flow" — these pages are legacy and not part of the guest-facing live booking flow. See `13_Database_Summary.md`, `14_API_Documentation.md`, and `15_Admin_Guide.md` for details. |

## 7. Known Content Inconsistencies (flagged, not resolved)

The following inconsistencies exist in the live project and are documented here for transparency rather than silently corrected:

1. **Contact info mismatch:** the legacy `/about` page lists WhatsApp `+977 9862568506` and email `bookings@jikmis.com`, which differ from the canonical contact info used everywhere else on the live site and in the chatbot (`9708538395` / `9869035191`, `jikmisdonkhang@gmail.com`). The canonical info should be treated as the source of truth.
2. **Google Maps link mismatch:** see section 2 above.
3. **README is outdated:** the project README states the homepage "focuses on inquiry... not a booking checkout flow," but the live homepage's direct-booking form is now a full booking checkout flow — it creates a real, database-backed reservation (see `12_System_Logic.md`, section 19), not just an inquiry email.
4. **Legacy backend claims automatic email is "not set up yet":** `server/src/routes/chatRoutes.js` (the older Express chatbot route) states in its booking instructions that automatic email notification is not yet configured. This is outdated — the live Next.js chat route and booking form (`app/api/chat/route.ts`, `app/page.tsx`) both do send automatic emails via Formspree once a guest provides an email and phone number.

These items are not something the AI Reservations Manager should resolve on its own — they should be flagged to the property owner/administrator for a decision, and guests should always be given the canonical contact details in section 2.
