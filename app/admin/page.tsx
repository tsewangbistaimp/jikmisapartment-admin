"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, BOOKING_STATUSES, Booking, BookingStatus, currency, Role, Room, StaffUser } from "@/lib/api";
import PaymentInvoicePanel from "@/components/PaymentInvoicePanel";

type Stats = {
  totalBookings: number;
  pendingBookings: number;
  confirmedBookings: number;
  checkedInBookings: number;
  checkedOutBookings: number;
  cancelledBookings: number;
  rooms: number;
  users: number;
  totalRevenue: number;
  totalPaid: number;
  totalOutstanding: number;
};
type RoomForm = {
  title: string;
  type: Room["type"];
  pricePerNight: string;
  pricePerMonth: string;
  maxGuests: string;
  totalUnits: string;
  description: string;
  facilities: string;
  rules: string;
  images: string;
  isAvailable: boolean;
};

const emptyRoomForm: RoomForm = {
  title: "",
  type: "SINGLE",
  pricePerNight: "1500",
  pricePerMonth: "37000",
  maxGuests: "2",
  totalUnits: "1",
  description: "",
  facilities: "Free WiFi, 24/7 hot water, Kitchen setup",
  rules: "No smoking, Quiet hours after 10 PM",
  images: "",
  isAvailable: true
};

const CHANNEL_LABELS: Record<string, string> = {
  ai_chat: "AI Chat",
  legacy_form: "Manual / Legacy",
  admin_manual: "Logged by Staff",
  website: "Website"
};

