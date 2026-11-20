import { describe, expect, it } from "vitest";
import { parseCrisisRules } from "./crisisRules";

describe("rule-based crisis parser (AI fallback)", () => {
  it("reads two storms with city names and loose times", () => {
    const r = parseCrisisRules("Fog at Delhi until 9, thunderstorm over Mumbai 3 to 4:30");
    expect(r.closures).toEqual([
      { airport: "DEL", start: 300, end: 540 },
      { airport: "BOM", start: 900, end: 990 },
    ]);
  });
  it("reads a start and a duration", () => {
    const r = parseCrisisRules("Hyderabad closed from 11:30 for 2 hours");
    expect(r.closures).toEqual([{ airport: "HYD", start: 690, end: 810 }]);
  });
  it("uses old city names and am/pm", () => {
    const r = parseCrisisRules("Bombay shut 7am-8:30am");
    expect(r.closures).toEqual([{ airport: "BOM", start: 420, end: 510 }]);
  });
  it("explains what it could not read", () => {
    const r = parseCrisisRules("Snow in Srinagar");
    expect(r.closures).toHaveLength(0);
    expect(r.notes.length).toBeGreaterThan(0);
  });
});
