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
  scenarioHash: z.string(),
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
  reason?: string; // why the offline dispatcher answered
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
  notes: string[]; // anything that could not be turned into a closure
}
