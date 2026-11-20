import { describe, expect, it, vi } from "vitest";
import { ENGINE_VERSION, PRESETS } from "@/engine";
import { dispatch, OFFLINE_REASON, MAX_SIMULATE_CALLS } from "./dispatcher";
import { compileCrisis } from "./crisis";
import { clampClosures } from "./contract";

// A scripted stand-in for the Gemini client: each call returns the next scripted turn.
type Call = { name: string; args: Record<string, unknown>; id?: string };
function fakeClient(turns: (Call[] | Error | "hang")[]) {
  const generateContent = vi.fn(async (req: { config?: { abortSignal?: AbortSignal } }) => {
    const next = turns.shift();
    if (next === undefined) throw new Error("no more scripted turns");
    if (next instanceof Error) throw next;
    if (next === "hang")
      return new Promise((_, reject) => req.config?.abortSignal?.addEventListener("abort", () => reject(new Error("aborted"))));
    return {
      candidates: [{ content: { role: "model", parts: next.map((c) => ({ functionCall: c })) } }],
      functionCalls: next,
      text: undefined,
    };
  });
  return { client: { models: { generateContent } } as never, generateContent };
}

const flagship = { engineVersion: ENGINE_VERSION, closures: PRESETS[0].closures, priority: "passengers" as const, note: "", scenarioHash: "x" };
const opts = (client: never) => ({ model: "test-model", timeoutMs: 2000, enabled: true, client });

const goodExplanation = [
  { k: "text", text: "Put spare " },
  { k: "entity", type: "aircraft", id: "VT-DS18" },
  { k: "text", text: " on " },
  { k: "entity", type: "flight", id: "DS0304" },
  { k: "text", text: ". Stranded passengers drop to " },
  { k: "fact", key: "plan.stranded" },
  { k: "compare", left: "plan.stranded", op: "lt", right: "closure.stranded" },
  { k: "text", text: "." },
];

describe("AI dispatcher (scripted model)", () => {
  it("accepts a valid plan after a simulate call, with every number from the engine", async () => {
    const { client, generateContent } = fakeClient([
      [{ name: "simulate", args: { actions: ["SWAP:VT-DS18:DS0304"] }, id: "1" }],
      [{ name: "submit_plan", args: { actions: ["SWAP:VT-DS18:DS0304"], explanation: goodExplanation }, id: "2" }],
    ]);
    const r = await dispatch(flagship, opts(client));
    expect(r.source).toBe("ai");
    expect(r.planActions).toEqual(["SWAP:VT-DS18:DS0304"]);
    expect(r.facts["plan.stranded"].value).toBe(0);
    expect(r.facts["closure.stranded"].value).toBe(167);
    expect(r.trail).toHaveLength(1);
    expect(r.trail[0].metrics?.strandedPax).toBe(0);
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it("repairs once when the AI writes a digit, and never shows the AI's text in a reason", async () => {
    const { client } = fakeClient([
      [{ name: "submit_plan", args: { actions: ["SWAP:VT-DS18:DS0304"], explanation: [{ k: "text", text: "Saves 5000 passengers" }] } }],
      [{ name: "submit_plan", args: { actions: ["SWAP:VT-DS18:DS0304"], explanation: goodExplanation } }],
    ]);
    const r = await dispatch(flagship, opts(client));
    expect(r.source).toBe("ai");
    expect(JSON.stringify(r)).not.toContain("5000");
  });

  it("falls back to the engine's plan with a fixed reason after two failed checks", async () => {
    const bad = [{ name: "submit_plan", args: { actions: [], explanation: [{ k: "text", text: "strands forty thousand" }] } }];
    const { client } = fakeClient([bad, bad]);
    const r = await dispatch(flagship, opts(client));
    expect(r.source).toBe("offline");
    expect(r.reason).toBe(OFFLINE_REASON.failedCheck);
    expect(JSON.stringify(r)).not.toContain("forty");
  });

  it("rejects unknown action IDs without echoing them", async () => {
    const { client } = fakeClient([
      [{ name: "simulate", args: { actions: ["DROP TABLE flights"] } }],
      [{ name: "submit_plan", args: { actions: ["SWAP:VT-DS18:DS0304"], explanation: goodExplanation } }],
    ]);
    const r = await dispatch(flagship, opts(client));
    expect(r.source).toBe("ai");
    expect(JSON.stringify(r.trail)).not.toContain("DROP");
  });

  it("enforces the simulate budget even for parallel calls", async () => {
    const many = Array.from({ length: MAX_SIMULATE_CALLS + 2 }, (_, i) => ({ name: "simulate", args: { actions: [] }, id: String(i) }));
    const { client } = fakeClient([many, [{ name: "submit_plan", args: { actions: [], explanation: [{ k: "fact", key: "closure.stranded" }] } }]]);
    const r = await dispatch(flagship, opts(client));
    expect(r.trail.length).toBe(MAX_SIMULATE_CALLS);
  });

  it("answers offline when the model hangs past the timeout", async () => {
    const { client } = fakeClient(["hang"]);
    const r = await dispatch(flagship, { ...opts(client), timeoutMs: 50 });
    expect(r.source).toBe("offline");
    expect(r.reason).toBe(OFFLINE_REASON.timeout);
  });

  it("answers offline when the service errors", async () => {
    const { client } = fakeClient([new Error("429 quota")]);
    const r = await dispatch(flagship, opts(client));
    expect(r.reason).toBe(OFFLINE_REASON.error);
  });

  it("works with no key at all", async () => {
    const r = await dispatch(flagship, { model: "m", timeoutMs: 100, enabled: true });
    expect(r.source).toBe("offline");
    expect(r.planActions).toEqual(["SWAP:VT-DS18:DS0304"]);
  });

  it("returns the scenario code the server computed, not the one the browser sent", async () => {
    const r = await dispatch(flagship, { model: "m", timeoutMs: 100, enabled: false });
    expect(r.scenarioHash).not.toBe("x");
  });
});

describe("crisis compiler", () => {
  it("clamps closures longer than the dispatcher accepts and says so", () => {
    const r = clampClosures([{ airport: "DEL", start: 300, end: 1439 }]);
    expect(r.closures[0].end - r.closures[0].start).toBe(720);
    expect(r.notes.length).toBe(1);
  });
  it("uses the rule parser without a key, and clamps its output", async () => {
    const r = await compileCrisis("Delhi shut until 11pm", { model: "m", timeoutMs: 100, enabled: true });
    expect(r.source).toBe("rules");
    expect(r.closures[0].end - r.closures[0].start).toBeLessThanOrEqual(720);
  });
  it("never shows free text from the model", async () => {
    const generateContent = vi.fn(async () => ({
      text: JSON.stringify({ closures: [{ airport: "BOM", start: "15:00", end: "16:30" }], notes: ["5,000 passengers will be stranded"] }),
    }));
    const r = await compileCrisis("Mumbai storm 3 to 4:30", { model: "m", timeoutMs: 1000, enabled: true, client: { models: { generateContent } } as never });
    expect(r.source).toBe("ai");
    expect(r.closures).toEqual([{ airport: "BOM", start: 900, end: 990 }]);
    expect(JSON.stringify(r.notes)).not.toContain("5,000");
  });
  it("falls back to the rule parser on malformed output", async () => {
    const generateContent = vi.fn(async () => ({ text: "not json" }));
    const r = await compileCrisis("Mumbai storm 3 to 4:30", { model: "m", timeoutMs: 1000, enabled: true, client: { models: { generateContent } } as never });
    expect(r.source).toBe("rules");
    expect(r.closures).toEqual([{ airport: "BOM", start: 900, end: 990 }]);
  });
});
