// Server-only configuration and a small per-route, per-IP rate limit for the public AI routes.
export const AI_CONFIG = {
  apiKey: process.env.GEMINI_API_KEY,
  model: process.env.GEMINI_MODEL || "gemini-3.5-flash-lite",
  enabled: process.env.AI_ENABLED !== "false",
  thinkingLevel: process.env.GEMINI_THINKING_LEVEL, // optional: MINIMAL, LOW, MEDIUM or HIGH
  timeoutMs: 22_000,
};

const WINDOW_MS = 60_000;
const LIMIT = 30; // judges often share one venue network address
const hits = new Map<string, number[]>();

/** In-memory, per server instance. Enough to stop a casual loop from spending the key. */
export function rateLimited(route: string, ip: string): boolean {
  const key = `${route}|${ip}`;
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > LIMIT;
}

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
}
