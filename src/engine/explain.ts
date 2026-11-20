import { actionId, PRIORITY_LABEL, type Plan, type Priority } from "./recovery";
import { fmt, fmtDuration } from "./time";
import type { Action, Closure, Metrics, Network, SimResult } from "./types";

// ---------- Facts: every number the AI may cite, computed by the engine ----------

export type Unit = "pax" | "flights" | "min" | "paxmin" | "time" | "crews" | "aircraft" | "connections";
export interface Fact {
  value: number;
  unit: Unit;
  label: string; // plain-English description, shown on hover
}
export type Facts = Record<string, Fact>;

export type ScenarioLabel = "closure" | "plan" | "default";
const SCENARIO_NAME: Record<ScenarioLabel, string> = {
  closure: "after the storm, no recovery",
  plan: "with the recommended plan",
  default: "with the engine's default plan",
};

const METRIC_FACTS: [string, keyof Metrics, Unit, string][] = [
  ["stranded", "strandedPax", "pax", "passengers stranded"],
  ["cancelled", "cancelledFlights", "flights", "flights cancelled"],
  ["late", "lateFlights", "flights", "flights late"],
  ["delayedPax", "delayedPax", "pax", "passengers delayed"],
  ["paxDelayMinutes", "paxDelayMinutes", "paxmin", "passenger-minutes of delay"],
  ["totalDelay", "totalDelayMinutes", "min", "total minutes of flight delay"],
  ["brokenConnections", "brokenConnections", "connections", "connections broken"],
  ["crewBreaches", "crewBreaches", "crews", "crews that ran out of legal hours"],
  ["sparesUsed", "sparesUsed", "aircraft", "spare aircraft used"],
  ["outOfPosition", "outOfPosition", "aircraft", "aircraft away from their planned overnight airport"],
  ["absorbed", "absorbedMinutes", "min", "minutes of delay absorbed by turnaround buffers"],
];

export function buildFacts(
  net: Network,
  closures: Closure[],
  results: Partial<Record<ScenarioLabel, SimResult>>,
  extraRelevant: Iterable<string> = [],
): Facts {
  const facts: Facts = {};
  closures.forEach((c, i) => {
    const n = `storm${i + 1}`;
    facts[`${n}.start`] = { value: c.start, unit: "time", label: `${c.airport} closes` };
    facts[`${n}.end`] = { value: c.end, unit: "time", label: `${c.airport} reopens` };
    facts[`${n}.duration`] = { value: c.end - c.start, unit: "min", label: `${c.airport} closure length` };
  });
  facts["crew.maxDuty"] = { value: 600, unit: "min", label: "legal crew duty limit" };

  // Flights worth citing: anything late, cancelled, absorbing delay, or flown by a spare.
  const spareTails = new Set(net.spares.map((s) => s.tail));
  const relevant = new Set<string>(extraRelevant);
  for (const r of Object.values(results)) {
    if (!r) continue;
    for (const s of Object.values(r.flights))
      if (s.status !== "on_time" || s.absorbed > 0 || spareTails.has(s.tail)) relevant.add(s.id);
  }
  const byId = new Map(net.flights.map((f) => [f.id, f]));
  for (const id of relevant) {
    const f = byId.get(id)!;
    facts[`${id}.pax`] = { value: f.pax, unit: "pax", label: `passengers booked on ${id}` };
    facts[`${id}.schedDep`] = { value: f.dep, unit: "time", label: `${id} scheduled departure` };
    facts[`${id}.schedArr`] = { value: f.arr, unit: "time", label: `${id} scheduled arrival` };
  }
  for (const c of net.connections) {
    facts[`${c.id}.pax`] = { value: c.passengers, unit: "pax", label: `passengers connecting ${c.from} to ${c.to}` };
  }

  for (const [label, r] of Object.entries(results) as [ScenarioLabel, SimResult | undefined][]) {
    if (!r) continue;
    for (const [key, metric, unit, text] of METRIC_FACTS) {
      facts[`${label}.${key}`] = { value: r.metrics[metric], unit, label: `${text} ${SCENARIO_NAME[label]}` };
    }
    for (const id of relevant) {
      const s = r.flights[id];
      if (s.status === "cancelled") {
        // A cancelled flight never departs; only the crew-duty figure that cancelled it is citable.
        if (s.cause?.kind === "crew_duty" && s.dutyAtArrival !== undefined)
          facts[`${label}.${id}.duty`] = { value: s.dutyAtArrival, unit: "min", label: `crew minutes on duty had ${id} flown ${SCENARIO_NAME[label]}` };
        continue;
      }
      facts[`${label}.${id}.dep`] = { value: s.dep, unit: "time", label: `${id} departure ${SCENARIO_NAME[label]}` };
      facts[`${label}.${id}.arr`] = { value: s.arr, unit: "time", label: `${id} arrival ${SCENARIO_NAME[label]}` };
      facts[`${label}.${id}.delay`] = { value: s.delay, unit: "min", label: `${id} delay ${SCENARIO_NAME[label]}` };
      if (s.dutyAtArrival !== undefined)
        facts[`${label}.${id}.duty`] = { value: s.dutyAtArrival, unit: "min", label: `crew minutes on duty when ${id} lands ${SCENARIO_NAME[label]}` };
    }
  }
  return facts;
}

