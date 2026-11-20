import { expect, it, vi } from "vitest";

it("normalizes pasted deployment settings before constructing Gemini headers", async () => {
  vi.stubEnv("GEMINI_API_KEY", "\uFEFFtest-key\r\n");
  vi.stubEnv("GEMINI_MODEL", " model-name\n");
  try {
    const { AI_CONFIG } = await import("./server");
    expect(AI_CONFIG.apiKey).toBe("test-key");
    expect(AI_CONFIG.model).toBe("model-name");
  } finally {
    vi.unstubAllEnvs();
  }
});
