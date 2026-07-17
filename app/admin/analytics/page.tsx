"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AnalyticsData, api, BookingSourceCount, currency, RevenueTrendPoint, Role } from "@/lib/api";

// Owner-only analytics dashboard — "View reports" is Owner/Admin-only per
// the role spec (same gate as the existing /admin dashboard stats panel;
// see 15_Admin_Guide.md, section 5a), so Reception Staff and guests see an
// access-required message here instead of a page that half-loads.
//
// Charts are hand-rolled SVG (bar chart + donut chart), not a charting
// library — no chart library (recharts, chart.js, etc.) can be reliably
// added to this project's dependencies. A real `npm install` attempt fails
// with the same pre-existing sandbox ENOTEMPTY error documented elsewhere
// in this project (see the payment management phase's PDF-generation
// decision for the first time this was hit). A stray, undeclared `chart.js`
// folder exists in node_modules from an earlier partial install attempt,
// but it isn't in package.json or package-lock.json, so relying on it would
// break the moment someone runs a clean `npm install` — it's not used here.

const CHANNEL_LABELS: Record<string, string> = {
  ai_chat: "AI Chat",
  legacy_form: "Manual / Legacy",
  admin_manual: "Logged by Staff",
  website: "Website"
};

const SOURCE_COLORS = ["#c8a24d", "#101b34", "#1d3468", "#7c9885", "#94a3b8"];

