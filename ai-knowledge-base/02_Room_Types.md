# Jikmis Apartment — Room Types

Jikmis Apartment has **5 total rentable units across 3 room types**: 2 Single Studio Rooms, 2 Double Studio Rooms, and 1 2BHK Family Room. This unit count comes from the AI chatbot's authoritative source-of-truth data (`app/api/chat/route.ts`), which is the most detailed and most recently maintained content in the project. The homepage displays one showcase card per room *type* (not per individual unit).

## 1. Single Studio Room

| Field | Detail |
|---|---|
| Units available | 2 |
| Best for | 1-2 guests (maximum 2 guests) |
| Nightly price | NPR 1,500 |
| Monthly price | NPR 37,000 |
| Bed | Queen bed |
| Bathroom | Private bathroom |
| Kitchen | Private kitchen setup |
| Included furniture | Table and chair |
| Included appliances | Fridge, fan |
| Included items | Utensils |
| Homepage marketing description | "A calm furnished studio with warm wooden floors, private bathroom, and a compact kitchen setup." |
| Homepage-listed amenities | Queen bed, Kitchen setup, Private bathroom, Free WiFi |
| Photos on site | `single-studio-bedroom.jpeg`, `single-studio-kitchen.jpeg` |

## 2. Double Studio Room

| Field | Detail |
|---|---|
| Units available | 2 |
| Best for | 2-3 guests (maximum 3 guests) |
| Nightly price | NPR 2,500 |
| Monthly price | NPR 47,000 |
| Beds | 2 twin beds |
| Bathroom | Private bathroom |
| Kitchen | Private kitchen setup |
| Included furniture | Table, chair, sofa |
| Included appliances | Fridge, fan |
| Included items | Utensils |
| Homepage marketing description | "A bright double studio with generous sleeping space, seating, kitchen area, and hot-water bathroom." |
| Homepage-listed amenities | Twin beds, Seating area, Kitchen setup, 24/7 hot water |
| Photos on site | `double-studio-bedroom.jpeg`, `double-studio-lounge.jpeg`, `double-studio-bathroom.jpeg` |

## 3. 2BHK Family Room

| Field | Detail |
|---|---|
| Units available | 1 |
| Best for | 4-5 guests |
| Nightly price | NPR 4,000 |
| Monthly price | NPR 65,000 |
| Bedrooms | 2 bedrooms, each with a king-size bed |
| Bathrooms | 2 bathrooms |
| Kitchen | Private kitchen |
| Included furniture | Sofa, chair, table, dining area |
| Included appliances | Fridge |
| Homepage marketing description | "A spacious family apartment with separate bedroom areas, lounge space, dining corner, and Boudha light." |
| Homepage-listed amenities | Family layout, Living area, Kitchen setup, Large windows |
| Photos on site | `family-room-bedroom.jpeg`, `family-room-living.jpeg`, `family-room-second-bedroom.jpeg`, `family-room-sunroom.jpeg` |

On the website, the Family Room is displayed under the shorter label **"Family Room"**; the chatbot's source-of-truth data refers to the same unit as the **"2BHK Family Room."** Both names refer to the same single unit.

## 4. Current Live Availability (as coded in the chatbot's source-of-truth data)

> This is dynamic, time-sensitive information hardcoded into `app/api/chat/route.ts` at the time of this analysis. It must be manually updated by the owner/admin whenever availability changes — the AI Reservations Manager should not assume these dates remain accurate indefinitely and should recommend confirming current availability with the property before finalizing any booking.

| Room type | Availability status found in project |
|---|---|
| 2BHK Family Room | Available now |
| Double Studio Room | Available after 12 July |
| Single Studio Room | Available after 8 August |

## 5. Shared Facilities (apply to all room types)

- WiFi
- Hot water (24/7)
- Housekeeping / cleaning twice a week
- Rooftop view
- Motorbike/bike parking
- CCTV
- Self-service laundry (NPR 200 per load, approx. 8-9 kg per load — see `04_Amenities.md`)

## 6. Room Media Notes

The homepage's video tour section (`apartmentVideos` array) shows three video clips, but the `title`/`roomTitle` labels attached to each clip's `src` and `poster` do not consistently line up with each other in the source code — for example, one entry's poster image is the Single Studio bedroom photo, but its caption reads "Family / 2BHK" and its "Book" button is wired to the Family Room. This appears to be a data-entry mismatch in the codebase rather than an intentional design choice, and should be flagged to the developer/owner for correction. It does not affect the factual room information documented above, which comes from the `roomShowcase` and chatbot source-of-truth arrays, not the video captions.

## 7. Room Data Not Found in Current Project

- Exact square footage / floor area per room: **Not found in current project.**
- Floor/unit numbers or building layout: **Not found in current project.**
- Individual room availability calendars beyond the three date lines in section 4: **Not found in current project.**
- View descriptions beyond "Boudha light" (Family Room) and "rooftop view" (shared amenity): **Not found in current project.**
