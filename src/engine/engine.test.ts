import { describe, expect, it } from "vitest";
import { NETWORK } from "./dataset";
import { simulate } from "./simulate";
import { parseHHMM as t } from "./time";
import type { Closure, Scenario } from "./types";

const run = (closures: Closure[], actions: Scenario["actions"] = []) => simulate(NETWORK, { closures, actions });
const close = (airport: string, start: string, end: string): Closure => ({ airport, start: t(start), end: t(end) });

describe("dataset", () => {
  it("has the published shape", () => {
    expect(NETWORK.airports).toHaveLength(16);
    expect(NETWORK.flights).toHaveLength(70);
    expect(NETWORK.connections).toHaveLength(21);
    expect(NETWORK.crews).toHaveLength(16);
    expect(NETWORK.spares).toHaveLength(2);
  });
});

describe("baseline (no closure)", () => {
  const r = run([]);
  it("has no late or cancelled flights and makes every connection", () => {
    expect(r.metrics.lateFlights).toBe(0);
    expect(r.metrics.cancelledFlights).toBe(0);
    expect(r.metrics.strandedPax).toBe(0);
    expect(Object.values(r.connections).every((c) => c.made)).toBe(true);
  });
  it("keeps every crew legal; CR03 has exactly 10 minutes of slack", () => {
    expect(r.metrics.crewBreaches).toBe(0);
    expect(r.flights.DS0304.dutyAtArrival).toBe(590);
  });
  it("respects airport capacity", () => expect(r.capacityOk).toBe(true));
});

describe("flagship: Mumbai closed 15:00-16:30 (the crew clock)", () => {
  const r = run([close("BOM", "15:00", "16:30")]);
  it("lets DS0302, airborne at 15:00, land on time", () => {
    expect(r.flights.DS0302.status).toBe("on_time");
    expect(r.flights.DS0302.arr).toBe(t("15:35"));
  });
  it("holds DS0303 at Mumbai until reopening", () => {
    expect(r.flights.DS0303.dep).toBe(t("16:30"));
    expect(r.flights.DS0303.delay).toBe(20);
    expect(r.flights.DS0303.cause?.kind).toBe("closure_departure");
  });
  it("cancels DS0304 because crew CR03 would reach 605 of 600 minutes", () => {
    const s = r.flights.DS0304;
    expect(s.status).toBe("cancelled");
    expect(s.cause?.kind).toBe("crew_duty");
    expect(s.dutyAtArrival).toBe(605);
    expect(s.arr).toBe(t("21:35"));
  });
  it("strands 167 passengers, not 181 (CX19 connectors are already on board)", () => {
    expect(r.metrics.strandedPax).toBe(167);
    expect(r.metrics.cancelledFlights).toBe(1);
    expect(r.metrics.lateFlights).toBe(1);
    expect(r.metrics.crewBreaches).toBe(1);
  });
  it("recovers fully when spare VT-DS18 takes DS0304 from Delhi", () => {
    const fixed = run([close("BOM", "15:00", "16:30")], [{ kind: "swap", spare: "VT-DS18", flight: "DS0304" }]);
    expect(fixed.flights.DS0304.status).toBe("on_time");
    expect(fixed.flights.DS0304.tail).toBe("VT-DS18");
    expect(fixed.metrics.strandedPax).toBe(0);
    expect(fixed.metrics.sparesUsed).toBe(1);
  });
});

describe("flagship thresholds", () => {
  it("a 14:30-16:00 closure gives DS0303 no delay", () => {
    const r = run([close("BOM", "14:30", "16:00")]);
    expect(r.flights.DS0303.status).toBe("on_time");
    expect(r.flights.DS0304.status).toBe("on_time");
  });
  it("DS0303 15 minutes late is still legal; 16 minutes is not", () => {
    const ok = run([close("BOM", "16:00", "16:25")]);
    expect(ok.flights.DS0304.status).not.toBe("cancelled");
    expect(ok.flights.DS0304.dutyAtArrival).toBe(600);
    const bad = run([close("BOM", "16:00", "16:26")]);
    expect(bad.flights.DS0304.status).toBe("cancelled");
  });
});

describe("closure rules", () => {
  it("departure exactly at reopening is allowed (half-open window)", () => {
    const r = run([close("DEL", "07:00", "08:00")]);
    expect(r.flights.DS0101.dep).toBe(t("08:00"));
    expect(r.flights.DS0101.status).toBe("on_time");
  });
  it("does not hold departures that leave before the closure starts", () => {
    const r = run([close("DEL", "14:00", "15:00")]);
    expect(r.flights.DS0201.status).toBe("on_time");
  });
  it("holds a flight at its origin so it lands exactly at reopening", () => {
    // DS0102 JAI-DEL dep 09:25 arr 10:15. Close DEL 09:00-10:30: it would leave after the closure
    // started and arrive inside it, so it waits at Jaipur and lands exactly at 10:30.
    const r = run([close("DEL", "09:00", "10:30")]);
    expect(r.flights.DS0102.cause?.kind).toBe("closure_arrival");
    expect(r.flights.DS0102.arr).toBe(t("10:30"));
    expect(r.flights.DS0102.dep).toBe(t("09:40"));
  });
  it("lets a flight that is airborne when the closure starts land", () => {
    // DS1503 DEL-JAI dep 12:20 arr 13:10; JAI closes at 13:00 while it is in the air.
    const r = run([close("JAI", "13:00", "14:00")]);
    expect(r.flights.DS1503.status).toBe("on_time");
  });
});

