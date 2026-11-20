"use client";
import { NETWORK, fmt, type Closure, type SimResult } from "@/engine";

const city = (id: string) => NETWORK.airports.find((a) => a.id === id)?.city ?? id;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** One sentence that says what happened. Built from the engine's numbers. */
export function Headline({ closures, result, applied }: { closures: Closure[]; result: SimResult; applied: boolean }) {
  if (!closures.length)
    return (
      <p className="headline calm" aria-live="polite">
        Clear skies: all {NETWORK.flights.length} flights on time. Click any airport on the map to close it, or pick a scenario.
      </p>
    );
  const where = closures.map((c) => `${city(c.airport)} closed ${fmt(c.start)}–${fmt(c.end)}`).join(" and ");
  const m = result.metrics;
  return (
    <p className="headline" aria-live="polite">
      {where}
      {applied ? ", with recovery applied" : ""}: <strong>{plural(m.lateFlights, "flight", "flights")}</strong> late,{" "}
      <strong>{m.cancelledFlights}</strong> cancelled, <strong>{plural(m.strandedPax, "passenger", "passengers")}</strong> stranded
      {m.crewBreaches > 0 ? (
        <>
          , <strong>{plural(m.crewBreaches, "crew", "crews")}</strong> out of legal hours
        </>
      ) : null}
      .
    </p>
  );
}
