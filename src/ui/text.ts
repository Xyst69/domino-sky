import { NETWORK, fmt, type Flight, type FlightState } from "@/engine";

const city = (id: string) => NETWORK.airports.find((a) => a.id === id)?.city ?? id;

const REASON: Record<string, (s: FlightState) => string> = {
  closure_departure: (s) => `held at closed ${city(s.cause!.airport!)}`,
  closure_arrival: (s) => `held at its origin because ${city(s.cause!.airport!)} was closed`,
  rotation: (s) => `its aircraft arrived late on ${s.cause!.sourceFlight}`,
  connection_hold: (s) => `held for connecting passengers from ${s.cause!.sourceFlight}`,
  spare_ready: () => "waited for the spare aircraft",
  crew_duty: (s) => `crew ${s.crew} would reach ${s.dutyAtArrival} of ${s.dutyAtArrival! - s.cause!.minutes} legal duty minutes`,
  chain: (s) => `crew ran out of hours earlier on ${s.cause!.sourceFlight}`,
  dispatcher_cancel: () => "cancelled by the recovery plan",
};

/** Plain-English status line for a flight, used in tooltips and screen-reader labels. */
export function describeStatus(s: FlightState, f: Flight): string {
  const route = `${s.id} ${f.origin} to ${f.destination}`;
  if (s.status === "cancelled") return `${route}, cancelled: ${REASON[s.cause!.kind](s)}.`;
  if (s.status === "late") return `${route}, departs ${fmt(s.dep)}, ${s.delay} minutes late: ${REASON[s.cause!.kind](s)}.`;
  if (s.absorbed > 0) return `${route}, departs ${fmt(s.dep)}, on time: its turnaround absorbed ${s.absorbed} minutes of delay.`;
  return `${route}, departs ${fmt(s.dep)}, on time.`;
}
