"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  NETWORK,
  ENGINE_VERSION,
  PRIORITY_LABEL,
  actionId,
  buildFacts,
  checkPlan,
  normaliseClosures,
  parseActionId,
  pickPlan,
  scenarioHash,
  simulate,
  type Action,
  type Closure,
  type Facts,
  type Metrics,
  type Priority,
  type RecoverySearch,
  type Segment,
  type SimResult,
} from "@/engine";
import type { DispatchResponse } from "@/ai/contract";
import { Explanation } from "./Explanation";

interface Props {
  closures: Closure[];
  base: SimResult;
  live: SimResult;
  search: RecoverySearch;
  applied: Action[];
  priority: Priority;
  onPriority: (p: Priority) => void;
  onApply: (a: Action[]) => void;
}

const PRIORITIES: Priority[] = ["passengers", "cancellations", "keep_spare", "delay"];

function describe(a: Action): string {
  const f = (id: string) => NETWORK.flights.find((x) => x.id === id)!;
  switch (a.kind) {
    case "swap": {
      const x = f(a.flight);
      return `Spare ${a.spare} flies ${a.flight} ${x.origin}–${x.destination} and the rest of ${x.tail}'s day`;
    }
    case "cancelPair": {
      const o = f(a.out);
      return `Cancel ${a.out} and ${a.back} (${o.origin}–${o.destination} and back)`;
    }
    case "hold": {
      const c = NETWORK.connections.find((x) => x.id === a.connection)!;
      return `Hold ${c.to} for ${c.passengers} passengers from ${c.from}`;
    }
  }
}

const summary = (m: Pick<Metrics, "strandedPax" | "cancelledFlights" | "paxDelayMinutes" | "sparesUsed">) =>
  `${m.strandedPax.toLocaleString("en-IN")} stranded, ${m.cancelledFlights} cancelled, ${m.paxDelayMinutes.toLocaleString("en-IN")} passenger-minutes late, ${m.sparesUsed} spare${m.sparesUsed === 1 ? "" : "s"} used`;

function referencedKeys(segs: Segment[]): string[] {
  return segs.flatMap((s) => (s.k === "fact" ? [s.key] : s.k === "compare" ? [s.left, s.right] : []));
}

const samePlan = (a: string[], b: string[]) => [...a].sort().join("&") === [...b].sort().join("&");

