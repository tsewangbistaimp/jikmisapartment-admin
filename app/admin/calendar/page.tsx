"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, Booking, BookingStatus, BOOKING_STATUSES, currency, Role, Room } from "@/lib/api";
import PaymentInvoicePanel from "@/components/PaymentInvoicePanel";
import {
  buildRoomTracks,
  clampDayOfMonth,
  daysInMonth,
  groupBookingsByRoomId,
  hasClientSideConflict,
  isoDate,
  monthLabel,
  occupantsForDay,
  OCCUPYING_STATUSES,
  RoomTracks
} from "@/lib/calendarLogic";

// Staff booking calendar. Reuses the exact same authenticated endpoints as
// app/admin/page.tsx (GET /rooms, GET /bookings, POST /bookings/manual,
// PATCH /bookings/:id/status, PATCH /bookings/:id/payment) — this page adds
// no new API surface, it's a different, more visual way to work with the
// same booking data. See lib/calendarLogic.ts for the scheduling/overlap
// math and 15_Admin_Guide.md for the staff-facing write-up.

const STATUS_LABELS: Record<BookingStatus, string> = {
  PENDING: "Pending",
  CONFIRMED: "Confirmed",
  CHECKED_IN: "Checked-in",
  CHECKED_OUT: "Checked-out",
  CANCELLED: "Cancelled"
};

const POLL_INTERVAL_MS = 15000;

type QuickCreateState = {
  roomId: string;
  roomTitle: string;
  totalUnits: number;
  checkIn: string;
  checkOut: string;
  guestCount: string;
  guestName: string;
  guestPhone: string;
  guestWhatsapp: string;
  guestEmail: string;
  specialRequests: string;
  note: string;
};

