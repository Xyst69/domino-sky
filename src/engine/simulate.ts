import { groupByTail } from "./dataset";
import type {
  Action,
  Cause,
  Closure,
  ConnectionState,
  Crew,
  Flight,
  FlightState,
  Metrics,
  Minutes,
  Network,
  Scenario,
  SimResult,
} from "./types";

export const ENGINE_VERSION = "1.0.0";

/** Standby crew that comes with a spare aircraft: reports 45 min before its first departure. */
export const STANDBY_REPORT_MIN = 45;
/** Longest a dispatcher may hold a departure for connecting passengers. */
export const MAX_HOLD_MIN = 60;

interface Rotation {
  tail: string;
  legs: Flight[];
  crew: Crew | null; // null = standby crew of a spare
  ready: Minutes; // earliest time the aircraft can depart its first leg
}

function closureAt(closures: Closure[], airport: string, t: Minutes): Closure | undefined {
  // Half-open window [start, end): a departure exactly at reopening is allowed.
  return closures.find((c) => c.airport === airport && c.start <= t && t < c.end);
}

/** Build the aircraft rotations after applying swap actions. */
function buildRotations(net: Network, actions: Action[]): Rotation[] {
  const byTail = groupByTail(net);
  const crewByTail = new Map(net.crews.map((c) => [c.tail, c]));
  const rotations: Rotation[] = [];
  const moved = new Map<string, Flight[]>(); // spare tail -> legs it takes over
  const cutAt = new Map<string, number>(); // tail -> index where its legs move to a spare

  for (const a of actions) {
    if (a.kind !== "swap") continue;
    const f = net.flights.find((x) => x.id === a.flight);
    if (!f) throw new Error(`Unknown flight ${a.flight}`);
    const legs = byTail.get(f.tail)!;
    const idx = legs.findIndex((x) => x.id === f.id);
    cutAt.set(f.tail, idx);
    moved.set(a.spare, legs.slice(idx));
  }

  for (const [tail, legs] of byTail) {
    const cut = cutAt.get(tail);
    rotations.push({
      tail,
      legs: cut === undefined ? legs : legs.slice(0, cut),
      crew: crewByTail.get(tail) ?? null,
      ready: -Infinity,
    });
  }
  for (const s of net.spares) {
    const legs = moved.get(s.tail);
    if (legs) rotations.push({ tail: s.tail, legs, crew: null, ready: s.availableFrom });
  }
  return rotations;
}

/**
 * Run the day. Deterministic: the same network and scenario always give the same result.
 * Flights never wait for connecting passengers unless a "hold" action says so.
 */
export function simulate(net: Network, scenario: Scenario): SimResult {
  const { closures, actions } = scenario;
  const rotations = buildRotations(net, actions);
  const dispatcherCancelled = new Set<string>();
  for (const a of actions) if (a.kind === "cancelPair") {
    dispatcherCancelled.add(a.out);
    dispatcherCancelled.add(a.back);
  }
  const holds = new Map<string, string[]>(); // onward flight -> connection ids held for it
  for (const a of actions) if (a.kind === "hold") {
    const c = net.connections.find((x) => x.id === a.connection);
    if (!c) throw new Error(`Unknown connection ${a.connection}`);
    holds.set(c.to, [...(holds.get(c.to) ?? []), c.id]);
  }

  // Holds create the only links between rotations, so iterate to a fixed point.
  let states: Record<string, FlightState> = {};
  for (let pass = 0; pass < 6; pass++) {
    const next = runRotations(net, rotations, closures, dispatcherCancelled, holds, states);
    const stable = pass > 0 && JSON.stringify(next) === JSON.stringify(states);
    states = next;
    if (stable || holds.size === 0) break;
  }

  assignWaves(net, states);
  const connections = evaluateConnections(net, states);
  const metrics = computeMetrics(net, states, connections, actions, rotations);
  const maxWave = Math.max(-1, ...Object.values(states).map((s) => s.wave));
  return { flights: states, connections, metrics, maxWave, capacityOk: checkCapacity(net, states) };
}

