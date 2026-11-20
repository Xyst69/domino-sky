"use client";

import { useEffect, useMemo, useRef } from "react";
import { NETWORK, fmt, groupByTail, type Action, type Closure, type FlightState, type SimResult } from "@/engine";
import { describeStatus } from "./text";

interface Props {
  base: SimResult; // storm, no recovery
  live: SimResult; // storm + applied recovery
  closures: Closure[];
  applied: Action[];
  clock: number;
  selected: string | null;
  pathFlights: Set<string>;
  revealWave: number | null;
  onSelect: (id: string) => void;
  dayStart: number;
  dayEnd: number;
}

const BY_ID = new Map(NETWORK.flights.map((f) => [f.id, f]));
const CREW_BY_TAIL = new Map(NETWORK.crews.map((c) => [c.tail, c]));
const TAILS = [...groupByTail(NETWORK).keys()];

export function Board({ base, live, closures, applied, clock, selected, pathFlights, revealWave, onSelect, dayStart, dayEnd }: Props) {
  const span = dayEnd - dayStart;
  const scroller = useRef<HTMLDivElement>(null);

  // Keep the inspected flight in view on the board whenever it changes (from the map, the chain or the board).
  // Scrolls by the aircraft row (cancelled bars are drawn tilted, so their own box is not a reliable target),
  // keeping clear of the sticky time axis, and brings the bar into view horizontally.
  useEffect(() => {
    const sc = scroller.current;
    if (!selected || !sc) return;
    const bar = sc.querySelector<HTMLElement>(`[data-flight="${selected}"]`);
    const row = bar?.closest<HTMLElement>(".row");
    if (!bar || !row) return;
    const AXIS = 26;
    const PAD = 6;
    let top = sc.scrollTop;
    if (row.offsetTop - AXIS - PAD < sc.scrollTop) top = row.offsetTop - AXIS - PAD;
    else if (row.offsetTop + row.offsetHeight + PAD > sc.scrollTop + sc.clientHeight) top = row.offsetTop + row.offsetHeight + PAD - sc.clientHeight;
    const scRect = sc.getBoundingClientRect();
    const b = bar.getBoundingClientRect();
    const LABEL = 132;
    let left = sc.scrollLeft;
    if (b.left < scRect.left + LABEL) left -= scRect.left + LABEL - b.left + PAD;
    else if (b.right > scRect.right) left += b.right - scRect.right + PAD;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    sc.scrollTo({ top: Math.max(0, top), left: Math.max(0, left), behavior: reduced ? "auto" : "smooth" });
  }, [selected, live]);
  const pct = (t: number) => `${((Math.min(Math.max(t, dayStart), dayEnd) - dayStart) / span) * 100}%`;
  const width = (a: number, b: number) => `${((b - a) / span) * 100}%`;

  const rows = useMemo(() => {
    // Spares first: when a recovery uses one, the change is visible without scrolling.
    const r = new Map<string, FlightState[]>();
    for (const s of NETWORK.spares) r.set(s.tail, []);
    for (const t of TAILS) r.set(t, []);
    for (const s of Object.values(live.flights)) r.get(s.tail)!.push(s);
    return r;
  }, [live]);

  const ghostsByTail = useMemo(() => {
    const g = new Map<string, { id: string; dep: number; arr: number; kind: "before" | "sched" }[]>();
    for (const f of NETWORK.flights) {
      const now = live.flights[f.id];
      const was = base.flights[f.id];
      const list = g.get(f.tail) ?? [];
      if (applied.length && (was.status !== now.status || was.dep !== now.dep || was.tail !== now.tail) && was.status !== "on_time")
        list.push({ id: f.id, dep: was.dep, arr: was.arr, kind: "before" });
      else if (now.status === "late") list.push({ id: f.id, dep: f.dep, arr: f.arr, kind: "sched" });
      g.set(f.tail, list);
    }
    return g;
  }, [base, live, applied]);

  const ticks: number[] = [];
  for (let t = Math.ceil(dayStart / 60) * 60; t <= dayEnd; t += 60) ticks.push(t);

  const view = (s: FlightState) => {
    // During cascade playback, flights in later waves still show their schedule.
    if (revealWave !== null && (s.wave > revealWave || s.wave === -1 && s.status !== "on_time" && s.cause?.kind !== "dispatcher_cancel")) {
      const f = BY_ID.get(s.id)!;
      return { dep: f.dep, arr: f.arr, status: "on_time" as const, hidden: true };
    }
    return { dep: s.dep, arr: s.arr, status: s.status, hidden: false };
  };

  return (
    <section className="board" aria-label="Domino board: one track per aircraft">
      <div className="board-scroll" ref={scroller}>
      <div className="board-inner">
        <div className="axis">
          <div className="axis-label">Aircraft, crew</div>
          <div className="axis-track">
            {closures.map((c, i) => {
              const name = NETWORK.airports.find((a) => a.id === c.airport)?.city ?? c.airport;
              return (
                <span
                  key={`c${i}`}
                  className="axis-closure"
                  title={`${name} (${c.airport}) closed ${fmt(c.start)}–${fmt(c.end)} IST`}
                  style={{ left: pct(c.start), width: width(Math.max(c.start, dayStart), Math.min(c.end, dayEnd)) }}
                >
                  {c.airport} ✕
                </span>
              );
            })}
            {ticks.filter((t) => t % 120 === 0 && t < dayEnd).map((t) => (
              <span key={t} className="axis-tick" style={{ left: pct(t) }}>
                {fmt(t)}
              </span>
            ))}
          </div>
        </div>

        {[...rows.entries()].map(([tail, flights]) => {
          const spare = NETWORK.spares.find((s) => s.tail === tail);
          const crew = CREW_BY_TAIL.get(tail);
          return (
            <div key={tail} className={`row ${spare ? "spare-row" : ""}`}>
              <div className="row-label">
                <b>{tail}</b>
                <span>{spare ? `Spare at ${spare.base}${flights.length ? ", in use" : ", idle"}` : `Crew ${crew?.id}`}</span>
              </div>
              <div className="track">
                {ticks.map((t) => (
                  <div key={t} className="hour-line" style={{ left: pct(t) }} />
                ))}
                {closures.map((c, i) => (
                  <div key={i} className="closure-band" style={{ left: pct(c.start), width: width(Math.max(c.start, dayStart), Math.min(c.end, dayEnd)) }} />
                ))}
                {(ghostsByTail.get(tail) ?? []).map((g) => (
                  <div key={`g-${g.id}`} className={`ghost ${g.kind === "before" ? "before" : ""}`} style={{ left: pct(g.dep), width: width(g.dep, g.arr) }} />
                ))}
                {flights.map((s) => {
                  const f = BY_ID.get(s.id)!;
                  const v = view(s);
                  const cls = ["bar", v.status === "late" ? "late" : v.status === "cancelled" ? "cancelled" : "", selected === s.id ? "selected" : "", pathFlights.has(s.id) ? "on-path" : ""].join(" ");
                  const tag = v.hidden ? "" : v.status === "late" ? `+${s.delay}m` : v.status === "cancelled" ? "✕" : "";
                  return (
                    <button
                      key={s.id}
                      data-flight={s.id}
                      className={cls}
                      style={{ left: pct(v.dep), width: width(v.dep, v.arr) }}
                      onClick={() => onSelect(s.id)}
                      aria-label={v.hidden ? `${s.id}, not yet reached by the cascade` : describeStatus(s, f)}
                      aria-pressed={selected === s.id}
                      title={v.hidden ? s.id : describeStatus(s, f)}
                    >
                      {!v.hidden && s.absorbed > 0 && v.status === "on_time" ? <span className="absorbed" aria-hidden="true" /> : null}
                      <span>{s.id.replace(/^DS0?/, "")}</span>
                      {tag ? <span className="tag">{tag}</span> : null}
                    </button>
                  );
                })}
                <div className="now-line" style={{ left: pct(clock) }} />
              </div>
            </div>
          );
        })}
      </div>
      </div>
      <div className="board-legend" aria-hidden="true">
        <span>
          <i className="sw ok" /> On time
        </span>
        <span>
          <i className="legend-dot" /> Delay absorbed by the turnaround
        </span>
        <span>
          <i className="sw late" /> Late, with minutes
        </span>
        <span>
          <i className="sw cancelled" /> Cancelled ✕
        </span>
        <span>
          <i className="sw ghost-sw" /> Where it should have been
        </span>
        <span style={{ marginLeft: "auto", color: "var(--muted)" }}>Flight numbers without the DS prefix. Times IST. Shaded columns are closures.</span>
      </div>
    </section>
  );
}
