// Pure, framework-free logic for the staff booking calendar
// (app/admin/calendar/page.tsx). Kept separate from the page component (a
// .tsx file, which this project's sandbox can't syntax-check directly — see
// the "Verify" step in 15_Admin_Guide.md/this file's own test coverage) so
// the actual scheduling/overlap math is independently testable and reusable.
//
// Nothing here talks to the network or the DOM — it only transforms
// already-fetched Booking/Room data (see lib/api.ts's types) into the shapes
// the calendar grid renders.

import type { Booking, BookingStatus, Room } from "./api";

// Statuses that genuinely occupy a room-unit for conflict-checking purposes.
// Mirrors server/src/services/bookingService.js's OCCUPYING_STATUSES and
// lib/bookingAssistant.ts's identical constant exactly — this list must stay
// in sync with those two if the booking lifecycle ever changes. CANCELLED
// bookings never occupy anything; CHECKED_OUT bookings occupied their dates
// in the past but are irrelevant for checking new bookings against future
// dates (a checked-out stay's date range has already passed by definition).
export const OCCUPYING_STATUSES: BookingStatus[] = ["PENDING", "CONFIRMED", "CHECKED_IN"];

// Statuses drawn as a normal (non-cancelled) occupancy bar on the calendar.
// CHECKED_OUT is included here (unlike OCCUPYING_STATUSES) purely for
// *display* — a completed stay is still a real, meaningful bar on the
// calendar, it's just no longer a conflict risk for new bookings.
const REAL_STATUSES_FOR_GRID: BookingStatus[] = ["PENDING", "CONFIRMED", "CHECKED_IN", "CHECKED_OUT"];

export function daysInMonth(year: number, monthIndex0: number): number {
  return new Date(year, monthIndex0 + 1, 0).getDate();
}

// Day-of-month (1-based) a date falls on, clamped into [1, totalDays] so a
// booking that starts before or ends after the visible month still renders
// as a bar clipped to the month's edges, rather than being skipped or
// throwing off the grid's column math.
export function clampDayOfMonth(date: Date, year: number, monthIndex0: number, totalDays: number): number {
  const d = new Date(date);
  if (d.getFullYear() < year || (d.getFullYear() === year && d.getMonth() < monthIndex0)) return 1;
  if (d.getFullYear() > year || (d.getFullYear() === year && d.getMonth() > monthIndex0)) return totalDays + 1;
  return d.getDate();
}

// True if [aStart, aEnd) and [bStart, bEnd) overlap, using the same
// half-open convention as the rest of the codebase (a checkout on day N and
// a check-in on day N do NOT conflict — the room turns over same-day). This
// is the identical formula used server-side in hasBookingConflict() /
// countOverlappingBookings() — see server/src/services/bookingService.js and
// lib/bookingAssistant.ts.
export function rangesOverlap(aStart: Date | string, aEnd: Date | string, bStart: Date | string, bEnd: Date | string): boolean {
  return new Date(aStart) < new Date(bEnd) && new Date(aEnd) > new Date(bStart);
}

// Greedy interval-packing: assigns each booking (sorted by check-in) to the
// first row whose most recent booking doesn't overlap it, opening a new row
// only when none of the existing rows have room. This is the classic
// "minimum number of meeting rooms" scheduling algorithm, repurposed to
// assign bookings of the same room *type* to visual unit rows (Room.id ->
// Room.totalUnits physical units, e.g. "Single Studio Room" has 2 units but
// only one Room row in the database) so the calendar can show them as
// separate horizontal tracks the way a real front-desk chart would.
export function assignRows<T extends { checkIn: Date | string; checkOut: Date | string }>(bookings: T[]): T[][] {
  const sorted = [...bookings].sort((a, b) => new Date(a.checkIn).getTime() - new Date(b.checkIn).getTime());
  const rows: T[][] = [];
  for (const booking of sorted) {
    let placedInRow = -1;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const last = row[row.length - 1];
      if (new Date(last.checkOut).getTime() <= new Date(booking.checkIn).getTime()) {
        placedInRow = i;
        break;
      }
    }
    if (placedInRow === -1) {
      rows.push([booking]);
    } else {
      rows[placedInRow].push(booking);
    }
  }
  return rows;
}

