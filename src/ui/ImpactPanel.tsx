"use client";
import type { Metrics, SimResult } from "@/engine";
import { fmtDuration } from "@/engine";

const ROWS: [keyof Metrics, string, (n: number) => string][] = [
  ["lateFlights", "Flights late", String],
  ["cancelledFlights", "Flights cancelled", String],
  ["strandedPax", "Passengers stranded", (n) => n.toLocaleString("en-IN")],
  ["brokenConnections", "Connections broken", String],
  ["crewBreaches", "Crews out of legal hours", String],
  ["totalDelayMinutes", "Total flight delay", (n) => (n ? fmtDuration(n) : "0")],
  ["paxDelayMinutes", "Passenger-minutes of delay", (n) => n.toLocaleString("en-IN")],
  ["delayedPax", "Passengers arriving late", (n) => n.toLocaleString("en-IN")],
  ["absorbedMinutes", "Delay soaked up by ground time", (n) => (n ? fmtDuration(n) : "0")],
];

export function ImpactPanel({ base, live, applied, hasStorm }: { base: SimResult; live: SimResult; applied: boolean; hasStorm: boolean }) {
  const m = live.metrics;
  return (
    <section className="section" aria-labelledby="impact-h">
      <h2 id="impact-h">Impact</h2>
      {!hasStorm ? (
        <p className="hint">With no storm, every flight runs to schedule and all 21 connections are made.</p>
      ) : (
        <>
          <p className="impact-sentence">
            <b>{m.strandedPax.toLocaleString("en-IN")}</b> passengers stranded. <b>{m.delayedPax.toLocaleString("en-IN")}</b> more reach their destination late.
            {m.absorbedMinutes > 0 ? (
              <>
                {" "}
                Spare ground time between flights soaked up <b>{fmtDuration(m.absorbedMinutes)}</b> of delay.
              </>
            ) : null}
          </p>
          <table className="compare">
            <thead>
              <tr>
                <th scope="col">Measure</th>
                <th scope="col">After storm</th>
                {applied ? <th scope="col">With recovery</th> : null}
                {applied ? <th scope="col">Change</th> : null}
              </tr>
            </thead>
            <tbody>
              {ROWS.map(([k, label, f]) => {
                const d = live.metrics[k] - base.metrics[k];
                const good = k === "absorbedMinutes" ? d > 0 : d < 0;
                return (
                  <tr key={k}>
                    <td>{label}</td>
                    <td>{f(base.metrics[k])}</td>
                    {applied ? <td>{f(live.metrics[k])}</td> : null}
                    {applied ? (
                      <td className={d === 0 ? "" : good ? "delta-down" : "delta-up"}>
                        {d === 0 ? "no change" : `${d > 0 ? "+" : "−"}${f(Math.abs(d))}`}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!live.capacityOk ? <p className="error">Warning: an airport exceeds its hourly capacity in this scenario.</p> : null}
        </>
      )}
    </section>
  );
}
