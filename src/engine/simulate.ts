import { indexSchedule, type ScheduleIndex } from "./dataset";
import { evaluateConnections, computeMetrics, checkCapacity } from "./metrics";
import type {
  Action,
  Cause,
  Closure,
  Crew,
  Flight,
  FlightState,
  Minutes,
  Network,
  Scenario,
  SimResult,
} from "./types";

/** Bump whenever a rule changes, so open pages from an older deployment get a clear "reload" message. */
export const ENGINE_VERSION = "1.1.0";

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

function closureAt(closures: Closure[], airport: string, t: Minutes): number {
  // Half-open window [start, end): a departure exactly at reopening is allowed.
  return closures.findIndex((c) => c.airport === airport && c.start <= t && t < c.end);
}

/** Build the aircraft rotations after applying swap actions. */
function buildRotations(net: Network, actions: Action[], index: ScheduleIndex): Rotation[] {
  const { byTail, crewByTail } = index;
  const rotations: Rotation[] = [];
  const moved = new Map<string, Flight[]>(); // spare tail -> legs it takes over
  const cutAt = new Map<string, number>(); // tail -> index where its legs move to a spare

  for (const a of actions) {
    if (a.kind !== "swap") continue;
    const f = index.flights.get(a.flight);
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
export function simulate(net: Network, scenario: Scenario, index = indexSchedule(net)): SimResult {
  const { closures, actions } = scenario;
  const rotations = buildRotations(net, actions, index);
  const dispatcherCancelled = new Set<string>();
  for (const a of actions) if (a.kind === "cancelPair") {
    dispatcherCancelled.add(a.out);
    dispatcherCancelled.add(a.back);
  }
  const holds = new Map<string, string[]>(); // onward flight -> connection ids held for it
  for (const a of actions) if (a.kind === "hold") {
    const c = index.connections.get(a.connection);
    if (!c) throw new Error(`Unknown connection ${a.connection}`);
    holds.set(c.to, [...(holds.get(c.to) ?? []), c.id]);
  }

  const feeders = actions.flatMap(a => a.kind === "hold" ? [index.connections.get(a.connection)!.from] : []);
  // Holds create the only links between rotations, so iterate to a fixed point.
  let states: Record<string, FlightState> = {};
  for (let pass = 0; pass < 6; pass++) {
    const next = runRotations(net, rotations, closures, dispatcherCancelled, holds, states, index);
    const stable = pass > 0 && feeders.every(id => next[id].arr === states[id].arr && next[id].status === states[id].status);
    states = next;
    if (stable || holds.size === 0) break;
  }

  assignWaves(index, states);
  const connections = evaluateConnections(net, states);
  const metrics = computeMetrics(net, states, connections, actions, index);
  const maxWave = Math.max(-1, ...Object.values(states).map((s) => s.wave));
  return { flights: states, connections, metrics, maxWave, capacityOk: index.capacityCannotBind || checkCapacity(net, states, index) };
}

function runRotations(
  net: Network,
  rotations: Rotation[],
  closures: Closure[],
  dispatcherCancelled: Set<string>,
  holds: Map<string, string[]>,
  previous: Record<string, FlightState>,
  index: ScheduleIndex,
): Record<string, FlightState> {
  const states: Record<string, FlightState> = {};
  const connById = index.connections;

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
        const o = closureAt(closures, leg.origin, dep);
        if (o >= 0) {
          dep = closures[o].end;
          cause = { kind: "closure_departure", minutes: dep - leg.dep, airport: leg.origin, closure: o };
          changed = true;
        }
        const arrival = dep + leg.block;
        const d = closureAt(closures, leg.destination, arrival);
        // A flight already airborne when the closure starts is allowed to land.
        if (d >= 0 && dep >= closures[d].start) {
          dep = closures[d].end - leg.block;
          cause = { kind: "closure_arrival", minutes: dep - leg.dep, airport: leg.destination, closure: d };
          changed = true;
        }
        if (!changed) break;
      }

      const arr = dep + leg.block;
      // A standby crew reports a fixed time before the scheduled departure of its first flight,
      // just as regular crews keep their published report time when flights run late.
      if (dutyStart === undefined) dutyStart = leg.dep - STANDBY_REPORT_MIN;
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
          cause: {
            kind: "crew_duty",
            minutes: duty - maxDuty,
            detail: crewId,
            sourceFlight: cause?.sourceFlight,
            airport: cause?.airport,
            closure: cause?.closure,
          },
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
function assignWaves(index: ScheduleIndex, states: Record<string, FlightState>): void {
  const memo = new Map<string, number>();
  const conn = index.connections;
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
        // Cancelled in the same step as the delay that broke the crew's limit.
        if (c.airport) w = 0;
        else w = c.sourceFlight ? waveOf(c.sourceFlight, guard + 1) + 1 : 0;
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
