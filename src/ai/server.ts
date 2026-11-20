// Server-only configuration and a small per-route, per-IP rate limit for the public AI routes.
export const AI_CONFIG = {
  apiKey: process.env.GEMINI_API_KEY?.trim(),
  model: process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash-lite",
  enabled: process.env.AI_ENABLED?.trim() !== "false",
  thinkingLevel: process.env.GEMINI_THINKING_LEVEL?.trim(), // optional: MINIMAL, LOW, MEDIUM or HIGH
  timeoutMs: 22_000,
};

const WINDOW_MS = 60_000;
const LIMIT = 30; // judges often share one venue network address
const hits = new Map<string, number[]>();

/** Sliding window per server instance. Only accepted requests occupy a slot. */
export function rateLimited(route: string, ip: string): boolean {
  const key = `${route}|${ip}`;
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= LIMIT) return true;
  if (!hits.has(key) && hits.size >= 5000) {
    for (const [client, times] of hits) {
      if (times[times.length - 1] <= now - WINDOW_MS) hits.delete(client);
      else break; // entries are ordered by last accepted request
    }
    if (hits.size >= 5000) return true;
  }
  recent.push(now);
  hits.delete(key);
  hits.set(key, recent);
  return false;
}

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
}
