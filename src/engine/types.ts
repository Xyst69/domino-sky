// Core types for the Domino Sky engine.
// All times are whole minutes since 00:00 IST. Values may exceed 1440 (next day).

export type Minutes = number;

export interface Airport {
  id: string;
  name: string;
  city: string;
  lat: number;
  lng: number;
  tier: "mega_hub" | "regional_hub" | "spoke";
  capacityPerHour: number;
}

export interface Flight {
  id: string;
  tail: string;
  leg: number;
  origin: string;
  destination: string;
  dep: Minutes; // scheduled departure
  arr: Minutes; // scheduled arrival
  block: Minutes;
  pax: number;
}

export interface Connection {
  id: string;
  airport: string;
  from: string;
  to: string;
  passengers: number;
  minConnect: Minutes;
}

export interface Crew {
  id: string;
  tail: string;
  base: string;
  dutyStart: Minutes;
  maxDuty: Minutes;
  flights: string[];
}

export interface Spare {
  tail: string;
  base: string;
  availableFrom: Minutes;
  seats: number;
}

export interface Network {
  airports: Airport[];
  flights: Flight[];
  connections: Connection[];
  crews: Crew[];
  spares: Spare[];
  minTurn: Minutes;
  seats: number;
}

/** An airport closed for the half-open window [start, end). */
export interface Closure {
  airport: string;
  start: Minutes;
  end: Minutes;
}

export type Action =
  | { kind: "swap"; spare: string; flight: string }
  | { kind: "cancelPair"; out: string; back: string }
  | { kind: "hold"; connection: string };

export type CauseKind =
  | "closure_departure" // departure held because the origin airport was closed
  | "closure_arrival" // held at origin so it would not arrive while the destination was closed
  | "rotation" // its aircraft arrived late from the previous flight
  | "connection_hold" // dispatcher held it for connecting passengers
  | "spare_ready" // the spare aircraft was not available yet
  | "crew_duty" // cancelled: crew would exceed the duty limit
  | "chain" // cancelled: an earlier flight on the same aircraft was cancelled for crew hours
  | "dispatcher_cancel"; // cancelled by a recovery action

export interface Cause {
  kind: CauseKind;
  minutes: Minutes; // minutes this cause added (0 for cancellations)
  sourceFlight?: string; // previous flight in the chain, when relevant
  airport?: string; // closed airport, when relevant
  closure?: number; // index of the closure in the scenario, when relevant
  detail?: string; // e.g. crew id, connection id
}

export type FlightStatus = "on_time" | "late" | "cancelled";

export interface FlightState {
  id: string;
  tail: string; // aircraft actually flying it (may be a spare)
  crew: string; // crew actually flying it
  status: FlightStatus;
  dep: Minutes; // actual (or would-be) departure
  arr: Minutes;
  delay: Minutes; // arrival delay vs schedule, 0 when cancelled
  cause: Cause | null; // main reason it is late or cancelled
  absorbed: Minutes; // incoming lateness soaked up by turnaround slack
  wave: number; // causal depth from the closure (0 = hit directly); -1 if unaffected
  dutyAtArrival?: Minutes; // crew minutes on duty at this flight's arrival
}

export interface ConnectionState {
  id: string;
  made: boolean;
  reason: "ok" | "too_short" | "inbound_cancelled" | "onward_cancelled" | "both_cancelled";
  slack: Minutes; // onward dep - inbound arr - minConnect (when both operate)
}

export interface Metrics {
  lateFlights: number;
  cancelledFlights: number;
  totalDelayMinutes: number; // sum of arrival delays of operated flights
  paxDelayMinutes: number; // sum of pax x arrival delay on operated flights
  strandedPax: number;
  delayedPax: number; // pax on operated late flights
  brokenConnections: number;
  crewBreaches: number; // crews that would have exceeded duty (flights cancelled)
  sparesUsed: number;
  absorbedMinutes: number;
  outOfPosition: number; // aircraft not at their planned end-of-day airport
}

export interface SimResult {
  flights: Record<string, FlightState>;
  connections: Record<string, ConnectionState>;
  metrics: Metrics;
  maxWave: number;
  capacityOk: boolean;
}

export interface Scenario {
  closures: Closure[];
  actions: Action[];
}
