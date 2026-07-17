import { NextResponse } from "next/server";
import { createDirectBooking, type DirectBookingInput } from "@/lib/bookingAssistant";
import { isWithinRateLimit, rateLimitedResponse } from "@/lib/rateLimit";

// Public, unauthenticated booking endpoint for the homepage "Book Now" form
// (app/page.tsx) — the single-shot counterpart to the AI chat's
// conversational booking flow (POST /api/chat). Both ultimately call the
// same Prisma client (lib/prisma.ts) against the same database the Express
// admin API and /admin dashboard read from, so a booking made here shows up
// in /admin and /admin/calendar immediately. See createDirectBooking() in
// lib/bookingAssistant.ts for the actual validate -> check availability ->
// calculate price -> create booking -> send confirmation steps; this route
// is just the thin HTTP wrapper around it (step 6, "show a success
// message," is the caller's job — see app/page.tsx's handleBookingSubmit).

function badRequest(message: string) {
  return NextResponse.json({ message }, { status: 400 });
}

export async function POST(request: Request) {
  // Public, unauthenticated endpoint that writes a real Booking row per
  // request — see lib/rateLimit.ts's header comment. 10/hour per IP is
  // generous for genuine guests (who book once, maybe twice for a group)
  // while blocking a script from spamming junk PENDING bookings across every
  // available date (a "deny real guests the inventory" attack against a
  // small property with very few units).
  if (!isWithinRateLimit(request, "bookings", { windowMs: 60 * 60 * 1000, max: 10 })) {
    return rateLimitedResponse("Too many booking requests from this connection. Please contact us directly, or try again later.");
  }

  let body: Partial<DirectBookingInput>;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid request body.");
  }

  const { roomId, checkIn, checkOut, guests, fullName, phone, whatsapp, email, specialRequests } = body;

  if (!roomId || !checkIn || !checkOut || guests === undefined || guests === null || !fullName || !phone || !email) {
    return badRequest("Please fill in every required field: room, dates, guests, name, phone, and email.");
  }

  const result = await createDirectBooking({
    roomId: String(roomId),
    checkIn: String(checkIn),
    checkOut: String(checkOut),
    guests: Number(guests),
    fullName: String(fullName),
    phone: String(phone),
    whatsapp: whatsapp ? String(whatsapp) : undefined,
    email: String(email),
    specialRequests: specialRequests ? String(specialRequests) : undefined
  });

  if (!result.ok) {
    return NextResponse.json({ message: result.message }, { status: result.status });
  }

  return NextResponse.json(
    {
      bookingId: result.bookingId,
      whatsappUrl: result.whatsappUrl,
      roomTitle: result.roomTitle,
      nights: result.nights,
      totalPrice: result.totalPrice,
      capacityNote: result.capacityNote ?? null
    },
    { status: 201 }
  );
}
