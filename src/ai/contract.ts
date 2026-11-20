// Shared request/response shapes for the two AI routes. Imported by browser and server.
import { z } from "zod";
import type { Closure, Facts, Metrics, Segment } from "@/engine";

export const PRIORITIES = ["passengers", "cancellations", "keep_spare", "delay"] as const;

export const ClosureInput = z
  .object({
    airport: z.string().regex(/^[A-Z]{3}$/),
    start: z.number().int().min(0).max(1439),
    end: z.number().int().min(1).max(1800),
  })
  .refine((c) => c.end > c.start && c.end - c.start >= 5 && c.end - c.start <= 720, "Closure must last 5 minutes to 12 hours");

export const DispatchRequest = z.object({
  engineVersion: z.string(),
  closures: z.array(ClosureInput).min(1).max(4),
  priority: z.enum(PRIORITIES),
  note: z.string().trim().max(160).optional().default(""),
  scenarioHash: z.string().max(32),
});
export type DispatchRequest = z.infer<typeof DispatchRequest>;

export interface TrailStep {
  actions: string[];
  metrics?: Metrics;
  error?: string;
}

export interface DispatchResponse {
  engineVersion: string;
  scenarioHash: string;
  source: "ai" | "offline";
  model?: string;
  reason?: string; // why the offline dispatcher answered; fixed wording, never model text
  planActions: string[]; // the dispatcher's plan (action ids)
  defaultActions: string[]; // the engine's default pick for the same priority
  segments: Segment[]; // explanation; numbers only as fact references
  trail: TrailStep[]; // plans the AI tried with the simulate tool
  facts: Facts; // every number the explanation may cite, computed by the engine on the server
  frontierSize: number;
  evaluated: number;
}

export const CrisisRequest = z.object({ text: z.string().trim().min(3).max(500) });

export interface CrisisResponse {
  source: "ai" | "rules";
  closures: Closure[];
  notes: string[]; // fixed wording or the user's own words; never free text from the model
}

/** Closures longer than the dispatcher accepts are shortened, never silently dropped. */
export const MAX_CLOSURE_MIN = 720;
export function clampClosures(closures: Closure[]): { closures: Closure[]; notes: string[] } {
  const notes: string[] = [];
  const out: Closure[] = [];
  for (const c of closures.slice(0, 4)) {
    const start = Math.max(0, Math.min(1439, c.start));
    let end = Math.min(c.end, 1800);
    if (end - start > MAX_CLOSURE_MIN) {
      end = start + MAX_CLOSURE_MIN;
      notes.push(`The ${c.airport} closure was shortened to 12 hours, the longest the simulator accepts.`);
    }
    if (end - start < 5) continue;
    out.push({ airport: c.airport, start, end });
  }
  if (closures.length > 4) notes.push("Only the first four closures were kept.");
  return { closures: out, notes };
}
