import { groupByTail } from "./dataset";
import { simulate } from "./simulate";
import type { Action, Closure, Metrics, Network, SimResult } from "./types";

// ---------- Action IDs (stable, built from content) ----------

export function actionId(a: Action): string {
  switch (a.kind) {
    case "swap":
      return `SWAP:${a.spare}:${a.flight}`;
    case "cancelPair":
      return `CANCEL:${a.out}+${a.back}`;
    case "hold":
      return `HOLD:${a.connection}`;
  }
}

export function parseActionId(id: string): Action | null {
  let m = /^SWAP:([A-Z0-9-]+):([A-Z0-9]+)$/.exec(id);
  if (m) return { kind: "swap", spare: m[1], flight: m[2] };
  m = /^CANCEL:([A-Z0-9]+)\+([A-Z0-9]+)$/.exec(id);
  if (m) return { kind: "cancelPair", out: m[1], back: m[2] };
  m = /^HOLD:([A-Z0-9]+)$/.exec(id);
  if (m) return { kind: "hold", connection: m[1] };
  return null;
}

// ---------- Feasibility ----------

export type Feasibility = { ok: true } | { ok: false; reason: string };

/** Check a plan for impossible or conflicting actions. Reasons are plain English for the UI and the AI. */
export function checkPlan(net: Network, actions: Action[]): Feasibility {
  const flights = new Map(net.flights.map((f) => [f.id, f]));
  const byTail = groupByTail(net);
  const usedSpares = new Set<string>();
  const swappedTails = new Map<string, number>(); // tail -> leg index taken over
  const cancelled = new Set<string>();
  const heldConnections = new Set<string>();
  const ids = new Set<string>();

  for (const a of actions) {
    const id = actionId(a);
    if (ids.has(id)) return { ok: false, reason: `${id} appears twice in the plan.` };
    ids.add(id);
  }

  for (const a of actions) {
    if (a.kind === "swap") {
      const spare = net.spares.find((s) => s.tail === a.spare);
      const f = flights.get(a.flight);
      if (!spare) return { ok: false, reason: `${a.spare} is not a spare aircraft.` };
      if (!f) return { ok: false, reason: `${a.flight} is not a flight in the schedule.` };
      if (usedSpares.has(a.spare)) return { ok: false, reason: `${a.spare} is used twice; a spare can take over only one aircraft's day.` };
      if (f.origin !== spare.base)
        return { ok: false, reason: `${a.spare} is based at ${spare.base} and cannot fly ${a.flight}, which departs ${f.origin}.` };
      if (swappedTails.has(f.tail)) return { ok: false, reason: `${f.tail} already has a spare taking over its flights.` };
      usedSpares.add(a.spare);
      swappedTails.set(f.tail, byTail.get(f.tail)!.findIndex((x) => x.id === f.id));
    }
  }
  for (const a of actions) {
    if (a.kind === "cancelPair") {
      const out = flights.get(a.out);
      const back = flights.get(a.back);
      if (!out || !back) return { ok: false, reason: `Unknown flight in ${actionId(a)}.` };
      if (out.tail !== back.tail || back.leg !== out.leg + 1 || out.destination !== back.origin || back.destination !== out.origin)
        return { ok: false, reason: `${a.out} and ${a.back} are not an out-and-back pair on one aircraft.` };
      const cut = swappedTails.get(out.tail);
      const idx = byTail.get(out.tail)!.findIndex((x) => x.id === out.id);
      if (cut !== undefined && idx + 1 >= cut)
        return { ok: false, reason: `${a.out}/${a.back} overlap the flights a spare takes over on ${out.tail}.` };
      cancelled.add(out.id);
      cancelled.add(back.id);
    }
  }
  for (const a of actions) {
    if (a.kind === "hold") {
      const c = net.connections.find((x) => x.id === a.connection);
      if (!c) return { ok: false, reason: `${a.connection} is not a passenger connection.` };
      if (heldConnections.has(c.id)) return { ok: false, reason: `${c.id} is held twice.` };
      if (cancelled.has(c.to) || cancelled.has(c.from))
        return { ok: false, reason: `${c.id} cannot be protected: one of its flights is cancelled in the same plan.` };
      heldConnections.add(c.id);
    }
  }
  return { ok: true };
}

// ---------- Candidates ----------

/** Single actions worth trying after a closure: limited to aircraft and connections the closure touched. */
export function candidateActions(net: Network, closures: Closure[], base: SimResult): Action[] {
  const byTail = groupByTail(net);
  const hit = (id: string) => base.flights[id].status !== "on_time";
  const out: Action[] = [];

  for (const [tail, legs] of byTail) {
    const anyHit = legs.some((f) => hit(f.id));
    if (!anyHit) continue;
    const firstHit = legs.findIndex((f) => hit(f.id));
    // A spare can take over at any leg leaving its base, from just before the first affected leg,
    // provided something later on this aircraft is affected. Closures at the base apply to the spare too.
    for (const s of net.spares) {
      legs.forEach((f, i) => {
        if (f.origin === s.base && i >= Math.max(0, firstHit - 1) && legs.slice(i).some((x) => hit(x.id)))
          out.push({ kind: "swap", spare: s.tail, flight: f.id });
      });
    }
    // Out-and-back pairs at or after the first affected leg.
    for (let i = 0; i + 1 < legs.length; i++) {
      const a = legs[i];
      const b = legs[i + 1];
      if (a.destination === b.origin && b.destination === a.origin && i + 1 >= firstHit - 1 && legs.slice(i).some((x) => hit(x.id)))
        out.push({ kind: "cancelPair", out: a.id, back: b.id });
    }
  }
  // Holds for connections the closure broke, when a short hold is enough.
  for (const c of net.connections) {
    const st = base.connections[c.id];
    if (st.reason === "too_short" && -st.slack <= 60) out.push({ kind: "hold", connection: c.id });
  }
  return out;
}