export function renderFact(f: Fact): string {
  switch (f.unit) {
    case "time":
      return fmt(f.value);
    case "min":
      return fmtDuration(f.value);
    case "paxmin":
      return f.value.toLocaleString("en-IN");
    default:
      return String(f.value);
  }
}

// ---------- Typed explanation segments ----------

export type EntityType = "flight" | "aircraft" | "crew" | "airport" | "connection";
export type Segment =
  | { k: "text"; text: string }
  | { k: "fact"; key: string }
  | { k: "entity"; type: EntityType; id: string }
  | { k: "compare"; left: string; op: "lt" | "gt" | "eq"; right: string };

export interface EntitySets {
  flight: Set<string>;
  aircraft: Set<string>;
  crew: Set<string>;
  airport: Set<string>;
  connection: Set<string>;
}

export function entitySets(net: Network): EntitySets {
  return {
    flight: new Set(net.flights.map((f) => f.id)),
    aircraft: new Set([...net.flights.map((f) => f.tail), ...net.spares.map((s) => s.tail)]),
    crew: new Set(net.crews.map((c) => c.id)),
    airport: new Set(net.airports.map((a) => a.id)),
    connection: new Set(net.connections.map((c) => c.id)),
  };
}

// Any Unicode number: digits in every script, superscripts, fractions, circled and Roman numeral signs.
const DIGITS = /\p{N}/u;
const NUMBER_WORDS = new RegExp(
  "\\b(" +
    [
      "zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen",
      "twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|tens|twenties|thirties|forties|fifties|sixties|seventies|eighties|nineties",
      "hundred|hundreds|thousand|thousands|million|millions|billion|billions|lakh|lakhs|crore|crores",
      "first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|twentieth|hundredth",
      "dozen|dozens|half|halves|halved|double|doubled|twice|triple|tripled|thrice|quadruple|quarter|quarters|percent|per cent|\\w+fold",
      "single|both|couple|pair|pairs|none|several|majority|minority",
    ].join("|") +
    ")\\b",
  "i",
);
// Upper-case Roman numerals of two or more letters (a lone "I" is the pronoun).
const ROMAN = /\b(?=[MDCLXVI]{2,}\b)M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})\b/;
// Comparative claims must be backed by a checked compare segment.
const COMPARATIVE = /\b(fewer|more|less|lower|higher|greater|smaller|larger|reduces?|reduced|increases?|increased|cuts?|saves?|saved|worse|better)\b/i;

const MAX_SEGMENTS = 48;
const MAX_TEXT = 320;

export type Validation = { ok: true } | { ok: false; errors: string[] };

/**
 * Every number in an explanation must come from the engine. Text may not contain digits, number
 * words or Roman numerals; comparisons are checked claims between facts of the same unit.
 * Error messages never quote the AI's text, so they are safe to log or return to the model.
 */
