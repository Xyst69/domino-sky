"use client";
import { NETWORK, type ChainStep, type SimResult } from "@/engine";
import { describeStatus } from "./text";

const LINK_LABEL: Record<ChainStep["link"], string> = {
  storm: "Storm",
  aircraft: "Aircraft",
  crew: "Crew",
  passengers: "Passengers",
  dispatcher: "Dispatcher",
  spare: "Spare",
};

export function WhyChain({ steps, selected, onSelect, result }: { steps: ChainStep[]; selected: string | null; onSelect: (id: string) => void; result: SimResult }) {
  const f = selected ? NETWORK.flights.find((x) => x.id === selected) : undefined;
  const st = selected ? result.flights[selected]?.status : undefined;
  const heading = !selected
    ? "Why is this flight late?"
    : st === "cancelled"
      ? `Why was ${selected} cancelled?`
      : st === "late"
        ? `Why is ${selected} late?`
        : `${selected} is on time`;
  return (
    <section className="section" aria-labelledby="why-h">
      <h2 id="why-h">{heading}</h2>
      {!selected || !f ? (
        <p className="hint">Select any flight on the board or the map to trace its delay back to the storm.</p>
      ) : (
        <>
          <p className="hint" style={{ color: "var(--ink-2)" }}>
            {describeStatus(result.flights[selected], f)}
          </p>
          {steps.length > 1 || steps[0]?.link === "storm" ? (
            <ol className="chain">
              {steps.slice(-6).map((s, i) => (
                <li key={i} className={s.link === "storm" ? "storm" : ""}>
                  <span className="link-kind">{LINK_LABEL[s.link]}</span>
                  {s.flight && s.flight !== selected ? (
                    <>
                      <button className="flight-link" onClick={() => onSelect(s.flight!)}>
                        {s.flight}
                      </button>{" "}
                      {s.text.replace(new RegExp(`^${s.flight}\\s*`), "")}
                    </>
                  ) : (
                    s.text
                  )}
                </li>
              ))}
            </ol>
          ) : null}
        </>
      )}
    </section>
  );
}
