"use client";

import { useMemo, useState } from "react";
import { NETWORK, PRESETS, fmt, simulate, type Closure, type Preset } from "@/engine";
import type { CrisisResponse } from "@/ai/contract";

const city = (id: string) => NETWORK.airports.find((a) => a.id === id)?.city ?? id;
const DURATIONS = [10, 20, 30, 45, 60, 75, 90, 110, 120, 150, 180, 240];
const TIMES: number[] = [];
for (let t = 300; t <= 23 * 60 + 55; t += 5) TIMES.push(t);

/** Scenario presets, each showing what it does before you click it. */
export function Presets({ presetId, onPreset }: { presetId: string | null; onPreset: (p: Preset) => void }) {
  const effects = useMemo(
    () =>
      Object.fromEntries(
        PRESETS.map((p) => {
          const m = simulate(NETWORK, { closures: p.closures, actions: [] }).metrics;
          return [p.id, `${m.cancelledFlights} cancelled, ${m.strandedPax} stranded`];
        }),
      ),
    [],
  );
  return (
    <section className="section" aria-labelledby="scenario-h">
      <h2 id="scenario-h">Scenarios</h2>
      <ul className="presets">
        {PRESETS.map((p) => (
          <li key={p.id}>
            <button className="preset" aria-pressed={presetId === p.id} onClick={() => onPreset(p)} aria-describedby={presetId === p.id ? "preset-blurb" : undefined}>
              <b>{p.name}</b>
              <span>{effects[p.id]}</span>
            </button>
          </li>
        ))}
      </ul>
      {presetId ? (
        <p className="hint" id="preset-blurb" style={{ marginTop: 8 }}>
          {PRESETS.find((p) => p.id === presetId)?.blurb}
        </p>
      ) : null}
    </section>
  );
}

/** Plain-English crisis → closures, previewed before they run. */
export function CrisisBox({ onRun }: { onRun: (c: Closure[]) => void }) {
  const [text, setText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<CrisisResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const read = async () => {
    setParsing(true);
    setError(null);
    setParsed(null);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20_000);
    try {
      const res = await fetch("/api/crisis", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }), signal: ctrl.signal });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "The crisis could not be read.");
      setParsed(body as CrisisResponse);
    } catch (e) {
      setError(ctrl.signal.aborted ? "Reading took too long. Try again, or set the storms by hand below." : (e as Error).message);
    } finally {
      clearTimeout(timer);
      setParsing(false);
    }
  };

  return (
    <section className="section" aria-labelledby="crisis-h">
      <h2 id="crisis-h">
        <label htmlFor="crisis">Describe a crisis</label>
      </h2>
      <textarea
        id="crisis"
        value={text}
        maxLength={500}
        placeholder="Fog at Delhi until 9, then a thunderstorm over Mumbai from 3 to 4:30"
        onChange={(e) => setText(e.target.value)}
      />
      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
        <button className="btn btn-small" onClick={read} disabled={parsing || text.trim().length < 3}>
          {parsing ? "Reading…" : "Turn into storms"}
        </button>
      </div>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {parsed ? (
        <div className="parsed" role="status">
          <div>
            {parsed.source === "ai" ? "Read by Gemini" : "Read by the built-in parser"}.{" "}
            {parsed.closures.length ? "Check the storms, then run them:" : "No storms found."}
          </div>
          {parsed.closures.length ? (
            <ul>
              {parsed.closures.map((c, i) => (
                <li key={i}>
                  {city(c.airport)} ({c.airport}) closed {fmt(c.start)}–{fmt(c.end)}
                </li>
              ))}
            </ul>
          ) : null}
          {parsed.notes.length ? <div className="hint">{parsed.notes.join(" ")}</div> : null}
          {parsed.closures.length ? (
            <button
              className="btn btn-small btn-primary"
              onClick={() => {
                onRun(parsed.closures);
                setParsed(null);
              }}
            >
              Run these storms
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** Exact closure editing: airport, closing time and length. */
export function ClosureEditor({ closures, onChange, defaultStart }: { closures: Closure[]; onChange: (c: Closure[]) => void; defaultStart: number }) {
  const update = (i: number, patch: Partial<Closure>) => onChange(closures.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const used = new Set(closures.map((c) => c.airport));
  const firstFree = NETWORK.airports.find((a) => !used.has(a.id))?.id ?? "DEL";

  return (
    <section className="section" aria-labelledby="closures-h">
      <h2 id="closures-h">Closed airports</h2>
      <p className="hint">
        {closures.length === 0 ? "No airport is closed. " : ""}On the map, click an airport to close it, drag a storm to move it, or drag its
        round handle to change how long it lasts.
      </p>
      {closures.map((c, i) => (
        <div className="storm-row" key={i}>
          <label className="field">
            Airport
            <select value={c.airport} onChange={(e) => update(i, { airport: e.target.value })}>
              {NETWORK.airports
                .filter((a) => a.id === c.airport || !used.has(a.id))
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.city} ({a.id})
                  </option>
                ))}
            </select>
          </label>
          <label className="field">
            Closes at (IST)
            <select value={c.start} onChange={(e) => update(i, { start: Number(e.target.value), end: Number(e.target.value) + (c.end - c.start) })}>
              {[...new Set([...TIMES, c.start])].sort((a, b) => a - b).map((t) => (
                <option key={t} value={t}>
                  {fmt(t)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            For
            <select value={c.end - c.start} onChange={(e) => update(i, { end: c.start + Number(e.target.value) })}>
              {[...new Set([...DURATIONS, c.end - c.start])].sort((a, b) => a - b).map((d) => (
                <option key={d} value={d}>
                  {d} min
                </option>
              ))}
            </select>
          </label>
          <button className="btn btn-small" onClick={() => onChange(closures.filter((_, j) => j !== i))} aria-label={`Reopen ${city(c.airport)}`}>
            Reopen
          </button>
        </div>
      ))}
      <button
        className="btn btn-small"
        disabled={closures.length >= 4}
        onClick={() => onChange([...closures, { airport: firstFree, start: defaultStart, end: defaultStart + 90 }])}
      >
        Close another airport
      </button>
    </section>
  );
}
