"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api, currency, Room } from "@/lib/api";

export default function BookingPage() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomId, setRoomId] = useState("");
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [guestCount, setGuestCount] = useState("1");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const selectedRoom = query.get("roomId") || "";
    api<{ rooms: Room[] }>("/rooms?available=true").then((data) => {
      setRooms(data.rooms);
      setRoomId(selectedRoom || data.rooms[0]?.id || "");
    }).catch((err) => setError(err.message));
  }, []);

  const room = rooms.find((item) => item.id === roomId);
  const total = useMemo(() => {
    if (!room || !checkIn || !checkOut) return 0;
    const nights = Math.ceil((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86400000);
    return Math.max(nights, 0) * room.pricePerNight;
  }, [checkIn, checkOut, room]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    try {
      const data = await api<{ booking: { id: string } }>("/bookings", {
        method: "POST",
        body: JSON.stringify({ roomId, checkIn, checkOut, guestCount: Number(guestCount), note })
      });
      const whatsapp = `Hello Jikmis Apartment, I booked ${room?.title} from ${checkIn} to ${checkOut}. Booking ID: ${data.booking.id}`;
      setMessage(`Booking submitted. WhatsApp message: ${whatsapp}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Booking failed. Please login and try again.");
    }
  }

  return (
    <main>
      <Header />
      <section className="section-shell booking-grid">
        <div>
          <p className="eyebrow">Booking</p>
          <h1>Request your stay.</h1>
          <p className="hero-text">Users must login before submitting. The API prevents overlapping pending or approved bookings for the same room.</p>
        </div>
        <form className="form-card form-grid" onSubmit={submit}>
          <label>Room<select value={roomId} onChange={(event) => setRoomId(event.target.value)}>{rooms.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select></label>
          <label>Check-in<input type="date" value={checkIn} onChange={(event) => setCheckIn(event.target.value)} required /></label>
          <label>Check-out<input type="date" value={checkOut} onChange={(event) => setCheckOut(event.target.value)} required /></label>
          <label>Guests<input type="number" min="1" value={guestCount} onChange={(event) => setGuestCount(event.target.value)} /></label>
          <label>Notes<textarea rows={4} value={note} onChange={(event) => setNote(event.target.value)} /></label>
          <strong>Total: {currency(total)}</strong>
          <button className="button primary" type="submit">Submit booking</button>
          {message && <p className="message success">{message}</p>}
          {error && <p className="message error">{error}</p>}
        </form>
      </section>
    </main>
  );
}

function Header() {
  return <header className="site-header"><Link className="brand" href="/"><span className="brand-mark">JA</span><span>Jikmis Apartment</span></Link><nav><Link href="/rooms">Rooms</Link><Link href="/login">Login</Link><Link href="/register">Register</Link></nav></header>;
}
