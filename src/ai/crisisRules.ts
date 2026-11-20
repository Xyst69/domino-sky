// Rule-based crisis parser: the fallback when the AI is unavailable. Deterministic and offline.
import { NETWORK, type Closure } from "@/engine";

const ALIASES: Record<string, string> = {
  delhi: "DEL", "new delhi": "DEL", mumbai: "BOM", bombay: "BOM", bengaluru: "BLR", bangalore: "BLR",
  hyderabad: "HYD", chennai: "MAA", madras: "MAA", kolkata: "CCU", calcutta: "CCU", ahmedabad: "AMD",
  kochi: "COK", cochin: "COK", goa: "GOI", pune: "PNQ", jaipur: "JAI", guwahati: "GAU", lucknow: "LKO",
  chandigarh: "IXC", bhubaneswar: "BBI", trivandrum: "TRV", thiruvananthapuram: "TRV",
};

const TIME = String.raw`(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?`;

function toMinutes(h: string, m: string | undefined, mer: string | undefined): number {
  let hour = Number(h);
  const min = m ? Number(m) : 0;
  const pm = mer?.startsWith("p");
  const am = mer?.startsWith("a");
  if (pm && hour < 12) hour += 12;
  if (am && hour === 12) hour = 0;
  if (!mer && hour >= 1 && hour <= 4) hour += 12; // "3 to 4:30" means afternoon
  return hour * 60 + min;
}

function findAirports(clause: string): string[] {
  const found: string[] = [];
  const lower = clause.toLowerCase();
  for (const [name, code] of Object.entries(ALIASES)) if (new RegExp(`\\b${name}\\b`).test(lower)) found.push(code);
  for (const a of NETWORK.airports) if (new RegExp(`\\b${a.id}\\b`).test(clause)) found.push(a.id);
  return [...new Set(found)];
}

export function parseCrisisRules(text: string): { closures: Closure[]; notes: string[] } {
  const closures: Closure[] = [];
  const notes: string[] = [];
  const clauses = text.split(/[;.\n]|,\s*(?:and\s+)?|\band then\b|\bthen\b|\balso\b|\band\b(?=[^,]*\b(?:at|in|over)\b)/i).map((s) => s.trim()).filter(Boolean);

  for (const clause of clauses) {
    const airports = findAirports(clause);
    if (airports.length === 0) continue;
    let start: number | undefined;
    let end: number | undefined;
    const range = new RegExp(`(?:from\\s+)?${TIME}\\s*(?:to|till|until|-|–)\\s*${TIME}`, "i").exec(clause);
    const until = new RegExp(`(?:until|till|up to)\\s+${TIME}`, "i").exec(clause);
    const at = new RegExp(`(?:at|from|after)\\s+${TIME}`, "i").exec(clause);
    const dur = /for\s+(\d+(?:\.\d+)?)\s*(minutes?|mins?|hours?|hrs?|h)\b/i.exec(clause);
    if (range) {
      start = toMinutes(range[1], range[2], range[3] ?? range[6]);
      end = toMinutes(range[4], range[5], range[6]);
    } else if (until) {
      start = 300;
      end = toMinutes(until[1], until[2], until[3]);
    } else if (at) {
      start = toMinutes(at[1], at[2], at[3]);
    }
    if (start !== undefined && end === undefined) {
      const mins = dur ? Math.round(Number(dur[1]) * (/^h/i.test(dur[2]) ? 60 : 1)) : 90;
      end = start + mins;
    }
    if (start === undefined || end === undefined || end <= start) {
      notes.push(`Could not find a time window in "${clause}".`);
      continue;
    }
    for (const airport of airports) closures.push({ airport, start, end });
  }
  if (closures.length === 0 && notes.length === 0) notes.push("No known airport was mentioned.");
  return { closures: closures.slice(0, 4), notes };
}
