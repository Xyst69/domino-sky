import { ENGINE_VERSION } from "./simulate";
import type { Closure } from "./types";
import type { Priority } from "./recovery";

/** FNV-1a hash, stable across browser and server. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function normaliseClosures(closures: Closure[]): Closure[] {
  return [...closures]
    .map((c) => ({ airport: c.airport, start: c.start, end: c.end }))
    .sort((a, b) => (a.airport === b.airport ? a.start - b.start : a.airport < b.airport ? -1 : 1));
}

/** Identifies one dispatcher question: engine version + storms + priority + operator note. */
export function scenarioHash(closures: Closure[], priority: Priority, note = ""): string {
  return fnv1a(JSON.stringify({ v: ENGINE_VERSION, c: normaliseClosures(closures), p: priority, n: note.trim() }));
}

export interface Preset {
  id: string;
  name: string;
  blurb: string;
  closures: Closure[];
}

const h = (s: string) => {
  const [a, b] = s.split(":").map(Number);
  return a * 60 + b;
};

export const PRESETS: Preset[] = [
  {
    id: "crew-clock",
    name: "Mumbai afternoon storm",
    blurb:
      "A short closure in Mumbai cancels the evening Delhi–Kolkata flight hours later, because its crew runs out of legal hours. The dataset has no Bengaluru–Kolkata flight, so DS0304 Delhi–Kolkata plays that role in the organisers' example.",
    closures: [{ airport: "BOM", start: h("15:00"), end: h("16:30") }],
  },
  {
    id: "one-spare",
    name: "Delhi afternoon thunderstorm",
    blurb: "Two crews on two different aircraft run out of legal hours. There is only one spare at Delhi, so the dispatcher must choose which day to save.",
    closures: [{ airport: "DEL", start: h("15:00"), end: h("16:30") }],
  },
  {
    id: "hyderabad",
    name: "Hyderabad midday storm",
    blurb: "Connections break at Bengaluru and Hyderabad, and two crews time out. Every recovery trades stranded passengers against delay.",
    closures: [{ airport: "HYD", start: h("11:30"), end: h("13:30") }],
  },
  {
    id: "two-hubs",
    name: "Delhi fog, then Mumbai rain",
    blurb: "Two hubs close on the same morning. The Delhi fog breaks a connection at Mumbai, and the Mumbai rain then holds the morning departures there.",
    closures: [
      { airport: "DEL", start: h("06:00"), end: h("07:30") },
      { airport: "BOM", start: h("08:00"), end: h("09:00") },
    ],
  },
];
