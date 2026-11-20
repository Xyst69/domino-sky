// Server-only: turn a plain-English crisis into closure events. Falls back to the rule parser.
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { NETWORK, parseHHMM, type Closure } from "@/engine";
import { clampClosures, type CrisisResponse } from "./contract";
import { parseCrisisRules } from "./crisisRules";
import { CRISIS_SYSTEM } from "./prompts";

const AiOutput = z.object({
  closures: z.array(z.object({ airport: z.string(), start: z.string(), end: z.string() })).max(8),
});

export interface CrisisOptions {
  apiKey?: string;
  model: string;
  timeoutMs: number;
  enabled: boolean;
  client?: Pick<GoogleGenAI, "models">; // injectable for tests
}

export async function compileCrisis(text: string, opts: CrisisOptions): Promise<CrisisResponse> {
  const rules = (why: string): CrisisResponse => {
    const r = parseCrisisRules(text);
    const c = clampClosures(r.closures);
    return { source: "rules", closures: c.closures, notes: [why, ...r.notes, ...c.notes] };
  };
  if (!opts.enabled || (!opts.apiKey && !opts.client)) return rules("Read by the built-in parser.");

  const airports = NETWORK.airports.map((a) => a.id);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  let raw: string | undefined;
  try {
    const ai = opts.client ?? new GoogleGenAI({ apiKey: opts.apiKey });
    const res = await ai.models.generateContent({
      model: opts.model,
      contents: [{ role: "user", parts: [{ text }] }],
      config: {
        abortSignal: controller.signal,
        maxOutputTokens: 1024,
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
          },
          required: ["closures"],
        },
      },
    });
    raw = res.text;
  } catch {
    return rules(controller.signal.aborted ? "The AI took too long, so the built-in parser read it instead." : "The AI was unavailable, so the built-in parser read it instead.");
  } finally {
    clearTimeout(timer);
  }

  let json: unknown;
  try {
    json = JSON.parse(raw ?? "");
  } catch {
    return rules("The AI's answer was malformed, so the built-in parser read it instead.");
  }
  const parsed = AiOutput.safeParse(json);
  if (!parsed.success) return rules("The AI's answer was malformed, so the built-in parser read it instead.");

  const found: Closure[] = [];
  let skipped = 0;
  for (const c of parsed.data.closures) {
    try {
      const start = parseHHMM(c.start);
      const end = parseHHMM(c.end);
      if (!airports.includes(c.airport) || end <= start) throw new Error();
      found.push({ airport: c.airport, start, end });
    } catch {
      skipped++;
    }
  }
  const clamped = clampClosures(found);
  // Notes are fixed wording only: free text from the model never reaches the screen.
  const notes = [...clamped.notes];
  if (skipped) notes.push(`${skipped} unreadable closure${skipped === 1 ? " was" : "s were"} skipped.`);
  if (clamped.closures.length === 0) notes.push("No closure at a known airport was found in the text.");
  return { source: "ai", closures: clamped.closures, notes };
}