export default function AdminCalendarPage() {
  const [role, setRole] = useState<Role | null | "unknown">("unknown");
  const [rooms, setRooms] = useState<Room[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const [viewYear, setViewYear] = useState(() => new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(() => new Date().getMonth());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [statusDraft, setStatusDraft] = useState<BookingStatus | "">("");
  const [paymentDraft, setPaymentDraft] = useState("");

  const [quickCreate, setQuickCreate] = useState<QuickCreateState | null>(null);
  const [quickCreateError, setQuickCreateError] = useState("");
  const [saving, setSaving] = useState(false);

  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [now, setNow] = useState(() => new Date());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // --- Role gate: this page is staff-only (Owner/Admin or Reception). A
  // logged-in guest (USER) or a signed-out visitor sees a message instead of
  // an API 403 wall. --------------------------------------------------
  useEffect(() => {
    const stored = typeof window !== "undefined" ? localStorage.getItem("jikmis_user") : null;
    // localStorage isn't available during SSR, so this can't be a lazy
    // useState initializer — this effect's only job is reading that external
    // system once on mount, not resyncing derived state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRole(stored ? (JSON.parse(stored).role as Role) : null);
  }, []);

  const isStaff = role === "ADMIN" || role === "RECEPTION";

  // --- Data loading --------------------------------------------------
  async function load() {
    try {
      const [roomData, bookingData] = await Promise.all([
        api<{ rooms: Room[] }>("/rooms"),
        api<{ bookings: Booking[] }>("/bookings")
      ]);
      setRooms(roomData.rooms);
      setBookings(bookingData.bookings);
      setLastUpdated(new Date());
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load calendar data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!isStaff) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
    void load();
  }, [isStaff]);

  // --- "Real time": no websocket/SSE infrastructure exists in this project
  // (see 12_System_Logic.md), so this is the honest practical equivalent —
  // poll on an interval, refetch immediately whenever the tab regains focus
  // or becomes visible again, and pause the interval while the tab is
  // hidden so a backgrounded tab doesn't keep hitting the API. Any write
  // action (status/payment/create) also updates local state immediately
  // (optimistic) rather than waiting for the next poll. -------------------
  useEffect(() => {
    if (!isStaff) return;

    function startPolling() {
      if (pollRef.current) return;
      pollRef.current = setInterval(() => {
        if (!document.hidden) void load();
      }, POLL_INTERVAL_MS);
    }
    function stopPolling() {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }
    function onVisibilityChange() {
      if (document.hidden) {
        stopPolling();
      } else {
        void load();
        startPolling();
      }
    }

    startPolling();
    window.addEventListener("focus", load);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stopPolling();
      window.removeEventListener("focus", load);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStaff]);

  // Tick every 5s purely to re-render the "Updated Xs ago" label.
  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 5000);
    return () => clearInterval(tick);
  }, []);

  // --- Derived calendar data ------------------------------------------
  const totalDays = useMemo(() => daysInMonth(viewYear, viewMonth), [viewYear, viewMonth]);
  const dayDates = useMemo(
    () => Array.from({ length: totalDays }, (_, i) => new Date(viewYear, viewMonth, i + 1)),
    [viewYear, viewMonth, totalDays]
  );

  const groupedByRoom = useMemo(() => groupBookingsByRoomId(bookings), [bookings]);

  // Only bookings that could plausibly intersect the visible month are worth
  // rendering as bars (keeps rows tidy on rooms with a long booking history).
  const roomTracks: RoomTracks[] = useMemo(() => {
    const monthStart = new Date(viewYear, viewMonth, 1);
    const monthEnd = new Date(viewYear, viewMonth + 1, 1);
    return rooms.map((room) => {
      const forRoom = (groupedByRoom.get(room.id) ?? []).filter(
        (b) => new Date(b.checkIn) < monthEnd && new Date(b.checkOut) > monthStart
      );
      return buildRoomTracks(room, forRoom);
    });
  }, [rooms, groupedByRoom, viewYear, viewMonth]);

  const today = new Date();
  const isCurrentMonth = today.getFullYear() === viewYear && today.getMonth() === viewMonth;

  function goToMonth(deltaMonths: number) {
    const d = new Date(viewYear, viewMonth + deltaMonths, 1);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
    setSelectedDate(null);
  }

  function goToToday() {
    const t = new Date();
    setViewYear(t.getFullYear());
    setViewMonth(t.getMonth());
    setSelectedDate(t);
  }

  // --- Booking detail modal -------------------------------------------
  function openBooking(booking: Booking) {
    setSelectedBooking(booking);
    setStatusDraft(booking.status);
    setPaymentDraft(String(booking.amountPaid));
  }

  async function saveStatus() {
    if (!selectedBooking || !statusDraft) return;
    setSaving(true);
    try {
      await api(`/bookings/${selectedBooking.id}/status`, { method: "PATCH", body: JSON.stringify({ status: statusDraft }) });
      setBookings((current) => current.map((b) => (b.id === selectedBooking.id ? { ...b, status: statusDraft } : b)));
      setSelectedBooking((current) => (current ? { ...current, status: statusDraft } : current));
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update booking status.");
    } finally {
      setSaving(false);
    }
  }

  async function savePayment() {
    if (!selectedBooking) return;
    const amountPaid = Number(paymentDraft);
    if (!Number.isFinite(amountPaid) || amountPaid < 0) {
      setError("Paid amount must be a valid non-negative number.");
      return;
    }
    setSaving(true);
    try {
      await api(`/bookings/${selectedBooking.id}/payment`, { method: "PATCH", body: JSON.stringify({ amountPaid }) });
      setBookings((current) => current.map((b) => (b.id === selectedBooking.id ? { ...b, amountPaid } : b)));
      setSelectedBooking((current) => (current ? { ...current, amountPaid } : current));
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update payment.");
    } finally {
      setSaving(false);
    }
  }

  // --- Quick-create (click an empty cell) ------------------------------
  function openQuickCreate(room: Room, date: Date) {
    const checkIn = isoDate(date);
    const checkOutDate = new Date(date);
    checkOutDate.setDate(checkOutDate.getDate() + 1);
    setQuickCreateError("");
    setQuickCreate({
      roomId: room.id,
      roomTitle: room.title,
      totalUnits: room.totalUnits ?? 1,
      checkIn,
      checkOut: isoDate(checkOutDate),
      guestCount: "1",
      guestName: "",
      guestPhone: "",
      guestWhatsapp: "",
      guestEmail: "",
      specialRequests: "",
      note: ""
    });
  }

  const quickCreateConflict = useMemo(() => {
    if (!quickCreate) return false;
    const forRoom = groupedByRoom.get(quickCreate.roomId) ?? [];
    if (!quickCreate.checkIn || !quickCreate.checkOut) return false;
    if (new Date(quickCreate.checkOut) <= new Date(quickCreate.checkIn)) return false;
    return hasClientSideConflict(forRoom, quickCreate.totalUnits, quickCreate.checkIn, quickCreate.checkOut);
  }, [quickCreate, groupedByRoom]);

  async function submitQuickCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!quickCreate) return;
    if (new Date(quickCreate.checkOut) <= new Date(quickCreate.checkIn)) {
      setQuickCreateError("Check-out must be after check-in.");
      return;
    }
    setSaving(true);
    setQuickCreateError("");
    try {
      const result = await api<{ booking: Booking }>("/bookings/manual", {
        method: "POST",
        body: JSON.stringify({
          roomId: quickCreate.roomId,
          checkIn: quickCreate.checkIn,
          checkOut: quickCreate.checkOut,
          guestCount: Number(quickCreate.guestCount) || 1,
          guestName: quickCreate.guestName,
          guestPhone: quickCreate.guestPhone,
          guestWhatsapp: quickCreate.guestWhatsapp || undefined,
          guestEmail: quickCreate.guestEmail || undefined,
          specialRequests: quickCreate.specialRequests || undefined,
          note: quickCreate.note || undefined
        })
      });
      setBookings((current) => [result.booking, ...current]);
      setQuickCreate(null);
      void load();
    } catch (err) {
      // The server's totalUnits-aware conflict check (409) is always the
      // final word, regardless of what the client-side pre-check above
      // showed — this message surfaces that authoritative rejection.
      setQuickCreateError(err instanceof Error ? err.message : "Could not create this booking.");
    } finally {
      setSaving(false);
    }
  }

  // --- Room-wise availability reference day (selected day, else today) --
  const referenceDate = selectedDate ?? today;
  const roomAvailabilityToday = useMemo(
    () =>
      rooms.map((room) => {
        const occupants = occupantsForDay(groupedByRoom.get(room.id) ?? [], referenceDate);
        const occupied = occupants.filter((o) => OCCUPYING_STATUSES.includes(o.booking.status)).length;
        const totalUnits = room.totalUnits ?? 1;
        return { room, occupied, totalUnits, free: Math.max(0, totalUnits - occupied) };
      }),
    [rooms, groupedByRoom, referenceDate]
  );

  const updatedSecondsAgo = lastUpdated ? Math.max(0, Math.round((now.getTime() - lastUpdated.getTime()) / 1000)) : null;

  if (role === "unknown") return null;

  if (!isStaff) {
    return (
      <main>
        <Header />
        <section className="section-shell">
          <p className="eyebrow">Booking Calendar</p>
          <h1>Staff access required.</h1>
          <p className="muted">This calendar is available to Owner/Admin and Reception Staff accounts only.</p>
          <Link className="button primary" href="/login">Log in</Link>
        </section>
      </main>
    );
  }

  return (
    <main>
      <Header />
      <section className="section-shell">
        <p className="eyebrow">Booking Calendar</p>
        <h1>Monthly occupancy across every room.</h1>
        {error && <p className="message error">{error}</p>}

        <div className="cal-toolbar">
          <div className="cal-toolbar-group">
            <button type="button" className="small-button" onClick={() => goToMonth(-1)}>&larr; Prev</button>
            <p className="cal-month-label">{monthLabel(viewYear, viewMonth)}</p>
            <button type="button" className="small-button" onClick={() => goToMonth(1)}>Next &rarr;</button>
            <button type="button" className="small-button" onClick={goToToday}>Today</button>
          </div>
          <div className="cal-toolbar-group">
            {updatedSecondsAgo !== null && (
              <span className="cal-live-indicator"><span className="cal-live-dot" />Updated {updatedSecondsAgo}s ago</span>
            )}
            <button type="button" className="small-button" onClick={() => void load()} disabled={loading}>Refresh</button>
          </div>
        </div>

        <div className="cal-legend">
          {BOOKING_STATUSES.map((status) => (
            <span className="cal-legend-item" key={status}>
              <span className={`cal-legend-swatch cal-bar ${status}`} />
              {STATUS_LABELS[status]}
            </span>
          ))}
        </div>

        <p className="muted" style={{ marginBottom: 12 }}>
          Room-wise availability for {selectedDate ? selectedDate.toLocaleDateString() : "today"}:
        </p>
        <div className="cal-room-summary-grid">
          {roomAvailabilityToday.map(({ room, occupied, totalUnits, free }) => (
            <div className="cal-room-summary-card" key={room.id}>
              <strong>{room.title}</strong>
              <span>{free} of {totalUnits} unit{totalUnits === 1 ? "" : "s"} free{occupied > 0 ? ` (${occupied} occupied)` : ""}</span>
            </div>
          ))}
          {rooms.length === 0 && !loading && <p className="muted">No rooms found.</p>}
        </div>

        <div className="cal-grid-scroll">
          <div className="cal-grid-inner">
            <div className="cal-header-row">
              <div className="cal-row-label-cell">Room / Unit</div>
              <div className="cal-header-days" style={{ gridTemplateColumns: `repeat(${totalDays}, minmax(38px, 1fr))` }}>
                {dayDates.map((date) => {
                  const isToday = isCurrentMonth && date.getDate() === today.getDate();
                  const isWeekend = date.getDay() === 0 || date.getDay() === 6;
                  const isSelected = selectedDate ? isoDate(selectedDate) === isoDate(date) : false;
                  return (
                    <button
                      type="button"
                      key={date.toISOString()}
                      className={`cal-header-day${isToday ? " is-today" : ""}${isWeekend ? " is-weekend" : ""}${isSelected ? " is-selected" : ""}`}
                      onClick={() => setSelectedDate(isSelected ? null : date)}
                      title="View daily occupancy for this date"
                    >
                      <span className="cal-header-day-num">{date.getDate()}</span>
                      <span className="cal-header-day-dow">{date.toLocaleDateString("en-US", { weekday: "short" })}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {roomTracks.map((track) => (
              <div className="cal-room-group" key={track.room.id}>
                <div className="cal-room-group-title">
                  {track.room.title} ({track.room.totalUnits ?? 1} unit{(track.room.totalUnits ?? 1) === 1 ? "" : "s"})
                  {track.overbooked && <span className="cal-overbooked-flag">Overbooked — check manually</span>}
                </div>
                {/* Pad up to the room's real physical unit count so an
                    entirely-empty room still shows its full capacity, not
                    just a single row. Rows beyond totalUnits (only possible
                    when track.overbooked is true) are left as-is — the flag
                    above already calls out that anomaly. */}
                {Array.from({ length: Math.max(track.occupancyRows.length, track.room.totalUnits ?? 1) }, (_, idx) => track.occupancyRows[idx] ?? []).map(
                  (rowBookings, idx) => (
                    <CalendarRow
                      key={`occ-${idx}`}
                      room={track.room}
                      rowBookings={rowBookings}
                      dayDates={dayDates}
                      viewYear={viewYear}
                      viewMonth={viewMonth}
                      totalDays={totalDays}
                      today={today}
                      isCurrentMonth={isCurrentMonth}
                      selectedDate={selectedDate}
                      label={`Unit ${idx + 1}`}
                      onEmptyCellClick={openQuickCreate}
                      onBarClick={openBooking}
                    />
                  )
                )}
                {track.cancelledRows.map((rowBookings, idx) => (
                  <CalendarRow
                    key={`cancelled-${idx}`}
                    room={track.room}
                    rowBookings={rowBookings}
                    dayDates={dayDates}
                    viewYear={viewYear}
                    viewMonth={viewMonth}
                    totalDays={totalDays}
                    today={today}
                    isCurrentMonth={isCurrentMonth}
                    selectedDate={selectedDate}
                    label="Cancelled"
                    isCancelledRow
                    onEmptyCellClick={undefined}
                    onBarClick={openBooking}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>

        {selectedDate && (
          <div className="cal-day-panel">
            <h3>Daily occupancy — {selectedDate.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</h3>
            <p className="muted">Every room&apos;s status for this specific date, with arrival/departure flags.</p>
            {rooms.map((room) => {
              const occupants = occupantsForDay(groupedByRoom.get(room.id) ?? [], selectedDate);
              return (
                <div key={room.id} style={{ marginTop: 14 }}>
                  <strong>{room.title}</strong>
                  <div className="cal-day-occupant-list">
                    {occupants.length === 0 && <p className="muted">No bookings on this date — fully free.</p>}
                    {occupants.map(({ booking, isArrival, isDeparture }) => (
                      <div className="cal-day-occupant" key={booking.id} onClick={() => openBooking(booking)} style={{ cursor: "pointer" }}>
                        <div>
                          <span className={`status ${booking.status}`} style={{ marginRight: 8 }}>{STATUS_LABELS[booking.status]}</span>
                          {booking.user?.name || booking.guestName || "Guest"}
                        </div>
                        <div className="cal-day-occupant-flags">
                          {isArrival && <span className="cal-day-flag arrival">Arriving today</span>}
                          {isDeparture && <span className="cal-day-flag departure">Departing today</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {selectedBooking && (
        <div className="cal-modal-backdrop" onClick={() => setSelectedBooking(null)}>
          <div className="cal-modal" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="cal-modal-close" onClick={() => setSelectedBooking(null)} aria-label="Close">&times;</button>
            <h3>{selectedBooking.room.title}</h3>
            <span className={`status ${selectedBooking.status}`}>{STATUS_LABELS[selectedBooking.status]}</span>

            <div style={{ marginTop: 16 }}>
              <div className="cal-modal-field-row"><span>Guest</span><span>{selectedBooking.user?.name || selectedBooking.guestName || "Guest"}</span></div>
              <div className="cal-modal-field-row"><span>Phone</span><span>{selectedBooking.user?.phone || selectedBooking.guestPhone || "-"}</span></div>
              <div className="cal-modal-field-row"><span>Email</span><span>{selectedBooking.user?.email || selectedBooking.guestEmail || "-"}</span></div>
              {selectedBooking.guestWhatsapp && <div className="cal-modal-field-row"><span>WhatsApp</span><span>{selectedBooking.guestWhatsapp}</span></div>}
              <div className="cal-modal-field-row"><span>Check-in</span><span>{new Date(selectedBooking.checkIn).toLocaleDateString()}</span></div>
              <div className="cal-modal-field-row"><span>Check-out</span><span>{new Date(selectedBooking.checkOut).toLocaleDateString()}</span></div>
              <div className="cal-modal-field-row"><span>Guests</span><span>{selectedBooking.guestCount}</span></div>
              {selectedBooking.specialRequests && <div className="cal-modal-field-row"><span>Special requests</span><span>{selectedBooking.specialRequests}</span></div>}
              <div className="cal-modal-field-row"><span>Total price</span><span>{currency(selectedBooking.totalPrice)}</span></div>
              <div className="cal-modal-field-row"><span>Paid</span><span>{currency(selectedBooking.amountPaid)}</span></div>
              <div className="cal-modal-field-row"><span>Remaining</span><span>{currency(selectedBooking.totalPrice - selectedBooking.amountPaid)}</span></div>
            </div>

            <hr className="cal-modal-divider" />

            <label>Status
              <select value={statusDraft} onChange={(e) => setStatusDraft(e.target.value as BookingStatus)}>
                {BOOKING_STATUSES.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}
              </select>
            </label>
            <div className="status-actions" style={{ marginTop: 8 }}>
              <button type="button" className="button primary" disabled={saving} onClick={() => void saveStatus()}>Save status</button>
            </div>

            <label style={{ marginTop: 16, display: "block" }}>Amount paid (quick correction)
              <input type="number" min="0" max={selectedBooking.totalPrice} value={paymentDraft} onChange={(e) => setPaymentDraft(e.target.value)} />
            </label>
            <div className="status-actions" style={{ marginTop: 8 }}>
              <button type="button" className="button secondary" disabled={saving} onClick={() => void savePayment()}>Save payment</button>
            </div>

            <hr className="cal-modal-divider" />

            <PaymentInvoicePanel
              booking={selectedBooking}
              onUpdated={(updated) => {
                setBookings((current) => current.map((b) => (b.id === updated.id ? updated : b)));
                setSelectedBooking(updated);
                setPaymentDraft(String(updated.amountPaid));
              }}
            />
          </div>
        </div>
      )}

      {quickCreate && (
        <div className="cal-modal-backdrop" onClick={() => setQuickCreate(null)}>
          <div className="cal-modal" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="cal-modal-close" onClick={() => setQuickCreate(null)} aria-label="Close">&times;</button>
            <h3>Log a booking — {quickCreate.roomTitle}</h3>
            <p className="muted">Creates a real booking, same as the &quot;Log a booking&quot; form on the main admin page.</p>
            {quickCreateConflict && (
              <p className="cal-conflict-warning">This room appears fully booked for these dates already ({quickCreate.totalUnits} unit{quickCreate.totalUnits === 1 ? "" : "s"} total). You can still try — the server will confirm — but check the calendar dates first.</p>
            )}
            {quickCreateError && <p className="message error">{quickCreateError}</p>}
            <form className="form-grid" onSubmit={submitQuickCreate}>
              <label>Check-in<input type="date" value={quickCreate.checkIn} onChange={(e) => setQuickCreate({ ...quickCreate, checkIn: e.target.value })} required /></label>
              <label>Check-out<input type="date" value={quickCreate.checkOut} onChange={(e) => setQuickCreate({ ...quickCreate, checkOut: e.target.value })} required /></label>
              <label>Guests<input type="number" min="1" value={quickCreate.guestCount} onChange={(e) => setQuickCreate({ ...quickCreate, guestCount: e.target.value })} required /></label>
              <label>Guest full name<input value={quickCreate.guestName} onChange={(e) => setQuickCreate({ ...quickCreate, guestName: e.target.value })} required /></label>
              <label>Guest phone<input value={quickCreate.guestPhone} onChange={(e) => setQuickCreate({ ...quickCreate, guestPhone: e.target.value })} required /></label>
              <label>Guest WhatsApp (optional)<input value={quickCreate.guestWhatsapp} onChange={(e) => setQuickCreate({ ...quickCreate, guestWhatsapp: e.target.value })} /></label>
              <label>Guest email (optional)<input type="email" value={quickCreate.guestEmail} onChange={(e) => setQuickCreate({ ...quickCreate, guestEmail: e.target.value })} /></label>
              <label>Special requests<input value={quickCreate.specialRequests} onChange={(e) => setQuickCreate({ ...quickCreate, specialRequests: e.target.value })} /></label>
              <label>Internal note<input value={quickCreate.note} onChange={(e) => setQuickCreate({ ...quickCreate, note: e.target.value })} /></label>
              <div className="status-actions">
                <button className="button primary" type="submit" disabled={saving}>Create booking</button>
                <button className="button secondary" type="button" onClick={() => setQuickCreate(null)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}

function CalendarRow({
  room,
  rowBookings,
  dayDates,
  viewYear,
  viewMonth,
  totalDays,
  today,
  isCurrentMonth,
  selectedDate,
  label,
  isCancelledRow,
  onEmptyCellClick,
  onBarClick
}: {
  room: Room;
  rowBookings: Booking[];
  dayDates: Date[];
  viewYear: number;
  viewMonth: number;
  totalDays: number;
  today: Date;
  isCurrentMonth: boolean;
  selectedDate: Date | null;
  label: string;
  isCancelledRow?: boolean;
  onEmptyCellClick?: (room: Room, date: Date) => void;
  onBarClick: (booking: Booking) => void;
}) {
  // A day is "empty" for click-to-create purposes if no bar in this row
  // covers it.
  function isDayCovered(date: Date) {
    return rowBookings.some((b) => new Date(b.checkIn) <= date && new Date(b.checkOut) > date);
  }

  return (
    <div className={`cal-row${isCancelledRow ? " is-cancelled-row" : ""}`}>
      <div className="cal-row-label-cell">{label}</div>
      <div className="cal-row-track" style={{ gridTemplateColumns: `repeat(${totalDays}, minmax(38px, 1fr))` }}>
        {dayDates.map((date, i) => {
          const isToday = isCurrentMonth && date.getDate() === today.getDate();
          const isWeekend = date.getDay() === 0 || date.getDay() === 6;
          const isSelected = selectedDate ? isoDate(selectedDate) === isoDate(date) : false;
          const covered = isDayCovered(date);
          return (
            <div
              key={date.toISOString()}
              className={`cal-row-track-cell${isWeekend ? " is-weekend" : ""}${isToday ? " is-today" : ""}${isSelected ? " is-selected" : ""}${!covered && onEmptyCellClick ? " is-empty-cell" : ""}`}
              style={{ gridColumn: `${i + 1} / ${i + 2}`, gridRow: 1 }}
              onClick={() => {
                if (!covered && onEmptyCellClick) onEmptyCellClick(room, date);
              }}
              title={!covered && onEmptyCellClick ? "Click to log a booking for this date" : undefined}
            />
          );
        })}
        {rowBookings.map((booking) => {
          const startCol = clampDayOfMonth(new Date(booking.checkIn), viewYear, viewMonth, totalDays);
          const endCol = clampDayOfMonth(new Date(booking.checkOut), viewYear, viewMonth, totalDays);
          const clippedStart = new Date(booking.checkIn) < new Date(viewYear, viewMonth, 1);
          const clippedEnd = new Date(booking.checkOut) > new Date(viewYear, viewMonth + 1, 1);
          const guestLabel = booking.user?.name || booking.guestName || "Guest";
          return (
            <button
              type="button"
              key={booking.id}
              className={`cal-bar ${booking.status}${clippedStart ? " is-clipped-start" : ""}${clippedEnd ? " is-clipped-end" : ""}`}
              style={{ gridColumn: `${startCol} / ${endCol}`, gridRow: 1 }}
              onClick={(e) => {
                e.stopPropagation();
                onBarClick(booking);
              }}
              title={`${guestLabel} — ${new Date(booking.checkIn).toLocaleDateString()} to ${new Date(booking.checkOut).toLocaleDateString()} — ${STATUS_LABELS[booking.status]}`}
            >
              {guestLabel}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Header() {
  return (
    <header className="site-header">
      <Link className="brand" href="/"><span className="brand-mark">JA</span><span>Jikmis Apartment</span></Link>
      <nav>
        <Link href="/admin">Admin dashboard</Link>
        <Link href="/admin/analytics">Analytics</Link>
        <Link href="/rooms">Rooms</Link>
        <Link href="/login">Login</Link>
      </nav>
    </header>
  );
}