type ManualBookingForm = {
  roomId: string;
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

const emptyManualBookingForm: ManualBookingForm = {
  roomId: "",
  checkIn: "",
  checkOut: "",
  guestCount: "1",
  guestName: "",
  guestPhone: "",
  guestWhatsapp: "",
  guestEmail: "",
  specialRequests: "",
  note: ""
};

type StaffForm = {
  name: string;
  email: string;
  phone: string;
  password: string;
  role: "ADMIN" | "RECEPTION";
};

const emptyStaffForm: StaffForm = { name: "", email: "", phone: "", password: "", role: "RECEPTION" };

function guestDisplayName(booking: Booking) {
  return booking.user?.name || booking.guestName || "Guest";
}

function guestEmail(booking: Booking) {
  return booking.user?.email || booking.guestEmail || "-";
}

function guestPhone(booking: Booking) {
  return booking.user?.phone || booking.guestPhone || "-";
}

export default function AdminPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [error, setError] = useState("");
  const [roomForm, setRoomForm] = useState<RoomForm>(emptyRoomForm);
  const [editingRoomId, setEditingRoomId] = useState<string | null>(null);
  const [paymentDrafts, setPaymentDrafts] = useState<Record<string, string>>({});
  // Gates rendering (and thus the internal payments-history fetch) of
  // PaymentInvoicePanel to one booking card at a time, so opening this
  // dashboard with many bookings doesn't fire N simultaneous
  // GET /bookings/:id/payments requests.
  const [expandedPaymentId, setExpandedPaymentId] = useState<string | null>(null);
  const [manualBookingForm, setManualBookingForm] = useState<ManualBookingForm>(emptyManualBookingForm);
  const [manualBookingWhatsappUrl, setManualBookingWhatsappUrl] = useState<string | null>(null);

  // Role-aware rendering: RECEPTION shares this dashboard with ADMIN
  // (Owner), but "Manage rooms/pricing", "Manage staff", and "View reports"
  // are Owner-only per the role spec — read the logged-in user's role from
  // localStorage (set at login, see app/login/page.tsx) to hide those
  // sections instead of letting Reception hit a confusing 403 from the API.
  const [role, setRole] = useState<Role | null>(null);
  const isOwner = role === "ADMIN";

  const [staff, setStaff] = useState<StaffUser[]>([]);
  const [staffForm, setStaffForm] = useState<StaffForm>(emptyStaffForm);

  async function load(isOwnerRole: boolean) {
    try {
      // /admin/dashboard is Owner-only ("View reports") — Reception Staff
      // would get a 403 there. Fetch it separately from bookings/rooms (both
      // open to any staff role) so one Owner-only 403 can't take down the
      // rest of Reception's dashboard via a single failed Promise.all.
      const [bookingData, roomData] = await Promise.all([
        api<{ bookings: Booking[] }>("/bookings"),
        api<{ rooms: Room[] }>("/rooms")
      ]);
      setBookings(bookingData.bookings);
      setRooms(roomData.rooms);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Admin data failed to load.");
    }

    if (isOwnerRole) {
      try {
        const dashboard = await api<{ stats: Stats }>("/admin/dashboard");
        setStats(dashboard.stats);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load dashboard reports.");
      }
    }
  }

  async function loadStaff() {
    try {
      const data = await api<{ staff: StaffUser[] }>("/admin/staff");
      setStaff(data.staff);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load staff accounts.");
    }
  }

  useEffect(() => {
    const stored = typeof window !== "undefined" ? localStorage.getItem("jikmis_user") : null;
    const parsedRole = stored ? (JSON.parse(stored).role as Role) : null;
    // localStorage isn't available during SSR, so this can't be a lazy
    // useState initializer — this effect's only job is reading that external
    // system once on mount and kicking off the initial data load.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRole(parsedRole);
    void load(parsedRole === "ADMIN");
    if (parsedRole === "ADMIN") void loadStaff();
  }, []);

  async function submitStaff(event: React.FormEvent) {
    event.preventDefault();
    try {
      await api("/admin/staff", {
        method: "POST",
        body: JSON.stringify({
          name: staffForm.name,
          email: staffForm.email,
          phone: staffForm.phone || undefined,
          password: staffForm.password,
          role: staffForm.role
        })
      });
      setStaffForm(emptyStaffForm);
      loadStaff();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create staff account.");
    }
  }

  async function toggleStaffActive(member: StaffUser) {
    try {
      await api(`/admin/staff/${member.id}`, { method: "PATCH", body: JSON.stringify({ isActive: !member.isActive }) });
      loadStaff();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update staff account.");
    }
  }

  async function changeStaffRole(member: StaffUser, newRole: "ADMIN" | "RECEPTION") {
    try {
      await api(`/admin/staff/${member.id}`, { method: "PATCH", body: JSON.stringify({ role: newRole }) });
      loadStaff();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update staff role.");
    }
  }

  async function setStatus(id: string, status: BookingStatus) {
    try {
      await api(`/bookings/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
      load(isOwner);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update booking status.");
    }
  }

  async function savePayment(booking: Booking) {
    const draft = paymentDrafts[booking.id];
    const amountPaid = draft === undefined ? booking.amountPaid : Number(draft);
    if (!Number.isFinite(amountPaid) || amountPaid < 0) {
      setError("Paid amount must be a valid non-negative number.");
      return;
    }
    try {
      await api(`/bookings/${booking.id}/payment`, { method: "PATCH", body: JSON.stringify({ amountPaid }) });
      load(isOwner);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update payment.");
    }
  }

  // Logs a booking on behalf of a guest with no account (walk-in or phone
  // reservation) via the new admin-only POST /bookings/manual endpoint —
  // see server/src/controllers/bookingController.js. Uses the same guest*
  // fields and confirmation-messaging pipeline as an AI-chat booking, just
  // entered by staff instead of collected conversationally.
  async function submitManualBooking(event: React.FormEvent) {
    event.preventDefault();
    setManualBookingWhatsappUrl(null);
    try {
      const result = await api<{ booking: Booking; whatsappUrl: string | null }>("/bookings/manual", {
        method: "POST",
        body: JSON.stringify({
          roomId: manualBookingForm.roomId,
          checkIn: manualBookingForm.checkIn,
          checkOut: manualBookingForm.checkOut,
          guestCount: Number(manualBookingForm.guestCount),
          guestName: manualBookingForm.guestName,
          guestPhone: manualBookingForm.guestPhone,
          guestWhatsapp: manualBookingForm.guestWhatsapp || undefined,
          guestEmail: manualBookingForm.guestEmail || undefined,
          specialRequests: manualBookingForm.specialRequests || undefined,
          note: manualBookingForm.note || undefined
        })
      });
      setManualBookingForm(emptyManualBookingForm);
      setManualBookingWhatsappUrl(result.whatsappUrl);
      load(isOwner);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not log this booking.");
    }
  }

  function editRoom(room: Room) {
    setEditingRoomId(room.id);
    setRoomForm({
      title: room.title,
      type: room.type,
      pricePerNight: String(room.pricePerNight),
      pricePerMonth: String(room.pricePerMonth),
      maxGuests: String(room.maxGuests),
      totalUnits: String(room.totalUnits ?? 1),
      description: room.description,
      facilities: room.facilities.join(", "),
      rules: room.rules.join(", "),
      images: room.images.join("\n"),
      isAvailable: room.isAvailable
    });
  }

  async function saveRoom(event: React.FormEvent) {
    event.preventDefault();
    const payload = {
      ...roomForm,
      pricePerNight: Number(roomForm.pricePerNight),
      pricePerMonth: Number(roomForm.pricePerMonth),
      maxGuests: Number(roomForm.maxGuests),
      totalUnits: Number(roomForm.totalUnits),
      facilities: roomForm.facilities.split(",").map((item) => item.trim()).filter(Boolean),
      rules: roomForm.rules.split(",").map((item) => item.trim()).filter(Boolean),
      images: roomForm.images.split("\n").map((item) => item.trim()).filter(Boolean)
    };
    try {
      await api(editingRoomId ? `/rooms/${editingRoomId}` : "/rooms", {
        method: editingRoomId ? "PUT" : "POST",
        body: JSON.stringify(payload)
      });
      setRoomForm(emptyRoomForm);
      setEditingRoomId(null);
      load(isOwner);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save room.");
    }
  }

  async function deleteRoom(id: string) {
    await api(`/rooms/${id}`, { method: "DELETE" });
    load(isOwner);
  }

  async function toggleRoomAvailability(room: Room) {
    try {
      await api(`/rooms/${room.id}`, {
        method: "PUT",
        body: JSON.stringify({ ...room, isAvailable: !room.isAvailable })
      });
      load(isOwner);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update room availability.");
    }
  }

  return (
    <main>
      <Header />
      <section className="section-shell">
        <p className="eyebrow">Admin Dashboard</p>
        <h1>Manage rooms and bookings.</h1>
        <p style={{ marginTop: -8, marginBottom: 18 }}>
          <Link className="text-link" href="/admin/calendar">Open the booking calendar &rarr;</Link>
          {isOwner && <> &nbsp;&middot;&nbsp; <Link className="text-link" href="/admin/analytics">Open analytics &rarr;</Link></>}
        </p>
        {error && <p className="message error">{error}</p>}
        {stats && (
          <div className="stat-grid">
            <div className="stat"><span>Total bookings</span><strong>{stats.totalBookings}</strong></div>
            <div className="stat"><span>Pending</span><strong>{stats.pendingBookings}</strong></div>
            <div className="stat"><span>Confirmed</span><strong>{stats.confirmedBookings}</strong></div>
            <div className="stat"><span>Checked in</span><strong>{stats.checkedInBookings}</strong></div>
            <div className="stat"><span>Checked out</span><strong>{stats.checkedOutBookings}</strong></div>
            <div className="stat"><span>Cancelled</span><strong>{stats.cancelledBookings}</strong></div>
            <div className="stat"><span>Rooms</span><strong>{stats.rooms}</strong></div>
            <div className="stat"><span>Registered users</span><strong>{stats.users}</strong></div>
            <div className="stat"><span>Total value (active bookings)</span><strong>{currency(stats.totalRevenue)}</strong></div>
            <div className="stat"><span>Total paid</span><strong>{currency(stats.totalPaid)}</strong></div>
            <div className="stat"><span>Outstanding balance</span><strong>{currency(stats.totalOutstanding)}</strong></div>
          </div>
        )}
      </section>

      <section className="section-shell">
        <h2>Log a booking (walk-in / phone)</h2>
        <p className="muted">For guests who booked by phone, in person, or without using the AI chat — creates a real booking record and triggers the same confirmation email/WhatsApp link as any other booking.</p>
        <form className="form-grid" onSubmit={submitManualBooking}>
          <label>Room<select value={manualBookingForm.roomId} onChange={(event) => setManualBookingForm({ ...manualBookingForm, roomId: event.target.value })} required>
            <option value="" disabled>Select a room</option>
            {rooms.map((room) => <option key={room.id} value={room.id}>{room.title}</option>)}
          </select></label>
          <label>Check-in<input type="date" value={manualBookingForm.checkIn} onChange={(event) => setManualBookingForm({ ...manualBookingForm, checkIn: event.target.value })} required /></label>
          <label>Check-out<input type="date" value={manualBookingForm.checkOut} onChange={(event) => setManualBookingForm({ ...manualBookingForm, checkOut: event.target.value })} required /></label>
          <label>Guests<input type="number" min="1" value={manualBookingForm.guestCount} onChange={(event) => setManualBookingForm({ ...manualBookingForm, guestCount: event.target.value })} required /></label>
          <label>Guest full name<input value={manualBookingForm.guestName} onChange={(event) => setManualBookingForm({ ...manualBookingForm, guestName: event.target.value })} required /></label>
          <label>Guest phone<input value={manualBookingForm.guestPhone} onChange={(event) => setManualBookingForm({ ...manualBookingForm, guestPhone: event.target.value })} required /></label>
          <label>Guest WhatsApp (optional, defaults to phone)<input value={manualBookingForm.guestWhatsapp} onChange={(event) => setManualBookingForm({ ...manualBookingForm, guestWhatsapp: event.target.value })} /></label>
          <label>Guest email (optional)<input type="email" value={manualBookingForm.guestEmail} onChange={(event) => setManualBookingForm({ ...manualBookingForm, guestEmail: event.target.value })} /></label>
          <label>Special requests<input value={manualBookingForm.specialRequests} onChange={(event) => setManualBookingForm({ ...manualBookingForm, specialRequests: event.target.value })} /></label>
          <label>Internal note<input value={manualBookingForm.note} onChange={(event) => setManualBookingForm({ ...manualBookingForm, note: event.target.value })} /></label>
          <div className="status-actions">
            <button className="button primary" type="submit">Log booking</button>
          </div>
        </form>
        {manualBookingWhatsappUrl && (
          <p className="message">
            Booking logged. <a href={manualBookingWhatsappUrl} target="_blank" rel="noreferrer">Open WhatsApp confirmation to send to the guest</a>.
          </p>
        )}
      </section>

      <section className="section-shell">
        <h2>Bookings</h2>
        <div className="table booking-list">
          {bookings.map((booking) => {
            const remaining = booking.totalPrice - booking.amountPaid;
            const draftValue = paymentDrafts[booking.id] ?? String(booking.amountPaid);
            return (
              <div className="booking-card" key={booking.id}>
                <div className="booking-card-header">
                  <div>
                    <strong>{booking.room.title}</strong>
                    <span className="channel-badge">{CHANNEL_LABELS[booking.channel] ?? booking.channel}</span>
                  </div>
                  <select
                    className={`status ${booking.status}`}
                    value={booking.status}
                    onChange={(event) => setStatus(booking.id, event.target.value as BookingStatus)}
                  >
                    {BOOKING_STATUSES.map((status) => (
                      <option key={status} value={status}>{status.replace("_", " ")}</option>
                    ))}
                  </select>
                </div>

                <div className="booking-card-body">
                  <div>
                    <p className="muted">Guest</p>
                    <p>{guestDisplayName(booking)}</p>
                    <p className="muted">{guestEmail(booking)}</p>
                    <p className="muted">{guestPhone(booking)}{booking.guestWhatsapp ? ` (WhatsApp: ${booking.guestWhatsapp})` : ""}</p>
                  </div>
                  <div>
                    <p className="muted">Stay</p>
                    <p>{new Date(booking.checkIn).toLocaleDateString()} to {new Date(booking.checkOut).toLocaleDateString()}</p>
                    <p className="muted">{booking.guestCount} guest{booking.guestCount === 1 ? "" : "s"}</p>
                    {booking.specialRequests && <p className="muted">Request: {booking.specialRequests}</p>}
                  </div>
                  <div className="payment-panel">
                    <p className="muted">Payment</p>
                    <div className="payment-row"><span>Total</span><strong>{currency(booking.totalPrice)}</strong></div>
                    <div className="payment-row"><span>Paid</span><strong>{currency(booking.amountPaid)}</strong></div>
                    <div className="payment-row"><span>Remaining</span><strong>{currency(remaining)}</strong></div>
                    <div className="payment-edit">
                      <input
                        type="number"
                        min="0"
                        max={booking.totalPrice}
                        value={draftValue}
                        onChange={(event) => setPaymentDrafts((current) => ({ ...current, [booking.id]: event.target.value }))}
                      />
                      <button type="button" className="small-button" onClick={() => savePayment(booking)}>Save payment</button>
                    </div>
                    <button
                      type="button"
                      className="small-button"
                      style={{ marginTop: 8 }}
                      onClick={() => setExpandedPaymentId((current) => (current === booking.id ? null : booking.id))}
                    >
                      {expandedPaymentId === booking.id ? "Hide payment & invoice" : "Manage payment & invoice"}
                    </button>
                    {expandedPaymentId === booking.id && (
                      <PaymentInvoicePanel
                        booking={booking}
                        onUpdated={(updated) => {
                          setBookings((current) => current.map((b) => (b.id === updated.id ? updated : b)));
                          setPaymentDrafts((current) => ({ ...current, [updated.id]: String(updated.amountPaid) }));
                        }}
                      />
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {bookings.length === 0 && <p className="muted">No bookings yet.</p>}
        </div>
      </section>

      {isOwner && (
      <section className="section-shell">
        <h2>Staff management</h2>
        <p className="muted">Owner/Admin only. Reception Staff accounts can create bookings, manage guests, update payments, and view availability — they cannot manage rooms, pricing, staff, or view this dashboard&apos;s financial reports section beyond what&apos;s shown here.</p>
        <form className="form-grid" onSubmit={submitStaff}>
          <label>Name<input value={staffForm.name} onChange={(event) => setStaffForm({ ...staffForm, name: event.target.value })} required /></label>
          <label>Email<input type="email" value={staffForm.email} onChange={(event) => setStaffForm({ ...staffForm, email: event.target.value })} required /></label>
          <label>Phone<input value={staffForm.phone} onChange={(event) => setStaffForm({ ...staffForm, phone: event.target.value })} /></label>
          <label>Temporary password<input type="password" value={staffForm.password} onChange={(event) => setStaffForm({ ...staffForm, password: event.target.value })} required minLength={8} /></label>
          <label>Role<select value={staffForm.role} onChange={(event) => setStaffForm({ ...staffForm, role: event.target.value as "ADMIN" | "RECEPTION" })}>
            <option value="RECEPTION">Reception Staff</option>
            <option value="ADMIN">Owner/Admin</option>
          </select></label>
          <div className="status-actions">
            <button className="button primary" type="submit">Add staff account</button>
          </div>
        </form>
        <div className="table room-admin-list">
          {staff.map((member) => (
            <div className="row" key={member.id}>
              <div>
                <strong>{member.name}</strong>
                <p className="muted">{member.email}{member.phone ? ` - ${member.phone}` : ""}</p>
              </div>
              <span>{member.isActive ? "Active" : "Deactivated"}</span>
              <div className="status-actions">
                <select
                  value={member.role}
                  onChange={(event) => changeStaffRole(member, event.target.value as "ADMIN" | "RECEPTION")}
                >
                  <option value="RECEPTION">Reception Staff</option>
                  <option value="ADMIN">Owner/Admin</option>
                </select>
                <button className="small-button" onClick={() => toggleStaffActive(member)}>{member.isActive ? "Deactivate" : "Reactivate"}</button>
              </div>
            </div>
          ))}
          {staff.length === 0 && <p className="muted">No staff accounts yet.</p>}
        </div>
      </section>
      )}

      {isOwner && (
      <section className="section-shell admin-grid">
        <div className="dashboard-panel">
          <h2>Room management</h2>
          <form className="form-grid" onSubmit={saveRoom}>
            <label>Title<input value={roomForm.title} onChange={(event) => setRoomForm({ ...roomForm, title: event.target.value })} required /></label>
            <label>Type<select value={roomForm.type} onChange={(event) => setRoomForm({ ...roomForm, type: event.target.value as Room["type"] })}><option value="STUDIO">Studio</option><option value="SINGLE">Single</option><option value="DOUBLE">Double</option><option value="FAMILY">Family</option></select></label>
            <label>Price per night<input type="number" value={roomForm.pricePerNight} onChange={(event) => setRoomForm({ ...roomForm, pricePerNight: event.target.value })} required /></label>
            <label>Price per month<input type="number" value={roomForm.pricePerMonth} onChange={(event) => setRoomForm({ ...roomForm, pricePerMonth: event.target.value })} required /></label>
            <label>Max guests<input type="number" value={roomForm.maxGuests} onChange={(event) => setRoomForm({ ...roomForm, maxGuests: event.target.value })} required /></label>
            <label>Total units (physical rooms of this type)<input type="number" min="1" value={roomForm.totalUnits} onChange={(event) => setRoomForm({ ...roomForm, totalUnits: event.target.value })} required /></label>
            <label>Description<textarea rows={3} value={roomForm.description} onChange={(event) => setRoomForm({ ...roomForm, description: event.target.value })} required /></label>
            <label>Facilities<input value={roomForm.facilities} onChange={(event) => setRoomForm({ ...roomForm, facilities: event.target.value })} /></label>
            <label>Rules<input value={roomForm.rules} onChange={(event) => setRoomForm({ ...roomForm, rules: event.target.value })} /></label>
            <label>Image URLs<textarea rows={3} value={roomForm.images} onChange={(event) => setRoomForm({ ...roomForm, images: event.target.value })} required /></label>
            <label className="check-row"><input type="checkbox" checked={roomForm.isAvailable} onChange={(event) => setRoomForm({ ...roomForm, isAvailable: event.target.checked })} /> Available for booking</label>
            <div className="status-actions">
              <button className="button primary" type="submit">{editingRoomId ? "Update room" : "Add room"}</button>
              {editingRoomId && <button className="button secondary" type="button" onClick={() => { setEditingRoomId(null); setRoomForm(emptyRoomForm); }}>Cancel</button>}
            </div>
          </form>
          <div className="table room-admin-list">
            {rooms.map((room) => (
              <div className="row" key={room.id}>
                <div>
                  <strong>{room.title}</strong>
                  <p className="muted">{room.type} - {room.totalUnits ?? 1} unit{(room.totalUnits ?? 1) === 1 ? "" : "s"} - {currency(room.pricePerNight)}/night</p>
                </div>
                <span>{room.isAvailable ? "Available" : "Unavailable"}</span>
                <div className="status-actions">
                  <button className="small-button" onClick={() => toggleRoomAvailability(room)}>{room.isAvailable ? "Mark unavailable" : "Mark available"}</button>
                  <button className="small-button" onClick={() => editRoom(room)}>Edit</button>
                  <button className="small-button" onClick={() => deleteRoom(room.id)}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
      )}
    </main>
  );
}

function Header() {
  return <header className="site-header"><Link className="brand" href="/"><span className="brand-mark">JA</span><span>Jikmis Apartment</span></Link><nav><Link href="/admin/calendar">Calendar</Link><Link href="/admin/analytics">Analytics</Link><Link href="/rooms">Rooms</Link><Link href="/dashboard">User dashboard</Link><Link href="/login">Login</Link></nav></header>;
}
