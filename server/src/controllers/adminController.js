const prisma = require("../utils/prisma");

// Bookings in these statuses represent real, honored stays and count toward
// revenue/payment totals. CANCELLED bookings are excluded.
const ACTIVE_STATUSES = ["PENDING", "CONFIRMED", "CHECKED_IN", "CHECKED_OUT"];

// A room "occupies" a unit for a given day if it's in one of these statuses
// — same list as OCCUPYING_STATUSES in server/src/services/bookingService.js
// and lib/calendarLogic.ts (kept in sync manually across all three, a
// pre-existing, documented duplication pattern in this codebase — see
// 12_System_Logic.md, section 8b).
const OCCUPYING_STATUSES = ["PENDING", "CONFIRMED", "CHECKED_IN"];

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

async function dashboard(req, res) {
  const [
    totalBookings,
    pendingBookings,
    confirmedBookings,
    checkedInBookings,
    checkedOutBookings,
    cancelledBookings,
    rooms,
    users,
    activeAggregate
  ] = await Promise.all([
    prisma.booking.count(),
    prisma.booking.count({ where: { status: "PENDING" } }),
    prisma.booking.count({ where: { status: "CONFIRMED" } }),
    prisma.booking.count({ where: { status: "CHECKED_IN" } }),
    prisma.booking.count({ where: { status: "CHECKED_OUT" } }),
    prisma.booking.count({ where: { status: "CANCELLED" } }),
    prisma.room.count(),
    prisma.user.count(),
    prisma.booking.aggregate({
      where: { status: { in: ACTIVE_STATUSES } },
      _sum: { totalPrice: true, amountPaid: true }
    })
  ]);

  const totalRevenue = activeAggregate._sum.totalPrice || 0;
  const totalPaid = activeAggregate._sum.amountPaid || 0;

  res.json({
    stats: {
      totalBookings,
      pendingBookings,
      confirmedBookings,
      checkedInBookings,
      checkedOutBookings,
      cancelledBookings,
      rooms,
      users,
      totalRevenue,
      totalPaid,
      totalOutstanding: totalRevenue - totalPaid
    }
  });
}

