import Link from "next/link";

export default function AboutPage() {
  return (
    <main>
      <header className="site-header">
        <Link className="brand" href="/"><span className="brand-mark">JA</span><span>Jikmis Apartment</span></Link>
        <nav><Link href="/rooms">Rooms</Link><Link href="/booking">Book</Link><Link href="/login">Login</Link></nav>
      </header>
      <section className="section-shell detail-grid">
        <div>
          <p className="eyebrow">About / Contact</p>
          <h1>Jikmis Apartment, Boudha.</h1>
          <p className="hero-text">A clean apartment booking system for short stays and monthly rentals in Boudha, Kathmandu.</p>
          <p className="hero-text">WhatsApp: +977 9862568506<br />Email: bookings@jikmis.com</p>
        </div>
        <div className="api-doc">
          <h2>API documentation</h2>
          <p><code>POST /auth/register</code> create user account.</p>
          <p><code>POST /auth/login</code> login and receive JWT.</p>
          <p><code>GET /rooms</code> list rooms. Admins can <code>POST</code>, <code>PUT</code>, and <code>DELETE</code>.</p>
          <p><code>GET /bookings</code> list current user bookings or all bookings for admin.</p>
          <p><code>POST /bookings</code> create booking with conflict prevention.</p>
          <p><code>GET /admin/dashboard</code> admin analytics.</p>
        </div>
      </section>
    </main>
  );
}
