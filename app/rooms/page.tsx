"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, currency, Room } from "@/lib/api";

export default function RoomsPage() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ rooms: Room[] }>("/rooms")
      .then((data) => setRooms(data.rooms))
      .catch((err) => setError(err.message));
  }, []);

  return (
    <main>
      <Header />
      <section className="section-shell">
        <div className="section-heading">
          <p className="eyebrow">Rooms</p>
          <h1>Room listing</h1>
          <p className="muted">Filter from the home page or open a room to check details, rules, images, and booking dates.</p>
        </div>
        {error && <p className="message error">{error}</p>}
        <div className="room-grid">
          {rooms.map((room) => (
            <article className="room-card" key={room.id}>
              <img src={room.images[0]} alt={room.title} loading="lazy" />
              <div>
                <p className="badge">{room.type}</p>
                <h3>{room.title}</h3>
                <p>{room.description}</p>
                <div className="card-footer">
                  <strong>{currency(room.pricePerNight)} / night</strong>
                  <Link className="text-link" href={`/rooms/${room.id}`}>View room</Link>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

function Header() {
  return (
    <header className="site-header">
      <Link className="brand" href="/"><span className="brand-mark">JA</span><span>Jikmis Apartment</span></Link>
      <nav><Link href="/rooms">Rooms</Link><Link href="/booking">Book</Link><Link href="/dashboard">Dashboard</Link><Link href="/admin">Admin</Link></nav>
    </header>
  );
}
