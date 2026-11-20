import { describe, expect, it } from "vitest";
import {
  NETWORK,
  PRESETS,
  searchRecovery,
  simulate,
  pickPlan,
  checkPlan,
  buildFacts,
  entitySets,
  offlineExplanation,
  validateSegments,
  causeChain,
  parseActionId,
  actionId,
  type Segment,
} from "./index";

// Golden numbers for every preset. If the engine changes, these must be re-checked by hand.
const GOLDEN: Record<string, { stranded: number; cancelled: number; crew: number; bestStranded: number }> = {
  "crew-clock": { stranded: 167, cancelled: 1, crew: 1, bestStranded: 0 },
  "one-spare": { stranded: 267, cancelled: 2, crew: 2, bestStranded: 117 },
  hyderabad: { stranded: 379, cancelled: 2, crew: 2, bestStranded: 147 },
  "two-hubs": { stranded: 30, cancelled: 0, crew: 0, bestStranded: 30 },
};

describe("presets", () => {
  for (const p of PRESETS) {
    it(`${p.name}: matches golden numbers`, () => {
      const r = simulate(NETWORK, { closures: p.closures, actions: [] });
      const g = GOLDEN[p.id];
      expect(r.metrics.strandedPax).toBe(g.stranded);
      expect(r.metrics.cancelledFlights).toBe(g.cancelled);
      expect(r.metrics.crewBreaches).toBe(g.crew);
      const s = searchRecovery(NETWORK, p.closures);
      expect(pickPlan(s.frontier, "passengers").metrics.strandedPax).toBe(g.bestStranded);
      for (const plan of s.frontier) expect(checkPlan(NETWORK, plan.actions).ok).toBe(true);
    });
  }
  it("the one-spare preset is a real choice: the single Delhi spare cannot save both days", () => {
    const p = PRESETS.find((x) => x.id === "one-spare")!;
    const s = searchRecovery(NETWORK, p.closures);
    const swaps = s.frontier.filter((pl) => pl.actions.some((a) => a.kind === "swap"));
    const targets = new Set(swaps.flatMap((pl) => pl.actions.filter((a) => a.kind === "swap").map((a) => (a as { flight: string }).flight)));
    expect(targets.has("DS1102")).toBe(true);
    expect(targets.has("DS0105")).toBe(true);
    expect(checkPlan(NETWORK, [
      { kind: "swap", spare: "VT-DS18", flight: "DS1102" },
      { kind: "swap", spare: "VT-DS18", flight: "DS0105" },
    ]).ok).toBe(false);
    expect(pickPlan(s.frontier, "keep_spare").metrics.sparesUsed).toBe(0);
  });
});

describe("conflict checker", () => {
  it("rejects a spare flying from another airport", () => {
    const r = checkPlan(NETWORK, [{ kind: "swap", spare: "VT-DS17", flight: "DS0304" }]);
    expect(r.ok).toBe(false);
  });
  it("rejects legs that are not an out-and-back pair", () => {
    expect(checkPlan(NETWORK, [{ kind: "cancelPair", out: "DS0303", back: "DS0304" }]).ok).toBe(false);
  });
  it("round-trips action ids", () => {
    for (const id of ["SWAP:VT-DS18:DS0304", "CANCEL:DS0502+DS0503", "HOLD:CX19"]) expect(actionId(parseActionId(id)!)).toBe(id);
    expect(parseActionId("DROP TABLE")).toBeNull();
  });
});

