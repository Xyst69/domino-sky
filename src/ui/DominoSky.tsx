"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NETWORK, PRESETS, causeChain, searchRecovery, simulate, type Action, type Closure, type Priority, type SimResult } from "@/engine";
import { MapView } from "./MapView";
import { Board } from "./Board";
import { ClockBar } from "./ClockBar";
import { ClosureEditor, CrisisBox, Presets } from "./ScenarioPanel";
import { ImpactPanel } from "./ImpactPanel";
import { WhyChain } from "./WhyChain";
import { Dispatcher } from "./Dispatcher";
import { Assumptions } from "./Assumptions";
import { Headline } from "./Headline";
import { usePrefersReducedMotion } from "./hooks";

interface Snapshot {
  closures: Closure[];
  applied: Action[];
  presetId: string | null;
}

const DAY_START = 330; // 05:30
const DAY_END = 1440; // 24:00
const DEP = new Map(NETWORK.flights.map((f) => [f.id, f.dep]));

/** The flight a judge most needs to see: the earliest cancellation, else the most delayed flight. */
function worstFlight(r: SimResult): string | null {
  const all = Object.values(r.flights);
  const cancelled = all.filter((s) => s.status === "cancelled" && s.cause?.kind !== "dispatcher_cancel").sort((a, b) => DEP.get(a.id)! - DEP.get(b.id)!);
  if (cancelled.length) return cancelled[0].id;
  const late = all.filter((s) => s.status === "late").sort((a, b) => b.delay - a.delay || DEP.get(a.id)! - DEP.get(b.id)!);
  return late[0]?.id ?? null;
}

export function DominoSky() {
  const first = PRESETS[0];
  const [state, setState] = useState<Snapshot>({ closures: first.closures, applied: [], presetId: first.id });
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [selected, setSelected] = useState<string | null>("DS0304");
  const [clock, setClock] = useState(16 * 60 + 10);
  const [playing, setPlaying] = useState(false);
  const [revealWave, setRevealWave] = useState<number | null>(null);
  const [priority, setPriority] = useState<Priority>("passengers");
  const reduced = usePrefersReducedMotion();

  const { closures, applied } = state;
  const base = useMemo(() => simulate(NETWORK, { closures, actions: [] }), [closures]);
  const live = useMemo(() => simulate(NETWORK, { closures, actions: applied }), [closures, applied]);
  const search = useMemo(() => searchRecovery(NETWORK, closures), [closures]);
  const chain = useMemo(() => (selected ? causeChain(NETWORK, live, closures, selected) : []), [selected, live, closures]);
  // The blue "cause path" is drawn only for a flight the storm actually affected.
  const pathFlights = useMemo(
    () => new Set(selected && live.flights[selected]?.status !== "on_time" ? (chain.map((s) => s.flight).filter(Boolean) as string[]) : []),
    [chain, live, selected],
  );

  // After any storm change, point the "why" panel at the flight that matters most.
  const lastClosures = useRef(closures);
  useEffect(() => {
    if (lastClosures.current === closures) return;
    lastClosures.current = closures;
    setSelected(worstFlight(base));
  }, [closures, base]);

  /** Every change goes through here so Undo restores the exact earlier state. */
  const commit = useCallback(
    (next: Snapshot) => {
      setHistory((h) => [...h.slice(-49), state]);
      setState(next);
      setRevealWave(null);
    },
    [state],
  );
  const setClosures = (c: Closure[], presetId: string | null = null) => commit({ closures: c, applied: [], presetId });
  const applyActions = (actions: Action[]) => commit({ ...state, applied: actions });
  const undo = () => {
    if (!history.length) return;
    setState(history[history.length - 1]);
    setHistory(history.slice(0, -1));
    setRevealWave(null);
  };
  const reset = () => commit({ closures: [], applied: [], presetId: null });

  // Cascade playback: reveal causal waves one at a time.
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopCascade = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setRevealWave(null);
  };
  const playCascade = () => {
    stopCascade();
    if (reduced || live.maxWave < 0) return;
    let w = -1;
    setRevealWave(-1);
    timer.current = setInterval(() => {
      w++;
      if (w > live.maxWave) stopCascade();
      else setRevealWave(w);
    }, 450);
  };
  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
  }, []);

  // Clock playback.
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setClock((t) => {
        if (t + 4 >= DAY_END) {
          setPlaying(false);
          return DAY_END;
        }
        return t + 4;
      });
    }, 50);
    return () => clearInterval(id);
  }, [playing]);

  // Keyboard: Ctrl/Cmd+Z undoes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const defaultStart = Math.max(300, Math.min(1320, Math.round(clock / 15) * 15));

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
            <rect x="2" y="5" width="6" height="14" rx="1.5" fill="#334155" />
            <rect x="9" y="5" width="6" height="14" rx="1.5" fill="#334155" transform="rotate(-14 12 19)" opacity="0.75" />
            <rect x="15" y="9" width="6" height="12" rx="1.5" fill="#B42318" transform="rotate(-48 18 21)" />
          </svg>
          Domino Sky
        </div>
        <Headline closures={closures} result={live} applied={applied.length > 0} />
        <div className="topbar-actions">
          <button className="btn btn-small" onClick={undo} disabled={!history.length} title="Undo (Ctrl+Z)">
            Undo
          </button>
          <button className="btn btn-small" onClick={reset} disabled={!closures.length && !applied.length}>
            Clear storms
          </button>
        </div>
      </header>

      <div className="workspace">
        <main className="main-col" aria-label="Network">
          <div className="top-row">
            <MapView
              closures={closures}
              result={live}
              clock={clock}
              selected={selected}
              pathFlights={pathFlights}
              onSelect={setSelected}
              onChangeClosures={(c) => setClosures(c)}
            />
            <div className="story">
              <WhyChain steps={chain} selected={selected} onSelect={setSelected} result={live} />
            </div>
            <div className="story">
              <ImpactPanel base={base} live={live} applied={applied.length > 0} hasStorm={closures.length > 0} />
            </div>
          </div>
          <ClockBar
            clock={clock}
            min={DAY_START}
            max={DAY_END}
            playing={playing}
            onClock={setClock}
            onPlay={() => setPlaying((p) => !p)}
            maxWave={live.maxWave}
            revealWave={revealWave}
            onPlayCascade={playCascade}
            onSkip={stopCascade}
          />
          <Board
            base={base}
            live={live}
            closures={closures}
            applied={applied}
            clock={clock}
            selected={selected}
            pathFlights={pathFlights}
            revealWave={revealWave}
            onSelect={setSelected}
            dayStart={DAY_START}
            dayEnd={DAY_END}
          />
        </main>

        <aside className="side-col" aria-label="Scenarios, dispatcher and controls">
          <Presets presetId={state.presetId} onPreset={(p) => setClosures(p.closures, p.id)} />
          <div className="side-impact">
            <ImpactPanel base={base} live={live} applied={applied.length > 0} hasStorm={closures.length > 0} />
          </div>
          <Dispatcher closures={closures} base={base} live={live} search={search} applied={applied} priority={priority} onPriority={setPriority} onApply={applyActions} />
          <CrisisBox onRun={(c) => setClosures(c)} />
          <ClosureEditor closures={closures} onChange={(c) => setClosures(c)} defaultStart={defaultStart} />
          <Assumptions />
        </aside>
      </div>
    </div>
  );
}
