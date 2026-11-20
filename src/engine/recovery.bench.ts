import { test } from "vitest";
import { NETWORK, PRESETS, searchRecovery } from "./index";

const scenarios = [
  ...PRESETS.map(preset => preset.closures),
  ["DEL", "BOM", "HYD", "BLR"].map(airport => ({ airport, start: 540, end: 810 })),
];

test("recovery search", async ({ bench }) => {
  const result = await bench("four presets and four simultaneous closures", () => {
    for (const closures of scenarios) searchRecovery(NETWORK, closures);
  }).run();
  console.info(`Median search time for five scenarios: ${result.latency.p50.toFixed(1)} ms`);
});
