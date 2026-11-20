import type { ScheduleIndex } from "./dataset";
import type { Action, ConnectionState, FlightState, Metrics, Minutes, Network } from "./types";

export function evaluateConnections(net: Network, states: Record<string, FlightState>): Record<string, ConnectionState> {
  const out: Record<string, ConnectionState> = {};
  for (const c of net.connections) {
    const a = states[c.from];
    const b = states[c.to];
    const aCan = a.status === "cancelled";
    const bCan = b.status === "cancelled";
    if (aCan && bCan) out[c.id] = { id: c.id, made: false, reason: "both_cancelled", slack: 0 };
    else if (aCan) out[c.id] = { id: c.id, made: false, reason: "inbound_cancelled", slack: 0 };
    else if (bCan) out[c.id] = { id: c.id, made: false, reason: "onward_cancelled", slack: 0 };
    else {
      const slack = b.dep - a.arr - c.minConnect;
      out[c.id] = { id: c.id, made: slack >= 0, reason: slack >= 0 ? "ok" : "too_short", slack };
    }
  }
  return out;
}

export function computeMetrics(
  net: Network,
  states: Record<string, FlightState>,
  conns: Record<string, ConnectionState>,
  actions: Action[],
  index: ScheduleIndex,
): Metrics {
  const byId = index.flights;
  let late = 0;
  let cancelled = 0;
  let totalDelay = 0;
  let paxDelay = 0;
  let strandedOnCancelled = 0;
  let delayedPax = 0;
  let absorbed = 0;
  const breachedCrews = new Set<string>();

  for (const s of Object.values(states)) {
    const f = byId.get(s.id)!;
    absorbed += s.absorbed;
    if (s.status === "cancelled") {
      cancelled++;
      strandedOnCancelled += f.pax;
      if (s.cause?.kind === "crew_duty") breachedCrews.add(s.crew);
    } else if (s.status === "late") {
      late++;
      totalDelay += s.delay;
      paxDelay += s.delay * f.pax;
      delayedPax += f.pax;
    }
  }

  // Connecting passengers are already inside both flights' pax counts. Count each of them once,
  // by what happens to them in the end: stranded passengers are not also delayed, and a passenger
  // who completes a connection is judged on the arrival of their final flight only.
  let bothCancelled = 0;
  let brokenOperated = 0;
  let broken = 0;
  for (const c of net.connections) {
    const st = conns[c.id];
    const a = states[c.from];
    const b = states[c.to];
    const aLate = a.status === "late";
    const bLate = b.status === "late";
    const drop = (s: FlightState) => {
      delayedPax -= c.passengers;
      paxDelay -= c.passengers * s.delay;
    };
    if (!st.made) broken++;
    switch (st.reason) {
      case "ok": // reached the onward flight: only the final arrival counts
        if (aLate) drop(a);
        break;
      case "too_short": // stranded at the connecting airport
        brokenOperated += c.passengers;
        if (aLate) drop(a);
        if (bLate) drop(b);
        break;
      case "inbound_cancelled": // stranded at origin; not on the onward flight
        if (bLate) drop(b);
        break;
      case "onward_cancelled": // stranded at the connecting airport
        if (aLate) drop(a);
        break;
      case "both_cancelled":
        bothCancelled += c.passengers;
        break;
    }
  }
  const stranded = strandedOnCancelled - bothCancelled + brokenOperated;

  // Aircraft not at their planned overnight airport: each aircraft ends where its last flown leg landed.
  const usedSpares = new Set(actions.filter((a) => a.kind === "swap").map((a) => (a as { spare: string }).spare));
  const lastLeg = new Map<string, { at: Minutes; airport: string }>();
  for (const s of Object.values(states)) {
    if (s.status === "cancelled") continue;
    const cur = lastLeg.get(s.tail);
    if (!cur || s.arr > cur.at) lastLeg.set(s.tail, { at: s.arr, airport: byId.get(s.id)!.destination });
  }
  let outOfPosition = 0;
  for (const [tail, legs] of index.byTail) {
    const end = lastLeg.get(tail)?.airport ?? legs[0].origin;
    if (end !== legs[legs.length - 1].destination) outOfPosition++;
  }
  for (const s of net.spares) {
    const end = lastLeg.get(s.tail)?.airport ?? s.base;
    if (end !== s.base) outOfPosition++;
  }
  return {
    lateFlights: late,
    cancelledFlights: cancelled,
    totalDelayMinutes: totalDelay,
    paxDelayMinutes: paxDelay,
    strandedPax: stranded,
    delayedPax,
    brokenConnections: broken,
    crewBreaches: breachedCrews.size,
    sparesUsed: usedSpares.size,
    absorbedMinutes: absorbed,
    outOfPosition,
  };
}

/** True when no airport exceeds its hourly capacity in any rolling 60-minute window. */
export function checkCapacity(net: Network, states: Record<string, FlightState>, index: ScheduleIndex): boolean {
  const byId = index.flights;
  const moves = new Map<string, number[]>();
  for (const s of Object.values(states)) {
    if (s.status === "cancelled") continue;
    const f = byId.get(s.id)!;
    (moves.get(f.origin) ?? moves.set(f.origin, []).get(f.origin)!).push(s.dep);
    (moves.get(f.destination) ?? moves.set(f.destination, []).get(f.destination)!).push(s.arr);
  }
  for (const a of net.airports) {
    const t = (moves.get(a.id) ?? []).sort((x, y) => x - y);
    let lo = 0;
    for (let hi = 0; hi < t.length; hi++) {
      while (t[hi] - t[lo] >= 60) lo++;
      if (hi - lo + 1 > a.capacityPerHour) return false;
    }
  }
  return true;
}