export function validateSegments(segs: Segment[], facts: Facts, ents: EntitySets): Validation {
  const errors: string[] = [];
  if (!Array.isArray(segs) || segs.length === 0) return { ok: false, errors: ["Explanation is empty."] };
  if (segs.length > MAX_SEGMENTS) return { ok: false, errors: [`Explanation has more than ${MAX_SEGMENTS} segments; keep it to a few sentences.`] };
  const hasCompare = segs.some((s) => s.k === "compare");
  segs.forEach((s, i) => {
    switch (s.k) {
      case "text":
        if (typeof s.text !== "string") errors.push(`Segment ${i}: text missing.`);
        else if (s.text.length > MAX_TEXT) errors.push(`Segment ${i}: text is too long.`);
        else if (DIGITS.test(s.text)) errors.push(`Segment ${i}: text contains a digit or numeral. Use a fact or entity segment instead.`);
        else if (NUMBER_WORDS.test(s.text) || ROMAN.test(s.text))
          errors.push(`Segment ${i}: text contains a number word. Use a fact segment instead.`);
        else if (COMPARATIVE.test(s.text) && !hasCompare)
          errors.push(`Segment ${i}: text makes a comparison; back it with a compare segment.`);
        break;
      case "fact":
        if (!(s.key in facts)) errors.push(`Segment ${i}: unknown fact key "${s.key}".`);
        break;
      case "entity":
        if (!ents[s.type]?.has(s.id)) errors.push(`Segment ${i}: unknown ${s.type} "${s.id}".`);
        break;
      case "compare": {
        const l = facts[s.left];
        const r = facts[s.right];
        if (!l || !r) errors.push(`Segment ${i}: comparison uses an unknown fact key.`);
        else if (l.unit !== r.unit) errors.push(`Segment ${i}: comparison mixes different kinds of number.`);
        else {
          const holds = s.op === "lt" ? l.value < r.value : s.op === "gt" ? l.value > r.value : l.value === r.value;
          if (!holds) errors.push(`Segment ${i}: the claim ${s.left} ${s.op} ${s.right} is false.`);
        }
        break;
      }
      default:
        errors.push(`Segment ${i}: unknown segment kind.`);
    }
  });
  return errors.length ? { ok: false, errors } : { ok: true };
}

// ---------- Offline dispatcher text (same structure as the AI's) ----------

const T = (text: string): Segment => ({ k: "text", text });
const F = (key: string): Segment => ({ k: "fact", key });
const E = (type: EntityType, id: string): Segment => ({ k: "entity", type, id });

export function describeAction(net: Network, a: Action): Segment[] {
  switch (a.kind) {
    case "swap":
      return [T("Spare aircraft "), E("aircraft", a.spare), T(" takes over "), E("flight", a.flight), T(" and the rest of that aircraft's day")];
    case "cancelPair":
      return [T("Cancel the out-and-back pair "), E("flight", a.out), T(" and "), E("flight", a.back)];
    case "hold": {
      const c = net.connections.find((x) => x.id === a.connection)!;
      return [T("Hold "), E("flight", c.to), T(" for the "), F(`${c.id}.pax`), T(" passengers connecting from "), E("flight", c.from)];
    }
  }
}

export function offlineExplanation(net: Network, plan: Plan, priority: Priority): Segment[] {
  const segs: Segment[] = [];
  segs.push(T("Priority: " + PRIORITY_LABEL[priority].toLowerCase() + ". "));
  if (plan.actions.length === 0) {
    segs.push(T("No recovery move improves on doing nothing under this priority. The storm leaves "), F("closure.stranded"), T(" passengers stranded."));
    return segs;
  }
  plan.actions.forEach((a, i) => {
    segs.push(...describeAction(net, a));
    segs.push(T(i < plan.actions.length - 1 ? ". " : "."));
  });
  segs.push(T(" Stranded passengers go from "), F("closure.stranded"), T(" to "), F("plan.stranded"));
  segs.push(T(", cancelled flights from "), F("closure.cancelled"), T(" to "), F("plan.cancelled"));
  segs.push(T(", and passenger delay from "), F("closure.paxDelayMinutes"), T(" to "), F("plan.paxDelayMinutes"), T(" passenger-minutes."));
  return segs;
}

/** Short name of the scenario a fact key belongs to, for rendering comparisons. */
export function scenarioOfKey(key: string): string {
  const head = key.split(".")[0];
  return head === "closure" ? "no recovery" : head === "plan" ? "this plan" : head === "default" ? "engine default" : head;
}

export function planLabel(actions: Action[]): string {
  return actions.length ? actions.map(actionId).join(" + ") : "Do nothing";
}