// GET /admin/analytics — the "View reports" capability's data source for the
// dashboard-with-charts described in 15_Admin_Guide.md. Owner-only, same
// gate as GET /admin/dashboard above. Deliberately a separate endpoint
// rather than folded into dashboard() — this does noticeably more work
// (occupancy math, a 6-month revenue trend, a channel groupBy) and the two
// pages that read it (the existing /admin stats panel vs. the new
// /admin/analytics page) don't always need both at once.
async function analytics(req, res) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(todayStart.getDate() + 1);

  // Last 6 calendar months including the current one, oldest first.
  const monthBoundaries = [];
  for (let i = 5; i >= 0; i -= 1) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    monthBoundaries.push({
      start,
      end,
      key: monthKey(start),
      label: start.toLocaleDateString("en-US", { month: "short", year: "numeric" })
    });
  }
  const windowStart = monthBoundaries[0].start;
  const windowEnd = monthBoundaries[monthBoundaries.length - 1].end;

  const [
    totalBookings,
    todaysCheckIns,
    todaysCheckOuts,
    rooms,
    occupyingBookings,
    revenueRows,
    pendingRows,
    channelGroups
  ] = await Promise.all([
    prisma.booking.count(),
    // "Today's check-ins/check-outs": any non-cancelled booking whose
    // checkIn/checkOut date is today — a front-desk arrivals/departures
    // list, not restricted to bookings already flipped to CHECKED_IN, since
    // staff use this card to see who's *expected* today.
    prisma.booking.count({ where: { checkIn: { gte: todayStart, lt: tomorrowStart }, status: { not: "CANCELLED" } } }),
    prisma.booking.count({ where: { checkOut: { gte: todayStart, lt: tomorrowStart }, status: { not: "CANCELLED" } } }),
    prisma.room.findMany({ select: { id: true, totalUnits: true } }),
    // Bookings occupying a unit right now (half-open range, same convention
    // as OCCUPYING_STATUSES elsewhere): checkIn <= today < checkOut.
    prisma.booking.findMany({
      where: { status: { in: OCCUPYING_STATUSES }, checkIn: { lt: tomorrowStart }, checkOut: { gt: todayStart } },
      select: { roomId: true }
    }),
    // Revenue is attributed to the month of the *stay* (checkIn), not the
    // month the booking was made — the standard hospitality convention, and
    // consistent with how totalPrice/amountPaid are already the only
    // revenue figures this project tracks (13_Database_Summary.md, section 8).
    prisma.booking.findMany({
      where: { status: { not: "CANCELLED" }, checkIn: { gte: windowStart, lt: windowEnd } },
      select: { checkIn: true, totalPrice: true }
    }),
    prisma.booking.findMany({
      where: { status: { in: ACTIVE_STATUSES } },
      select: { totalPrice: true, amountPaid: true }
    }),
    prisma.booking.groupBy({ by: ["channel"], _count: { _all: true } })
  ]);

  // Occupied/available rooms — occupancy per room capped at that room's
  // totalUnits, so a data anomaly (more overlapping bookings than physical
  // units — see the calendar's "Overbooked" flag, 12_System_Logic.md
  // section 16) is never reported as more rooms occupied than exist.
  const occupiedByRoom = new Map();
  for (const booking of occupyingBookings) {
    occupiedByRoom.set(booking.roomId, (occupiedByRoom.get(booking.roomId) || 0) + 1);
  }
  let occupiedRooms = 0;
  let totalRoomUnits = 0;
  for (const room of rooms) {
    totalRoomUnits += room.totalUnits;
    occupiedRooms += Math.min(occupiedByRoom.get(room.id) || 0, room.totalUnits);
  }
  const availableRooms = Math.max(0, totalRoomUnits - occupiedRooms);

  // Revenue trend — bucket the 6-month window's bookings by checkIn month.
  const revenueByMonth = new Map(monthBoundaries.map((m) => [m.key, 0]));
  for (const row of revenueRows) {
    const key = monthKey(new Date(row.checkIn));
    if (revenueByMonth.has(key)) {
      revenueByMonth.set(key, revenueByMonth.get(key) + row.totalPrice);
    }
  }
  const revenueTrend = monthBoundaries.map((m) => ({ month: m.key, label: m.label, revenue: revenueByMonth.get(m.key) || 0 }));
  const monthlyRevenue = revenueTrend[revenueTrend.length - 1].revenue;

  // Pending payments — total still owed, and how many active bookings owe
  // something, across every non-cancelled booking regardless of status
  // (mirrors "Remaining balance" everywhere else: totalPrice - amountPaid,
  // never stored, see 13_Database_Summary.md section 8).
  let pendingAmount = 0;
  let pendingCount = 0;
  for (const row of pendingRows) {
    const remaining = row.totalPrice - row.amountPaid;
    if (remaining > 0) {
      pendingAmount += remaining;
      pendingCount += 1;
    }
  }

  // Booking sources — channel is a plain string (not an enum, see
  // 13_Database_Summary.md section 5), so groupBy rather than a hardcoded
  // list of channel names; any future channel value shows up automatically.
  const bookingSources = channelGroups
    .map((row) => ({ channel: row.channel, count: row._count._all }))
    .sort((a, b) => b.count - a.count);

  res.json({
    totalBookings,
    todaysCheckIns,
    todaysCheckOuts,
    occupiedRooms,
    availableRooms,
    totalRoomUnits,
    monthlyRevenue,
    revenueTrend,
    pendingPayments: { amount: pendingAmount, count: pendingCount },
    bookingSources
  });
}

async function users(req, res) {
  const users = await prisma.user.findMany({
    select: { id: true, name: true, email: true, phone: true, role: true, createdAt: true },
    orderBy: { createdAt: "desc" }
  });
  res.json({ users });
}

module.exports = { analytics, dashboard, users };
