import { fmt } from "./time";
import type { Closure, Network, SimResult } from "./types";

export type LinkType = "storm" | "aircraft" | "crew" | "passengers" | "dispatcher" | "spare";

export interface ChainStep {
  flight?: string;
  link: LinkType;
  text: string; // plain English, uses the engine's numbers
}

/**
 * Walk the recorded causes back from a flight to the storm.
 * Returns steps ordered from the root cause to the selected flight.
 */
export function causeChain(net: Network, r: SimResult, closures: Closure[], flightId: string): ChainStep[] {
  const steps: ChainStep[] = [];
  const byId = new Map(net.flights.map((f) => [f.id, f]));
  const airportName = (id: string) => net.airports.find((a) => a.id === id)?.city ?? id;
  let id: string | undefined = flightId;
  const seen = new Set<string>();

  while (id && !seen.has(id)) {
    seen.add(id);
    const s = r.flights[id];
    const f = byId.get(id)!;
    const c = s.cause;
    if (!c) {
      steps.push({ flight: id, link: "aircraft", text: `${id} ${f.origin}→${f.destination} is on time.` });
      break;
    }
    switch (c.kind) {
      case "closure_departure": {
        const cl = closures.find((x) => x.airport === c.airport);
        steps.push({ flight: id, link: "aircraft", text: `${id} held at ${airportName(c.airport!)} until it reopened, leaving ${fmt(s.dep)} (+${c.minutes} min).` });
        if (cl) steps.push({ link: "storm", text: `${airportName(cl.airport)} (${cl.airport}) closed ${fmt(cl.start)}–${fmt(cl.end)}.` });
        id = undefined;
        break;
      }
      case "closure_arrival": {
        const cl = closures.find((x) => x.airport === c.airport);
        steps.push({ flight: id, link: "aircraft", text: `${id} waited at ${airportName(f.origin)} so it would not arrive at closed ${airportName(c.airport!)}; left ${fmt(s.dep)} (+${c.minutes} min).` });
        if (cl) steps.push({ link: "storm", text: `${airportName(cl.airport)} (${cl.airport}) closed ${fmt(cl.start)}–${fmt(cl.end)}.` });
        id = undefined;
        break;
      }
      case "rotation":
        steps.push({ flight: id, link: "aircraft", text: `${id} left ${fmt(s.dep)} (+${c.minutes} min): aircraft ${s.tail} arrived late on ${c.sourceFlight}.` });
        id = c.sourceFlight;
        break;
      case "spare_ready":
        steps.push({ flight: id, link: "spare", text: `${id} waited for spare ${s.tail} to become available (+${c.minutes} min).` });
        id = undefined;
        break;
      case "connection_hold":
        steps.push({ flight: id, link: "passengers", text: `${id} held ${c.minutes} min by the dispatcher for passengers arriving on ${c.sourceFlight}.` });
        id = c.sourceFlight;
        break;
      case "crew_duty":
        steps.push({
          flight: id,
          link: "crew",
          text: `${id} cancelled: crew ${s.crew} would reach ${s.dutyAtArrival} of ${s.dutyAtArrival! - c.minutes} legal duty minutes on landing at ${fmt(s.arr)}.`,
        });
        if (c.airport) {
          const cl = closures.find((x) => x.airport === c.airport);
          if (cl) steps.push({ link: "storm", text: `${airportName(cl.airport)} (${cl.airport}) closed ${fmt(cl.start)}–${fmt(cl.end)}.` });
          id = undefined;
        } else id = c.sourceFlight;
        break;
      case "chain":
        steps.push({ flight: id, link: "crew", text: `${id} cancelled: crew ${c.detail} ran out of legal hours earlier, on ${c.sourceFlight}.` });
        id = c.sourceFlight;
        break;
      case "dispatcher_cancel":
        steps.push({ flight: id, link: "dispatcher", text: `${id} cancelled by the dispatcher's recovery plan.` });
        id = undefined;
        break;
    }
  }
  return steps.reverse();
}
