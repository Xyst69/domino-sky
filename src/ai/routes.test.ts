import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as crisis } from "../../app/api/crisis/route";
import { POST as dispatch } from "../../app/api/dispatch/route";
import { ENGINE_VERSION, PRESETS, scenarioHash } from "@/engine";
import { rateLimited } from "./server";

vi.mock("./server", async importOriginal => ({
  ...await importOriginal<typeof import("./server")>(),
  AI_CONFIG: { enabled: false, model: "offline", timeoutMs: 500 },
}));

const request = (body: string, contentType = "application/json") =>
  new Request("http://localhost/api", { method: "POST", headers: { "content-type": contentType }, body });
const closures = PRESETS[0].closures;
const scenario = { engineVersion: ENGINE_VERSION, priority: "passengers", scenarioHash: "ignored", closures };

describe("public AI routes", () => {
  it("returns an independently grounded recovery for the Mumbai closure", async () => {
    const response = await dispatch(request(JSON.stringify(scenario)));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      source: "offline", scenarioHash: scenarioHash(closures, "passengers"),
      facts: { "closure.stranded": { value: 167 }, "plan.stranded": { value: 0 } },
    });
  });

  it("rejects an outdated engine before running a search", async () => {
    expect((await dispatch(request(JSON.stringify({ ...scenario, engineVersion: "old" })))).status).toBe(409);
  });

  it("rejects an unknown airport", async () => {
    const body = { ...scenario, closures: [{ airport: "ZZZ", start: 500, end: 600 }] };
    expect((await dispatch(request(JSON.stringify(body)))).status).toBe(400);
  });

  it("compiles a crisis through the offline route", async () => {
    const response = await crisis(request(JSON.stringify({ text: "Mumbai from 15:00 to 16:30" })));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ source: "rules", closures });
  });

  it.each([crisis, dispatch])("enforces content type, JSON syntax and byte limits", async route => {
    expect((await route(request("{}", "text/plain"))).status).toBe(415);
    expect((await route(request("{"))).status).toBe(400);
    // No declared length. The character count fits, but the encoded byte count exceeds the limit.
    expect((await route(request(JSON.stringify({ text: "é".repeat(4200) })))).status).toBe(413);
  });
});

afterEach(() => vi.useRealTimers());
it("recovers a client's quota as accepted requests expire", () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  for (let i = 0; i < 30; i++) expect(rateLimited("test", "client")).toBe(false);
  vi.setSystemTime(59_999);
  expect(rateLimited("test", "client")).toBe(true);
  expect(rateLimited("other", "client")).toBe(false);
  vi.setSystemTime(60_000);
  expect(rateLimited("test", "client")).toBe(false);
});