function runRotations(
  net: Network,
  rotations: Rotation[],
  closures: Closure[],
  dispatcherCancelled: Set<string>,
  holds: Map<string, string[]>,
  previous: Record<string, FlightState>,
): Record<string, FlightState> {
  const states: Record<string, FlightState> = {};
  const connById = new Map(net.connections.map((c) => [c.id, c]));

  for (const rot of rotations) {
    let prevArr: Minutes | undefined;
    let prevLeg: Flight | undefined;
    let crewCancelledAt: string | undefined;
    let dutyStart: Minutes | undefined = rot.crew ? rot.crew.dutyStart : undefined;
    const maxDuty = rot.crew ? rot.crew.maxDuty : 600;
    const crewId = rot.crew ? rot.crew.id : `Standby crew (${rot.tail})`;

    for (const leg of rot.legs) {
      const base: Omit<FlightState, "status" | "cause"> = {
        id: leg.id,
        tail: rot.tail,
        crew: crewId,
        dep: leg.dep,
        arr: leg.arr,
        delay: 0,
        absorbed: 0,
        wave: -1,
      };

      if (dispatcherCancelled.has(leg.id)) {
        states[leg.id] = { ...base, status: "cancelled", cause: { kind: "dispatcher_cancel", minutes: 0 } };
        continue; // aircraft stays where it was: the pair returns it to the same airport
      }
      if (crewCancelledAt) {
        states[leg.id] = {
          ...base,
          status: "cancelled",
          cause: { kind: "chain", minutes: 0, sourceFlight: crewCancelledAt, detail: crewId },
        };
        continue;
      }

      // Earliest departure from schedule, aircraft rotation and spare availability.
      const rotReady = prevArr !== undefined ? prevArr + net.minTurn : -Infinity;
      let dep = Math.max(leg.dep, rotReady, rot.ready);
      let cause: Cause | null = null;
      if (dep > leg.dep) {
        cause =
          rotReady >= rot.ready
            ? { kind: "rotation", minutes: dep - leg.dep, sourceFlight: prevLeg?.id }
            : { kind: "spare_ready", minutes: dep - leg.dep };
      }

      // Turnaround slack that soaked up an inbound delay.
      let absorbed = 0;
      if (prevLeg && prevArr !== undefined) {
        const incoming = prevArr - prevLeg.arr;
        if (incoming > 0) {
          const slack = Math.max(0, leg.dep - (prevLeg.arr + net.minTurn));
          absorbed = Math.min(incoming, slack);
        }
      }

      // Dispatcher hold for connecting passengers (capped).
      const held = holds.get(leg.id);
      if (held) {
        let target = dep;
        let heldFor: string | undefined;
        for (const cid of held) {
          const c = connById.get(cid)!;
          const inbound = previous[c.from];
          if (!inbound || inbound.status === "cancelled") continue;
          const need = inbound.arr + c.minConnect;
          if (need > target) {
            target = need;
            heldFor = cid;
          }
        }
        target = Math.min(target, dep + MAX_HOLD_MIN);
        if (target > dep) {
          dep = target;
          cause = { kind: "connection_hold", minutes: dep - leg.dep, detail: heldFor, sourceFlight: connById.get(heldFor!)!.from };
        }
      }

      // Closures: hold departures from a closed airport; hold at origin rather than arrive into one.
      for (let i = 0; i < 10; i++) {
        let changed = false;
        const atOrigin = closureAt(closures, leg.origin, dep);
        if (atOrigin) {
          dep = atOrigin.end;
          cause = { kind: "closure_departure", minutes: dep - leg.dep, airport: leg.origin };
          changed = true;
        }
        const arrival = dep + leg.block;
        const atDest = closureAt(closures, leg.destination, arrival);
        // A flight already airborne when the closure starts is allowed to land.
        if (atDest && dep >= atDest.start) {
          dep = atDest.end - leg.block;
          cause = { kind: "closure_arrival", minutes: dep - leg.dep, airport: leg.destination };
          changed = true;
        }
        if (!changed) break;
      }

      const arr = dep + leg.block;
      if (dutyStart === undefined) dutyStart = dep - STANDBY_REPORT_MIN;
      const duty = arr - dutyStart;

      if (duty > maxDuty) {
        crewCancelledAt = leg.id;
        states[leg.id] = {
          ...base,
          dep,
          arr,
          status: "cancelled",
          absorbed,
          dutyAtArrival: duty,
          cause: { kind: "crew_duty", minutes: duty - maxDuty, detail: crewId, sourceFlight: cause?.sourceFlight, airport: cause?.airport },
        };
        continue;
      }

      const delay = arr - leg.arr;
      states[leg.id] = {
        ...base,
        dep,
        arr,
        delay,
        status: delay > 0 ? "late" : "on_time",
        cause: delay > 0 ? cause : null,
        absorbed,
        dutyAtArrival: duty,
      };
      prevArr = arr;
      prevLeg = leg;
    }
  }
  return states;
}