export type RoomTracks = {
  room: Room;
  // Real (non-cancelled) occupancy rows, packed into at most room.totalUnits
  // rows under normal conditions.
  occupancyRows: Booking[][];
  // True if occupancyRows needed MORE rows than room.totalUnits to avoid
  // overlapping bars — this should never happen if the server-side conflict
  // check (POST /bookings/manual, the AI booking assistant) is working
  // correctly, so surfacing it is a genuine data-integrity signal, not
  // expected behavior. See 15_Admin_Guide.md's calendar section.
  overbooked: boolean;
  // Cancelled bookings get their own lightweight track(s) below the real
  // occupancy rows, packed independently — a cancellation never competes
  // with real bookings for a "unit slot" since it doesn't occupy the room.
  cancelledRows: Booking[][];
};

export function buildRoomTracks(room: Room, bookingsForRoom: Booking[]): RoomTracks {
  const real = bookingsForRoom.filter((b) => REAL_STATUSES_FOR_GRID.includes(b.status));
  const cancelled = bookingsForRoom.filter((b) => b.status === "CANCELLED");
  const occupancyRows = assignRows(real);
  const totalUnits = Math.max(1, room.totalUnits ?? 1);
  return {
    room,
    occupancyRows,
    overbooked: occupancyRows.length > totalUnits,
    cancelledRows: assignRows(cancelled)
  };
}

// Client-side, UX-only pre-check ("would this obviously conflict?") used by
// the calendar's quick-create form to warn/disable before the guest fills
// out the whole form. This is NOT the source of truth — it only sees
// whatever bookings are already loaded into the page's state, which can be
// stale by up to one poll interval (see the real-time-update notes in
// app/admin/calendar/page.tsx). The server's own check on
// POST /bookings/manual (409 Conflict) is always the final authority and
// must still be handled by the caller regardless of what this returns.
export function hasClientSideConflict(
  bookingsForRoom: Booking[],
  totalUnits: number,
  checkIn: Date | string,
  checkOut: Date | string,
  excludeBookingId?: string
): boolean {
  const overlapping = bookingsForRoom.filter(
    (b) =>
      b.id !== excludeBookingId &&
      OCCUPYING_STATUSES.includes(b.status) &&
      rangesOverlap(b.checkIn, b.checkOut, checkIn, checkOut)
  );
  return overlapping.length >= Math.max(1, totalUnits);
}

export type DayOccupant = {
  booking: Booking;
  isArrival: boolean; // checkIn falls on this exact day
  isDeparture: boolean; // checkOut falls on this exact day
};

// All bookings (any status) whose [checkIn, checkOut) range includes `day` —
// the data behind the "daily occupancy" drill-down panel. Sorted so
// occupying statuses surface first, then checked-out/cancelled history.
export function occupantsForDay(bookingsForRoom: Booking[], day: Date): DayOccupant[] {
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  return bookingsForRoom
    .filter((b) => rangesOverlap(b.checkIn, b.checkOut, dayStart, dayEnd))
    .map((booking) => ({
      booking,
      isArrival: sameCalendarDay(new Date(booking.checkIn), dayStart),
      isDeparture: sameCalendarDay(new Date(booking.checkOut), dayStart)
    }))
    .sort((a, b) => {
      const rank = (s: BookingStatus) => (OCCUPYING_STATUSES.includes(s) ? 0 : s === "CHECKED_OUT" ? 1 : 2);
      return rank(a.booking.status) - rank(b.booking.status);
    });
}

function sameCalendarDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function groupBookingsByRoomId(bookings: Booking[]): Map<string, Booking[]> {
  const map = new Map<string, Booking[]>();
  for (const booking of bookings) {
    const list = map.get(booking.room.id);
    if (list) list.push(booking);
    else map.set(booking.room.id, [booking]);
  }
  return map;
}

export function monthLabel(year: number, monthIndex0: number): string {
  return new Date(year, monthIndex0, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export function isoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
