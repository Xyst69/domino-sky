import type { Minutes } from "./types";

/** "08:50" -> 530. Throws on malformed input. */
export function parseHHMM(s: string): Minutes {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) throw new Error(`Bad time "${s}"`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 47 || min > 59) throw new Error(`Bad time "${s}"`);
  return h * 60 + min;
}

/** 530 -> "08:50"; 1450 -> "00:10 +1d". */
export function fmt(t: Minutes): string {
  const day = Math.floor(t / 1440);
  const r = ((t % 1440) + 1440) % 1440;
  const h = Math.floor(r / 60);
  const m = r % 60;
  const s = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  return day > 0 ? `${s} +${day}d` : s;
}

/** 95 -> "1 h 35 min", 20 -> "20 min" */
export function fmtDuration(mins: Minutes): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}
