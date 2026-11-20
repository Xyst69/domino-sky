// Server-only: turn a plain-English crisis into closure events. Falls back to the rule parser.
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { NETWORK, parseHHMM, type Closure } from "@/engine";
import type { CrisisResponse } from "./contract";
import { parseCrisisRules } from "./crisisRules";
import { CRISIS_SYSTEM } from "./prompts";

const AiOutput = z.object({
  closures: z.array(z.object({ airport: z.string(), start: z.string(), end: z.string() })).max(6),
  notes: z.array(z.string()).max(6).optional(),
});

export async function compileCrisis(text: string, opts: { apiKey?: string; model: string; timeoutMs: number; enabled: boolean }): Promise<CrisisResponse> {
  const rules = (why: string): CrisisResponse => {
    const r = parseCrisisRules(text);
    return { source: "rules", closures: r.closures, notes: [why, ...r.notes] };
  };
  if (!opts.enabled || !opts.apiKey) return rules("Read by the built-in parser (AI not configured).");

  const airports = NETWORK.airports.map((a) => a.id);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const ai = new GoogleGenAI({ apiKey: opts.apiKey });
    const res = await ai.models.generateContent({
      model: opts.model,
      contents: [{ role: "user", parts: [{ text }] }],
      config: {
        abortSignal: controller.signal,
        systemInstruction: CRISIS_SYSTEM.replace("{AIRPORTS}", NETWORK.airports.map((a) => `${a.id}: ${a.city}`).join(", ")),
        responseMimeType: "application/json",
        responseJsonSchema: {
          type: "object",
          properties: {
            closures: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  airport: { type: "string", enum: airports },
                  start: { type: "string", description: "HH:MM, 24-hour" },
                  end: { type: "string", description: "HH:MM, 24-hour" },
                },
                required: ["airport", "start", "end"],
              },
            },
            notes: { type: "array", items: { type: "string" } },
          },
          required: ["closures"],
        },
      },
    });
    const parsed = AiOutput.safeParse(JSON.parse(res.text ?? "{}"));
    if (!parsed.success) return rules("The AI's answer was malformed, so the built-in parser read it instead.");
    const closures: Closure[] = [];
    const notes = parsed.data.notes ?? [];
    for (const c of parsed.data.closures) {
      try {
        const start = parseHHMM(c.start);
        const end = parseHHMM(c.end);
        if (!airports.includes(c.airport) || end <= start) throw new Error();
        closures.push({ airport: c.airport, start, end });
      } catch {
        notes.push(`Skipped an invalid closure for ${c.airport}.`);
      }
    }
    return { source: "ai", closures: closures.slice(0, 4), notes };
  } catch {
    return rules(controller.signal.aborted ? "The AI took too long, so the built-in parser read it instead." : "The AI was unavailable, so the built-in parser read it instead.");
  } finally {
    clearTimeout(timer);
  }
}
