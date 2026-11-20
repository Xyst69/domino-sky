import { z } from "zod";
import raw from "../../data/dataset.json";
import { parseHHMM } from "./time";
import type { Network } from "./types";

const RawSchema = z.object({
  meta: z.object({
    min_turnaround_minutes: z.number(),
    seats_per_aircraft: z.number(),
  }),
  airports: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      city: z.string(),
      lat: z.number(),
      lng: z.number(),
      tier: z.enum(["mega_hub", "regional_hub", "spoke"]),
      capacity_per_hour: z.number(),
    }),
  ),
  flights: z.array(
    z.object({
      flight_id: z.string(),
      tail_id: z.string(),
      leg_order: z.number(),
      origin: z.string(),
      destination: z.string(),
      dep: z.string(),
      arr: z.string(),
      block_minutes: z.number(),
      pax: z.number(),
    }),
  ),
  connections: z.array(
    z.object({
      connection_id: z.string(),
      airport: z.string(),
      from_flight: z.string(),
      to_flight: z.string(),
      passengers: z.number(),
      min_connect_minutes: z.number(),
    }),
  ),
  crews: z.array(
    z.object({
      crew_id: z.string(),
      tail_id: z.string(),
      base: z.string(),
      duty_start: z.string(),
      max_duty_mins: z.number(),
      flight_ids: z.array(z.string()),
    }),
  ),
  spare_aircraft: z.array(
    z.object({
      tail_id: z.string(),
      base: z.string(),
      available_from: z.string(),
      seats: z.number(),
    }),
  ),
});

/** Parse and validate a raw dataset. Throws with a clear message if it is inconsistent. */
export function loadNetwork(input: unknown): Network {
  const d = RawSchema.parse(input);
  const net: Network = {
    minTurn: d.meta.min_turnaround_minutes,
    seats: d.meta.seats_per_aircraft,
    airports: d.airports.map((a) => ({
      id: a.id,
      name: a.name,
      city: a.city,
      lat: a.lat,
      lng: a.lng,
      tier: a.tier,
      capacityPerHour: a.capacity_per_hour,
    })),
    flights: d.flights.map((f) => ({
      id: f.flight_id,
      tail: f.tail_id,
      leg: f.leg_order,
      origin: f.origin,
      destination: f.destination,
      dep: parseHHMM(f.dep),
      arr: parseHHMM(f.arr),
      block: f.block_minutes,
      pax: f.pax,
    })),
    connections: d.connections.map((c) => ({
      id: c.connection_id,
      airport: c.airport,
      from: c.from_flight,
      to: c.to_flight,
      passengers: c.passengers,
      minConnect: c.min_connect_minutes,
    })),
    crews: d.crews.map((c) => ({
      id: c.crew_id,
      tail: c.tail_id,
      base: c.base,
      dutyStart: parseHHMM(c.duty_start),
      maxDuty: c.max_duty_mins,
      flights: c.flight_ids,
    })),
    spares: d.spare_aircraft.map((s) => ({
      tail: s.tail_id,
      base: s.base,
      availableFrom: parseHHMM(s.available_from),
      seats: s.seats,
    })),
  };
  validateNetwork(net);
  return net;
}

function validateNetwork(net: Network): void {
  const airports = new Set(net.airports.map((a) => a.id));
  const flights = new Map(net.flights.map((f) => [f.id, f]));
  const errors: string[] = [];
  for (const f of net.flights) {
    if (!airports.has(f.origin) || !airports.has(f.destination)) errors.push(`${f.id}: unknown airport`);
    if (f.arr - f.dep !== f.block) errors.push(`${f.id}: block time does not match dep/arr`);
    if (f.pax > net.seats) errors.push(`${f.id}: more passengers than seats`);
  }
  const byTail = groupByTail(net);
  for (const [tail, legs] of byTail) {
    for (let i = 1; i < legs.length; i++) {
      if (legs[i - 1].destination !== legs[i].origin) errors.push(`${tail}: leg ${legs[i].leg} does not start where leg ${legs[i - 1].leg} ended`);
      if (legs[i].dep - legs[i - 1].arr < net.minTurn) errors.push(`${tail}: leg ${legs[i].leg} turnaround below minimum`);
    }
  }
  for (const c of net.connections) {
    const a = flights.get(c.from);
    const b = flights.get(c.to);
    if (!a || !b) errors.push(`${c.id}: unknown flight`);
    else if (a.destination !== c.airport || b.origin !== c.airport) errors.push(`${c.id}: flights do not meet at ${c.airport}`);
  }
  for (const c of net.crews) {
    for (const id of c.flights) if (!flights.has(id)) errors.push(`${c.id}: unknown flight ${id}`);
  }
  if (errors.length) throw new Error(`Dataset failed validation:\n${errors.join("\n")}`);
}

export function groupByTail(net: Network): Map<string, Network["flights"]> {
  const m = new Map<string, Network["flights"]>();
  for (const f of net.flights) {
    if (!m.has(f.tail)) m.set(f.tail, []);
    m.get(f.tail)!.push(f);
  }
  for (const legs of m.values()) legs.sort((a, b) => a.leg - b.leg);
  return m;
}

export const NETWORK: Network = loadNetwork(raw);
