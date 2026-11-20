"use client";
import { NETWORK, renderFact, scenarioOfKey, type Facts, type Segment } from "@/engine";

const NAME: Record<string, string> = Object.fromEntries(NETWORK.airports.map((a) => [a.id, `${a.city} (${a.id})`]));
const OP = { lt: "<", gt: ">", eq: "=" } as const;

/**
 * Renders typed segments as React text nodes (never as HTML).
 * Every number comes from the engine's facts; the AI only supplied keys.
 * Comparisons are worded by the app itself, with the direction and the scenario of each side.
 */
export function Explanation({ segments, facts }: { segments: Segment[]; facts: Facts }) {
  const show = (key: string) => {
    const f = facts[key];
    return f ? renderFact(f) : "?";
  };
  return (
    <p className="explanation">
      {segments.map((s, i) => {
        switch (s.k) {
          case "text":
            return <span key={i}>{s.text}</span>;
          case "fact": {
            const f = facts[s.key];
            return (
              <span key={i} className="fact" title={f ? `${f.label}. Computed by the engine (${s.key}).` : "Missing value"}>
                {show(s.key)}
              </span>
            );
          }
          case "entity":
            return (
              <span key={i} className="entity">
                {s.type === "airport" ? NAME[s.id] ?? s.id : s.id}
              </span>
            );
          case "compare":
            return (
              <span key={i} className="claim" title={`Checked by the engine: ${s.left} ${OP[s.op]} ${s.right}`}>
                {" "}
                ({scenarioOfKey(s.left)} {show(s.left)} {OP[s.op]} {scenarioOfKey(s.right)} {show(s.right)}, checked)
              </span>
            );
          default:
            return null;
        }
      })}
    </p>
  );
}