/** Causal depth: 0 = hit directly by a closure, n = n steps downstream. */
function assignWaves(net: Network, states: Record<string, FlightState>): void {
  const memo = new Map<string, number>();
  const conn = new Map(net.connections.map((c) => [c.id, c]));
  const waveOf = (id: string, guard = 0): number => {
    if (memo.has(id)) return memo.get(id)!;
    const s = states[id];
    if (!s || !s.cause || guard > 100) return -1;
    let w = -1;
    const c = s.cause;
    switch (c.kind) {
      case "closure_departure":
      case "closure_arrival":
      case "spare_ready":
        w = 0;
        break;
      case "rotation":
        w = c.sourceFlight ? waveOf(c.sourceFlight, guard + 1) + 1 : 0;
        break;
      case "connection_hold": {
        const cx = c.detail ? conn.get(c.detail) : undefined;
        w = cx ? waveOf(cx.from, guard + 1) + 1 : 0;
        break;
      }
      case "crew_duty":
        if (c.airport) w = 1;
        else w = c.sourceFlight ? waveOf(c.sourceFlight, guard + 1) + 2 : 0;
        break;
      case "chain":
        w = c.sourceFlight ? waveOf(c.sourceFlight, guard + 1) + 1 : 0;
        break;
      case "dispatcher_cancel":
        w = -1;
        break;
    }
    memo.set(id, w);
    return w;
  };
  for (const id of Object.keys(states)) states[id].wave = waveOf(id);
}

function evaluateConnections(net: Network, states: Record<string, FlightState>): Record<string, ConnectionState> {
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

function computeMetrics(
  net: Network,
  states: Record<string, FlightState>,
  conns: Record<string, ConnectionState>,
  actions: Action[],
  rotations: Rotation[],
): Metrics {
  const byId = new Map(net.flights.map((f) => [f.id, f]));
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

  // Connecting passengers are already inside both flights' pax counts.
  let bothCancelled = 0;
  let brokenOperated = 0;
  let brokenOnLateInbound = 0;
  let broken = 0;
  for (const c of net.connections) {
    const st = conns[c.id];
    if (!st.made) broken++;
    if (st.reason === "both_cancelled") bothCancelled += c.passengers;
    if (st.reason === "too_short") {
      brokenOperated += c.passengers;
      if (states[c.from].status === "late") brokenOnLateInbound += c.passengers;
    }
  }
  const stranded = strandedOnCancelled - bothCancelled + brokenOperated;

  // Aircraft not where the plan expected them at the end of the day.
  const plannedEnd = new Map<string, string>();
  for (const [tail, legs] of groupByTail(net)) plannedEnd.set(tail, legs[legs.length - 1].destination);
  let outOfPosition = 0;
  const usedSpares = new Set(actions.filter((a) => a.kind === "swap").map((a) => (a as { spare: string }).spare));
  for (const rot of rotations) {
    if (rot.legs.length === 0 && !plannedEnd.has(rot.tail)) continue;
    let station = rot.legs.length ? rot.legs[0].origin : "";
    for (const leg of rot.legs) if (states[leg.id].status !== "cancelled") station = leg.destination;
    const spare = net.spares.find((s) => s.tail === rot.tail);
    const expected = spare ? spare.base : plannedEnd.get(rot.tail);
    if (rot.legs.length && station !== expected) outOfPosition++;
  }

  return {
    lateFlights: late,
    cancelledFlights: cancelled,
    totalDelayMinutes: totalDelay,
    paxDelayMinutes: paxDelay,
    strandedPax: stranded,
    delayedPax: delayedPax - brokenOnLateInbound,
    brokenConnections: broken,
    crewBreaches: breachedCrews.size,
    sparesUsed: usedSpares.size,
    absorbedMinutes: absorbed,
    outOfPosition,
  };
}

/** True when no airport exceeds its hourly capacity in any rolling 60-minute window. */
function checkCapacity(net: Network, states: Record<string, FlightState>): boolean {
  const byId = new Map(net.flights.map((f) => [f.id, f]));
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
