"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, currency, Room } from "@/lib/api";

export default function RoomDetail({ params }: { params: { id: string } }) {
  const [room, setRoom] = useState<Room | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ room: Room }>(`/rooms/${params.id}`)
      .then((data) => setRoom(data.room))
      .catch((err) => setError(err.message));
  }, [params.id]);

  return (
    <main>
      <Header />
      <section className="section-shell">
        {error && <p className="message error">{error}</p>}
        {room && (
          <div className="detail-grid">
            <div>
              <div className="gallery">
                {room.images.map((image, index) => (
                  <img key={image} src={image} alt={room.title} loading={index === 0 ? "eager" : "lazy"} />
                ))}
              </div>
              <p className="eyebrow" style={{ marginTop: 24 }}>{room.type}</p>
              <h1>{room.title}</h1>
              <p className="hero-text">{room.description}</p>
            </div>
            <aside className="form-card">
              <h2>{currency(room.pricePerNight)} / night</h2>
              <p>{currency(room.pricePerMonth)} / month</p>
              <h3>Facilities</h3>
              <ul>{room.facilities.map((item) => <li key={item}>{item}</li>)}</ul>
              <h3>Rules</h3>
              <ul>{room.rules.map((item) => <li key={item}>{item}</li>)}</ul>
              <Link className="button primary" href={`/booking?roomId=${room.id}`}>Book this room</Link>
            </aside>
          </div>
        )}
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