describe("buffer absorption (judges' test 1)", () => {
  it("a short closure is absorbed by generous turnarounds; a long one cascades", () => {
    // DEL closed 06:00-06:20 delays DS0201 by 20 min; its 70-minute turn at BOM absorbs it.
    const small = run([close("DEL", "06:00", "06:20")]);
    expect(small.flights.DS0201.delay).toBe(20);
    expect(small.flights.DS0202.status).toBe("on_time");
    expect(small.flights.DS0202.absorbed).toBe(20);

    const big = run([close("DEL", "06:00", "07:50")]);
    expect(big.flights.DS0202.status).toBe("late");
    const lateOnTail = ["DS0201", "DS0202", "DS0203", "DS0204"].filter((id) => big.flights[id].status === "late");
    expect(lateOnTail.length).toBeGreaterThanOrEqual(3);
    expect(big.metrics.lateFlights).toBeGreaterThan(small.metrics.lateFlights);
  });
});

describe("hub vs spoke (judges' test 2)", () => {
  it("a Guwahati storm only touches aircraft that pass through Guwahati", () => {
    const r = run([close("GAU", "17:00", "19:00")]);
    const touched = new Set(
      NETWORK.flights.filter((f) => f.origin === "GAU" || f.destination === "GAU").map((f) => f.tail),
    );
    for (const s of Object.values(r.flights)) {
      if (s.status !== "on_time") expect(touched.has(NETWORK.flights.find((f) => f.id === s.id)!.tail)).toBe(true);
    }
    expect(r.metrics.lateFlights + r.metrics.cancelledFlights).toBeGreaterThan(0);
  });
  it("a Trivandrum storm leaves Delhi's aircraft untouched", () => {
    const r = run([close("TRV", "13:00", "14:30")]);
    for (const id of ["DS0101", "DS0201", "DS0901", "DS1101"]) expect(r.flights[id].status).toBe("on_time");
  });
});

describe("several storms at once", () => {
  it("Mumbai and Delhi together are at least as bad as either alone", () => {
    const a = run([close("BOM", "08:00", "09:30")]);
    const b = run([close("DEL", "08:00", "09:30")]);
    const both = run([close("BOM", "08:00", "09:30"), close("DEL", "08:00", "09:30")]);
    expect(both.metrics.lateFlights + both.metrics.cancelledFlights).toBeGreaterThanOrEqual(
      Math.max(a.metrics.lateFlights + a.metrics.cancelledFlights, b.metrics.lateFlights + b.metrics.cancelledFlights),
    );
  });
});

describe("recovery actions (judges' test 3)", () => {
  it("cancelling an out-and-back pair returns the aircraft to the same airport", () => {
    const r = run([], [{ kind: "cancelPair", out: "DS0502", back: "DS0503" }]);
    expect(r.flights.DS0502.status).toBe("cancelled");
    expect(r.flights.DS0503.status).toBe("cancelled");
    expect(r.flights.DS0504.status).toBe("on_time");
    expect(r.metrics.strandedPax).toBe(168 + 165 - 0);
  });
  it("a hold for connecting passengers saves the connection and delays the onward flight", () => {
    const closures = [close("CCU", "11:30", "12:10")]; // DS1101 leaves CCU late, CX14 breaks
    const before = run(closures);
    expect(before.connections.CX14.made).toBe(false);
    const after = run(closures, [{ kind: "hold", connection: "CX14" }]);
    expect(after.connections.CX14.made).toBe(true);
    expect(after.flights.DS0105.cause?.kind).toBe("connection_hold");
    expect(after.metrics.strandedPax).toBeLessThan(before.metrics.strandedPax);
  });
  it("is deterministic and reversible: the same input always gives the same output", () => {
    const sc: Closure[] = [close("HYD", "11:00", "12:15")];
    expect(JSON.stringify(run(sc))).toBe(JSON.stringify(run(sc)));
  });
});

describe("properties", () => {
  const scenarios: Closure[][] = [
    [close("BOM", "07:30", "09:00")],
    [close("BLR", "10:00", "12:00")],
    [close("CCU", "12:00", "16:00")],
    [close("HYD", "06:00", "10:00"), close("DEL", "12:00", "13:30")],
  ];
  for (const sc of scenarios) {
    const r = run(sc);
    it(`no flight leaves early and turnarounds hold (${sc.map((c) => c.airport).join("+")})`, () => {
      for (const f of NETWORK.flights) {
        const s = r.flights[f.id];
        if (s.status === "cancelled") continue;
        expect(s.dep).toBeGreaterThanOrEqual(f.dep);
        expect(s.arr - s.dep).toBe(f.block);
      }
      const tails = new Map<string, typeof NETWORK.flights>();
      for (const f of NETWORK.flights) tails.set(f.tail, [...(tails.get(f.tail) ?? []), f]);
      for (const legs of tails.values()) {
        const flown = legs.sort((a, b) => a.leg - b.leg).filter((f) => r.flights[f.id].status !== "cancelled");
        for (let i = 1; i < flown.length; i++) {
          expect(r.flights[flown[i].id].dep - r.flights[flown[i - 1].id].arr).toBeGreaterThanOrEqual(30);
        }
      }
    });
    it(`stranded never exceeds total passengers (${sc.map((c) => c.airport).join("+")})`, () => {
      const total = NETWORK.flights.reduce((a, f) => a + f.pax, 0);
      expect(r.metrics.strandedPax).toBeGreaterThanOrEqual(0);
      expect(r.metrics.strandedPax).toBeLessThanOrEqual(total);
      expect(r.capacityOk).toBe(true);
    });
  }
});
