/**
 * Hand-rolled in-memory sliding-window rate limiter for Next.js Route
 * Handlers — the App Router equivalent of
 * server/src/middleware/rateLimit.js's Express limiter, duplicated rather
 * than shared because the two run in different runtimes/frameworks (a
 * Request/Response pair here vs. Express's req/res/next), same reasoning as
 * every other intentional cross-runtime duplication in this project (see
 * ai-knowledge-base/12_System_Logic.md, section 8b). No new npm dependency
 * (e.g. a hosted rate-limit service) is used, for the same sandbox/deploy
 * constraint documented for the Express limiter.
 *
 * Limitation, same as the Express version: this state is per-process, so it
 * resets on restart and does NOT share state across multiple server
 * instances. Acceptable for this project's single small-property deployment
 * (`output: "standalone"` — a persistent Node process, not one
 * cold-starting serverless function per request), but should be swapped for
 * a shared store (Redis, etc.) before scaling to multiple instances behind a
 * load balancer.
 *
 * SECURITY CONTEXT: added because several public, unauthenticated routes had
 * NO rate limiting at all — POST /api/chat (calls the paid OpenAI API on the
 * caller's behalf), POST /api/bookings (writes a real database row per
 * request), and POST /api/orders (sends real outbound email per request).
 * Without a limit, any of these could be scripted into a cost-abuse or
 * inventory/mailbox-spam denial-of-service. See callers for the specific
 * limits chosen.
 */

const buckets = new Map<string, number[]>();

function clientIp(request: Request): string {
  // Vercel (and most reverse proxies) set x-forwarded-for; take the first
  // hop, which is the original client. Falls back to x-real-ip, then a
  // fixed key so the limiter still functions (just coarser) in an
  // environment that sets neither. Optional chaining on `.headers` itself is
  // deliberate, not defensive-for-defensive's-sake: a real Fetch API Request
  // always has it, but this also gets called with lightweight
  // request-like objects in the project's dry-run test harness, which
  // shouldn't need to fully mock the Fetch API just to exercise routing
  // logic unrelated to rate limiting.
  const forwardedFor = request.headers?.get?.("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  return request.headers?.get?.("x-real-ip") || "unknown";
}

export type RateLimitOptions = {
  /** Sliding window size in milliseconds. */
  windowMs: number;
  /** Max requests allowed per client within the window. */
  max: number;
};

/**
 * Returns true if the request is within its limit (and records this attempt
 * either way — checking never gives a free pass). `scope` namespaces the
 * limiter per-route (e.g. "chat", "bookings") so different endpoints don't
 * share the same bucket for the same IP.
 */
export function isWithinRateLimit(request: Request, scope: string, { windowMs, max }: RateLimitOptions): boolean {
  const key = `${scope}:${clientIp(request)}`;
  const now = Date.now();
  const windowStart = now - windowMs;

  const existing = (buckets.get(key) || []).filter((ts) => ts > windowStart);
  existing.push(now);
  buckets.set(key, existing);

  // Opportunistic cleanup so the map doesn't grow unbounded over the life of
  // the process. forEach (not for...of) — this project's tsconfig targets
  // ES5, which can't iterate a Map directly without --downlevelIteration.
  if (buckets.size > 5000) {
    const staleKeys: string[] = [];
    buckets.forEach((timestamps, k) => {
      if (timestamps.every((ts) => ts <= windowStart)) staleKeys.push(k);
    });
    staleKeys.forEach((k) => buckets.delete(k));
  }

  return existing.length <= max;
}

export function rateLimitedResponse(message = "Too many requests. Please try again shortly.") {
  return Response.json({ message }, { status: 429 });
}
