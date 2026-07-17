"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, Booking, currency } from "@/lib/api";

export default function DashboardPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ bookings: Booking[] }>("/bookings").then((data) => setBookings(data.bookings)).catch((err) => setError(err.message));
  }, []);

  return (
    <main>
      <Header />
      <section className="section-shell">
        <p className="eyebrow">User Dashboard</p>
        <h1>Booking history</h1>
        {error && <p className="message error">{error}</p>}
        <div className="table">
          {bookings.map((booking) => (
            <div className="row" key={booking.id}>
              <div><strong>{booking.room.title}</strong><p className="muted">{new Date(booking.checkIn).toLocaleDateString()} to {new Date(booking.checkOut).toLocaleDateString()}</p></div>
              <span className={`status ${booking.status}`}>{booking.status}</span>
              <strong>{currency(booking.totalPrice)}</strong>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

function Header() {
  return <header className="site-header"><Link className="brand" href="/"><span className="brand-mark">JA</span><span>Jikmis Apartment</span></Link><nav><Link href="/rooms">Rooms</Link><Link href="/booking">Book</Link><Link href="/admin">Admin</Link></nav></header>;
}