// ---------- Plans and the Pareto set ----------

export interface Plan {
  id: string; // action ids joined with " & ", or "NONE"
  actions: Action[];
  metrics: Metrics;
}

export type Priority = "passengers" | "cancellations" | "keep_spare" | "delay";

export const PRIORITY_LABEL: Record<Priority, string> = {
  passengers: "Protect passengers",
  cancellations: "Fewest cancellations",
  keep_spare: "Keep spare aircraft free",
  delay: "Least total delay",
};

const ORDER: Record<Priority, (keyof Metrics)[]> = {
  passengers: ["strandedPax", "paxDelayMinutes", "cancelledFlights", "sparesUsed", "outOfPosition"],
  cancellations: ["cancelledFlights", "strandedPax", "paxDelayMinutes", "sparesUsed", "outOfPosition"],
  keep_spare: ["sparesUsed", "strandedPax", "cancelledFlights", "paxDelayMinutes", "outOfPosition"],
  delay: ["paxDelayMinutes", "strandedPax", "cancelledFlights", "sparesUsed", "outOfPosition"],
};

/** The measures a plan is judged on (all: lower is better). */
export const MEASURES: (keyof Metrics)[] = [
  "strandedPax",
  "cancelledFlights",
  "paxDelayMinutes",
  "crewBreaches",
  "sparesUsed",
  "outOfPosition",
];

export function comparePlans(priority: Priority) {
  return (a: Plan, b: Plan): number => {
    for (const k of ORDER[priority]) if (a.metrics[k] !== b.metrics[k]) return a.metrics[k] - b.metrics[k];
    if (a.actions.length !== b.actions.length) return a.actions.length - b.actions.length;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };
}

function dominates(a: Metrics, b: Metrics): boolean {
  let strictly = false;
  for (const k of MEASURES) {
    if (a[k] > b[k]) return false;
    if (a[k] < b[k]) strictly = true;
  }
  return strictly;
}

export function planId(actions: Action[]): string {
  return actions.length ? actions.map(actionId).sort().join(" & ") : "NONE";
}

export interface RecoverySearch {
  base: SimResult;
  candidates: Action[];
  evaluated: number;
  frontier: Plan[]; // non-dominated plans, sorted by the engine's default order
}

/**
 * Try every single action, every compatible pair, and triples of the most useful singles.
 * Keep the plans no other plan beats on every measure.
 */
export function searchRecovery(net: Network, closures: Closure[], fixed: Action[] = []): RecoverySearch {
  const base = simulate(net, { closures, actions: fixed });
  const cands = candidateActions(net, closures, base);
  const plans: Plan[] = [{ id: planId([]), actions: [], metrics: base.metrics }];
  const tryPlan = (acts: Action[]) => {
    const all = [...fixed, ...acts];
    if (!checkPlan(net, all).ok) return;
    const r = simulate(net, { closures, actions: all });
    plans.push({ id: planId(acts), actions: acts, metrics: r.metrics });
  };
  for (const a of cands) tryPlan([a]);
  for (let i = 0; i < cands.length; i++) for (let j = i + 1; j < cands.length; j++) tryPlan([cands[i], cands[j]]);

  const singles = plans.filter((p) => p.actions.length === 1).sort(comparePlans("passengers")).slice(0, 10);
  for (let i = 0; i < singles.length; i++)
    for (let j = i + 1; j < singles.length; j++)
      for (let k = j + 1; k < singles.length; k++) tryPlan([singles[i].actions[0], singles[j].actions[0], singles[k].actions[0]]);

  // Remove duplicates (same id) then keep only non-dominated plans.
  const unique = [...new Map(plans.map((p) => [p.id, p])).values()];
  const frontier = unique.filter((p) => !unique.some((q) => q !== p && dominates(q.metrics, p.metrics)));
  // Among plans with identical measures keep the one with fewest actions.
  const byKey = new Map<string, Plan>();
  for (const p of frontier.sort(comparePlans("passengers"))) {
    const key = MEASURES.map((k) => p.metrics[k]).join("|");
    if (!byKey.has(key)) byKey.set(key, p);
  }
  return { base, candidates: cands, evaluated: unique.length, frontier: [...byKey.values()].sort(comparePlans("passengers")) };
}

export function pickPlan(frontier: Plan[], priority: Priority): Plan {
  return [...frontier].sort(comparePlans(priority))[0];
}