export function Dispatcher({ closures, base, live, search, applied, priority, onPriority, onApply }: Props) {
  const [loading, setLoading] = useState(false);
  const [resp, setResp] = useState<DispatchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const hash = useMemo(() => scenarioHash(closures, priority, note), [closures, priority, note]);
  const currentHash = useRef(hash);
  currentHash.current = hash;

  // A new scenario, priority or note invalidates the previous answer.
  useEffect(() => {
    setResp((r) => (r && r.scenarioHash !== hash ? null : r));
    setError(null);
  }, [hash]);

  const defaultPlan = useMemo(() => (search.frontier.length ? pickPlan(search.frontier, priority) : null), [search, priority]);

  // Independent check in the browser: recompute every number the explanation cites.
  const verification = useMemo(() => {
    if (!resp || resp.scenarioHash !== hash) return null;
    const norm = normaliseClosures(closures);
    const planActs = resp.planActions.map((id) => parseActionId(id)!);
    const defActs = resp.defaultActions.map((id) => parseActionId(id)!);
    const mine: Facts = buildFacts(
      NETWORK,
      norm,
      { closure: simulate(NETWORK, { closures: norm, actions: [] }), plan: simulate(NETWORK, { closures: norm, actions: planActs }), default: simulate(NETWORK, { closures: norm, actions: defActs }) },
      NETWORK.flights.map((f) => f.id),
    );
    const keys = [...new Set(referencedKeys(resp.segments))];
    const mismatched = keys.filter((k) => !mine[k] || mine[k].value !== resp.facts[k]?.value);
    return { checked: keys.length, mismatched };
  }, [resp, closures, hash]);

  const ask = async () => {
    setLoading(true);
    setError(null);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 28_000);
    try {
      const res = await fetch("/api/dispatch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ engineVersion: ENGINE_VERSION, closures, priority, note, scenarioHash: hash }),
        signal: ctrl.signal,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "The dispatcher could not answer.");
      const r = body as DispatchResponse;
      // The server recomputes the scenario code; drop the answer if the storm changed while we waited.
      if (r.scenarioHash !== currentHash.current) return;
      setResp(r);
    } catch (e) {
      const msg = ctrl.signal.aborted ? "The dispatcher took too long." : (e as Error).message;
      setError(`${msg} The recovery moves below still work.`);
    } finally {
      clearTimeout(timer);
      setLoading(false);
    }
  };

  const shown = resp && resp.scenarioHash === hash ? resp : null;
  const planActions = shown?.planActions.map((id) => parseActionId(id)!) ?? [];
  const isApplied = (acts: Action[]) => acts.length === applied.length && acts.every((a) => applied.some((b) => actionId(b) === actionId(a)));

  const singles = useMemo(
    () =>
      search.candidates.map((a) => ({
        action: a,
        metrics: simulate(NETWORK, { closures, actions: [a] }).metrics,
      })),
    [search, closures],
  );

  if (!closures.length)
    return (
      <section className="section" aria-labelledby="disp-h">
        <h2 id="disp-h">Dispatcher</h2>
        <p className="hint">Close an airport first. The dispatcher then proposes how to recover.</p>
      </section>
    );

  return (
    <section className="section" aria-labelledby="disp-h">
      <h2 id="disp-h">Dispatcher</h2>
      {applied.length ? (
        <div className="applied-bar" role="status">
          <span>
            Recovery applied: stranded {base.metrics.strandedPax} → {live.metrics.strandedPax}, cancelled {base.metrics.cancelledFlights} → {live.metrics.cancelledFlights}.
          </span>
          <button className="btn btn-small" onClick={() => onApply([])}>
            Remove
          </button>
        </div>
      ) : null}

      <fieldset className="priorities">
        <legend className="hint" style={{ gridColumn: "1 / -1" }}>
          What matters most right now?
        </legend>
        {PRIORITIES.map((p) => (
          <label key={p}>
            <input type="radio" name="priority" value={p} checked={priority === p} onChange={() => onPriority(p)} />
            {PRIORITY_LABEL[p]}
          </label>
        ))}
      </fieldset>

      <label className="field" style={{ marginBottom: 10 }}>
        Anything else the dispatcher should respect? (optional)
        <input
          type="text"
          value={note}
          maxLength={160}
          placeholder="e.g., keep BLR spare free for evening"
          onChange={(e) => setNote(e.target.value)}
        />
      </label>

      <button className="btn btn-primary" onClick={ask} disabled={loading}>
        {loading ? "Dispatcher is weighing the options…" : "Ask the dispatcher"}
      </button>
      <p className="hint" style={{ marginTop: 6 }}>
        The engine tested {search.evaluated} plans. {search.frontier.length} of them are worth considering, because each is best on at least one measure. The AI
        weighs them against your priority and note, and can test its own combinations.
      </p>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      {shown ? (
        <div aria-live="polite">
          <span className={`source ${shown.source === "offline" ? "offline" : ""}`}>
            {shown.source === "ai" ? `Chosen by Gemini (${shown.model})` : "Engine's best plan (AI unavailable)"}
          </span>
          {shown.reason ? <p className="hint" style={{ marginTop: 6 }}>{shown.reason}</p> : null}

          <div className="plans">
            <div className="plan-card">
              <h4>Engine's default</h4>
              {defaultPlan && defaultPlan.actions.length ? (
                <ul>{defaultPlan.actions.map((a) => <li key={actionId(a)}>{describe(a)}</li>)}</ul>
              ) : (
                <p style={{ margin: "0 0 6px" }}>Do nothing</p>
              )}
              {defaultPlan ? <div className="nums">{summary(defaultPlan.metrics)}</div> : null}
            </div>
            <div className="plan-card chosen">
              <h4>Dispatcher's choice</h4>
              {planActions.length ? <ul>{planActions.map((a) => <li key={actionId(a)}>{describe(a)}</li>)}</ul> : <p style={{ margin: "0 0 6px" }}>Do nothing</p>}
              <div className="nums">{summary(simulate(NETWORK, { closures, actions: planActions }).metrics)}</div>
            </div>
          </div>
          {shown.source === "ai" ? (
            samePlan(shown.planActions, shown.defaultActions) ? (
              <p className="hint">The dispatcher agrees with the engine's default for this priority.</p>
            ) : (
              <p className="hint">The dispatcher chose differently from the engine's default; its reason is in the explanation below.</p>
            )
          ) : null}

          {shown.trail.length ? (
            <>
              <h3>Plans the AI tested</h3>
              <ol className="trail">
                {shown.trail.map((t, i) => (
                  <li key={i}>
                    {t.actions.length ? t.actions.join(" + ") : "Do nothing"}:{" "}
                    {t.error ? <span className="error">{t.error}</span> : t.metrics ? `${t.metrics.strandedPax} stranded, ${t.metrics.cancelledFlights} cancelled` : ""}
                  </li>
                ))}
              </ol>
            </>
          ) : null}

          <Explanation segments={shown.segments} facts={shown.facts} />
          {verification ? (
            <p className="verified">
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" style={{ flex: "none", marginTop: 2 }}>
                <circle cx="7" cy="7" r="6.2" fill="none" stroke={verification.mismatched.length ? "#B42318" : "#2E7D4F"} strokeWidth="1.5" />
                {verification.mismatched.length ? null : <path d="M4 7.2 6.2 9.3 10 5" fill="none" stroke="#2E7D4F" strokeWidth="1.6" />}
              </svg>
              {verification.mismatched.length
                ? `${verification.mismatched.length} number(s) did not match this browser's engine: ${verification.mismatched.join(", ")}.`
                : shown.source === "ai"
                  ? `All ${verification.checked} numbers above were computed by the engine on the server and re-checked by the same engine in your browser. The AI wrote none of them.`
                  : `All ${verification.checked} numbers above were computed by the engine on the server and re-checked by the same engine in your browser.`}
            </p>
          ) : null}
          <button className="btn btn-primary" onClick={() => onApply(planActions)} disabled={isApplied(planActions)}>
            {isApplied(planActions) ? "Plan applied" : "Apply this plan"}
          </button>
        </div>
      ) : null}

      <h3>Recovery moves</h3>
      {singles.length === 0 ? (
        <p className="hint">No single move improves this situation.</p>
      ) : (
        <ul className="moves">
          {singles.map(({ action, metrics }) => {
            const id = actionId(action);
            const on = applied.some((b) => actionId(b) === id);
            const next = on ? applied.filter((b) => actionId(b) !== id) : [...applied, action];
            const feasible = checkPlan(NETWORK, next).ok;
            return (
              <li key={id} className="move">
                <div>
                  {describe(action)}
                  <small>On its own: {summary(metrics)}</small>
                </div>
                <button className="btn btn-small" onClick={() => onApply(next)} disabled={!feasible} title={feasible ? undefined : checkPlan(NETWORK, next).ok ? "" : (checkPlan(NETWORK, next) as { reason: string }).reason}>
                  {on ? "Remove" : "Apply"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