describe("number guarantee", () => {
  const p = PRESETS[0];
  const closure = simulate(NETWORK, { closures: p.closures, actions: [] });
  const s = searchRecovery(NETWORK, p.closures);
  const plan = pickPlan(s.frontier, "passengers");
  const planRes = simulate(NETWORK, { closures: p.closures, actions: plan.actions });
  const facts = buildFacts(NETWORK, p.closures, { closure, plan: planRes, default: planRes });
  const ents = entitySets(NETWORK);

  it("the offline explanation passes the same checker as the AI", () => {
    expect(validateSegments(offlineExplanation(NETWORK, plan, "passengers"), facts, ents)).toEqual({ ok: true });
  });
  it("facts equal the engine's numbers", () => {
    expect(facts["closure.stranded"].value).toBe(167);
    expect(facts["plan.stranded"].value).toBe(0);
    expect(facts["closure.DS0304.duty"].value).toBe(605);
  });
  const bad: [string, Segment[]][] = [
    ["digits", [{ k: "text", text: "Saves 167 passengers" }]],
    ["number words", [{ k: "text", text: "rescues forty passengers" }]],
    ["'half'", [{ k: "text", text: "strands half the passengers" }]],
    ["Devanagari digits", [{ k: "text", text: "यात्री १६७" }]],
    ["Gujarati digits", [{ k: "text", text: "યાત્રી ૧૬૭" }]],
    ["Tamil digits", [{ k: "text", text: "பயணிகள் ௧௬௭" }]],
    ["superscripts and fractions", [{ k: "text", text: "about ½ of them" }]],
    ["Roman numerals", [{ k: "text", text: "Option XII is best" }]],
    ["ordinals", [{ k: "text", text: "the third option" }]],
    ["'both'", [{ k: "text", text: "both crews time out" }]],
    ["'million'", [{ k: "text", text: "a million minutes" }]],
    ["an unbacked comparison", [{ k: "text", text: "this strands fewer people" }]],
    ["unknown fact", [{ k: "fact", key: "plan.happiness" }]],
    ["unknown flight", [{ k: "entity", type: "flight", id: "DS9999" }]],
    ["false comparison", [{ k: "compare", left: "closure.stranded", op: "lt", right: "plan.stranded" }]],
    ["comparison of different units", [{ k: "compare", left: "closure.stranded", op: "gt", right: "DS0304.schedDep" }]],
    ["too many segments", Array.from({ length: 60 }, () => ({ k: "text", text: "x" }) as Segment)],
  ];
  for (const [name, segs] of bad) it(`rejects ${name}`, () => expect(validateSegments(segs, facts, ents).ok).toBe(false));
  it("accepts IDs as entities, the pronoun I, and backed comparisons", () => {
    const segs: Segment[] = [
      { k: "text", text: "I recommend this: " },
      { k: "entity", type: "flight", id: "DS0304" },
      { k: "text", text: " is saved by " },
      { k: "entity", type: "aircraft", id: "VT-DS18" },
      { k: "text", text: ", which strands fewer people" },
      { k: "compare", left: "plan.stranded", op: "lt", right: "closure.stranded" },
    ];
    expect(validateSegments(segs, facts, ents)).toEqual({ ok: true });
  });
  it("does not offer departure facts for a cancelled flight", () => {
    expect(facts["closure.DS0304.dep"]).toBeUndefined();
    expect(facts["closure.DS0304.duty"].value).toBe(605);
  });
});

describe("passenger counting", () => {
  it("does not count stranded connecting passengers again as delayed (Hyderabad preset)", () => {
    const p = PRESETS.find((x) => x.id === "hyderabad")!;
    const r = simulate(NETWORK, { closures: p.closures, actions: [] });
    // CX17's 23 passengers were on cancelled DS0704: stranded, so not among DS0803's delayed passengers.
    const lateFlights = Object.values(r.flights).filter((s) => s.status === "late");
    const naive = lateFlights.reduce((a, s) => a + NETWORK.flights.find((f) => f.id === s.id)!.pax, 0);
    expect(r.connections.CX17.reason).toBe("inbound_cancelled");
    expect(r.metrics.delayedPax).toBeLessThan(naive);
    expect(r.metrics.delayedPax + r.metrics.strandedPax).toBeLessThanOrEqual(NETWORK.flights.reduce((a, f) => a + f.pax, 0));
  });
});

describe("two closures at one airport", () => {
  it("the cause chain names the closure that actually held the flight", () => {
    const closures = [
      { airport: "DEL", start: 360, end: 450 },
      { airport: "DEL", start: 900, end: 990 },
    ];
    const r = simulate(NETWORK, { closures, actions: [] });
    const steps = causeChain(NETWORK, r, closures, "DS0105");
    expect(steps[0].link).toBe("storm");
    expect(steps[0].text).toContain("15:00–16:30");
  });
});

describe("cause chain", () => {
  it("traces DS0304 back to the Mumbai closure through DS0303 and the crew clock", () => {
    const p = PRESETS[0];
    const r = simulate(NETWORK, { closures: p.closures, actions: [] });
    const steps = causeChain(NETWORK, r, p.closures, "DS0304");
    expect(steps[0].link).toBe("storm");
    expect(steps.map((s) => s.flight).filter(Boolean)).toEqual(["DS0303", "DS0304"]);
    expect(steps[steps.length - 1].link).toBe("crew");
  });
});