function RevenueTrendChart({ data }: { data: RevenueTrendPoint[] }) {
  const width = 640;
  const height = 260;
  const paddingLeft = 56;
  const paddingBottom = 32;
  const paddingTop = 20;
  const paddingRight = 16;
  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;
  const maxRevenue = Math.max(1, ...data.map((d) => d.revenue));
  const barGap = 18;
  const barWidth = data.length > 0 ? (chartWidth - barGap * (data.length - 1)) / data.length : 0;
  const gridFractions = [0, 0.25, 0.5, 0.75, 1];

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="analytics-chart-svg" role="img" aria-label="Monthly revenue trend, last 6 months">
      {gridFractions.map((fraction) => {
        const y = paddingTop + chartHeight * (1 - fraction);
        return (
          <g key={fraction}>
            <line x1={paddingLeft} y1={y} x2={width - paddingRight} y2={y} className="chart-gridline" />
            <text x={paddingLeft - 8} y={y + 4} textAnchor="end" className="chart-axis-label">
              {Math.round(maxRevenue * fraction).toLocaleString()}
            </text>
          </g>
        );
      })}
      {data.map((point, i) => {
        const barHeight = (point.revenue / maxRevenue) * chartHeight;
        const x = paddingLeft + i * (barWidth + barGap);
        const y = paddingTop + chartHeight - barHeight;
        return (
          <g key={point.month}>
            <rect
              x={x}
              y={point.revenue > 0 ? y : paddingTop + chartHeight - 2}
              width={barWidth}
              height={point.revenue > 0 ? Math.max(barHeight, 2) : 2}
              rx={4}
              className="chart-bar"
            />
            {point.revenue > 0 && (
              <text x={x + barWidth / 2} y={y - 8} textAnchor="middle" className="chart-bar-value">
                {point.revenue.toLocaleString()}
              </text>
            )}
            <text x={x + barWidth / 2} y={height - paddingBottom + 18} textAnchor="middle" className="chart-axis-label">
              {point.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function BookingSourcesChart({ data }: { data: BookingSourceCount[] }) {
  const total = data.reduce((sum, source) => sum + source.count, 0);
  const size = 180;
  const radius = 70;
  const strokeWidth = 26;
  const circumference = 2 * Math.PI * radius;
  let accumulated = 0;

  return (
    <div className="donut-chart-row">
      <svg viewBox={`0 0 ${size} ${size}`} className="analytics-donut-svg" role="img" aria-label="Booking sources breakdown">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--line)" strokeWidth={strokeWidth} />
        {total > 0 &&
          data.map((source, i) => {
            const fraction = source.count / total;
            const segmentLength = fraction * circumference;
            const dashoffset = -accumulated;
            accumulated += segmentLength;
            return (
              <circle
                key={source.channel}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={SOURCE_COLORS[i % SOURCE_COLORS.length]}
                strokeWidth={strokeWidth}
                strokeDasharray={`${segmentLength} ${circumference - segmentLength}`}
                strokeDashoffset={dashoffset}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
              />
            );
          })}
        <text x={size / 2} y={size / 2 - 4} textAnchor="middle" className="donut-center-value">{total}</text>
        <text x={size / 2} y={size / 2 + 16} textAnchor="middle" className="donut-center-label">bookings</text>
      </svg>
      <ul className="donut-legend">
        {data.map((source, i) => (
          <li key={source.channel}>
            <span className="donut-legend-swatch" style={{ background: SOURCE_COLORS[i % SOURCE_COLORS.length] }} />
            <span>{CHANNEL_LABELS[source.channel] || source.channel}</span>
            <strong>{source.count}</strong>
            <span className="muted">{total > 0 ? Math.round((source.count / total) * 100) : 0}%</span>
          </li>
        ))}
        {data.length === 0 && <li className="muted">No bookings yet.</li>}
      </ul>
    </div>
  );
}

function Header() {
  return (
    <header className="site-header">
      <Link className="brand" href="/"><span className="brand-mark">JA</span><span>Jikmis Apartment</span></Link>
      <nav>
        <Link href="/admin">Admin dashboard</Link>
        <Link href="/admin/calendar">Calendar</Link>
        <Link href="/rooms">Rooms</Link>
        <Link href="/login">Login</Link>
      </nav>
    </header>
  );
}

export default function AdminAnalyticsPage() {
  const [role, setRole] = useState<Role | null | "unknown">("unknown");
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    const stored = typeof window !== "undefined" ? localStorage.getItem("jikmis_user") : null;
    // localStorage isn't available during SSR, so this can't be a lazy
    // useState initializer — this effect's only job is reading that external
    // system once on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRole(stored ? (JSON.parse(stored).role as Role) : null);
  }, []);

  const isOwner = role === "ADMIN";

  async function load() {
    setLoading(true);
    try {
      const result = await api<AnalyticsData>("/admin/analytics");
      setData(result);
      setLastUpdated(new Date());
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load analytics.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!isOwner) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    // Analytics changes far less often within a day than live booking
    // status does (see app/admin/calendar/page.tsx's 15s poll for that
    // case), so a lighter touch is enough here: refetch whenever staff
    // switch back to this tab, plus the manual Refresh button below.
    function onFocus() {
      void load();
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOwner]);

  if (role === "unknown") return null;

  if (!isOwner) {
    return (
      <main>
        <Header />
        <section className="section-shell">
          <p className="eyebrow">Analytics</p>
          <h1>Owner access required.</h1>
          <p className="muted">The analytics dashboard is part of &quot;View reports,&quot; an Owner/Admin-only capability — Reception Staff accounts don&apos;t have access.</p>
          <Link className="button primary" href="/login">Log in</Link>
        </section>
      </main>
    );
  }

  const currentMonthLabel = data?.revenueTrend[data.revenueTrend.length - 1]?.label || "";

  return (
    <main>
      <Header />
      <section className="section-shell">
        <p className="eyebrow">Analytics</p>
        <h1>Business at a glance.</h1>
        <div className="analytics-toolbar">
          {lastUpdated && <span className="muted">Updated {lastUpdated.toLocaleTimeString()}</span>}
          <button type="button" className="small-button" onClick={() => void load()} disabled={loading}>Refresh</button>
        </div>
        {error && <p className="message error">{error}</p>}

        {loading && !data && <p className="muted">Loading analytics…</p>}

        {data && (
          <>
            <div className="analytics-card-grid">
              <div className="analytics-card">
                <span className="muted">Total bookings</span>
                <strong>{data.totalBookings}</strong>
              </div>
              <div className="analytics-card">
                <span className="muted">Today&apos;s check-ins</span>
                <strong>{data.todaysCheckIns}</strong>
              </div>
              <div className="analytics-card">
                <span className="muted">Today&apos;s check-outs</span>
                <strong>{data.todaysCheckOuts}</strong>
              </div>
              <div className="analytics-card">
                <span className="muted">Occupied rooms</span>
                <strong>{data.occupiedRooms} <span className="analytics-card-suffix">/ {data.totalRoomUnits}</span></strong>
              </div>
              <div className="analytics-card">
                <span className="muted">Available rooms</span>
                <strong>{data.availableRooms}</strong>
              </div>
              <div className="analytics-card analytics-card-accent">
                <span className="muted">Monthly revenue ({currentMonthLabel})</span>
                <strong>{currency(data.monthlyRevenue)}</strong>
              </div>
              <div className="analytics-card analytics-card-danger">
                <span className="muted">Pending payments</span>
                <strong>{currency(data.pendingPayments.amount)}</strong>
                <span className="analytics-card-note">{data.pendingPayments.count} booking{data.pendingPayments.count === 1 ? "" : "s"} awaiting payment</span>
              </div>
            </div>

            <div className="analytics-chart-grid">
              <div className="analytics-chart-panel">
                <h3>Monthly revenue trend</h3>
                <p className="muted">Last 6 months, attributed to each stay&apos;s check-in month. NPR.</p>
                <RevenueTrendChart data={data.revenueTrend} />
              </div>
              <div className="analytics-chart-panel">
                <h3>Booking sources</h3>
                <p className="muted">Every booking ever made, by channel.</p>
                <BookingSourcesChart data={data.bookingSources} />
              </div>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
