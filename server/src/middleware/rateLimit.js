// Hand-rolled in-memory sliding-window rate limiter — no new npm dependency
// (express-rate-limit is not installed and this project's sandbox/deploy
// setup can't reliably install new packages). Limitation: this state is
// per-process, so it resets on restart and does NOT share state across
// multiple server instances (e.g. a multi-dyno/serverless deployment) —
// acceptable for this single small-property deployment, but should be
// swapped for a shared store (Redis, etc.) before scaling to multiple
// instances behind a load balancer.
function rateLimit({ windowMs, max, message }) {
  const hits = new Map(); // key -> array of request timestamps (ms)

  return function (req, res, next) {
    const key = req.ip || req.headers["x-forwarded-for"] || "unknown";
    const now = Date.now();
    const windowStart = now - windowMs;

    const existing = (hits.get(key) || []).filter((ts) => ts > windowStart);
    existing.push(now);
    hits.set(key, existing);

    // Opportunistic cleanup so the map doesn't grow unbounded over the life
    // of the process.
    if (hits.size > 5000) {
      for (const [k, timestamps] of hits) {
        if (timestamps.every((ts) => ts <= windowStart)) hits.delete(k);
      }
    }

    if (existing.length > max) {
      return res.status(429).json({ message: message || "Too many requests. Please try again later." });
    }
    return next();
  };
}

module.exports = { rateLimit };
