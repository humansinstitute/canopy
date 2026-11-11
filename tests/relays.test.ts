import { describe, expect, it } from "vitest";
import { buildRelayPlan, DEFAULT_RELAYS, normalizeRelayUrl } from "../src/lib/relays";

describe("relay selection", () => {
  it("falls back to documented defaults", () => {
    const plan = buildRelayPlan();
    expect(plan.read).toEqual([...DEFAULT_RELAYS]);
    expect(plan.write).toEqual([...DEFAULT_RELAYS]);
    expect(plan.source).toBe("defaults");
  });

  it("honours read/write flags, normalizes and deduplicates", () => {
    const plan = buildRelayPlan({
      "wss://custom.example/": { read: true, write: false },
      "wss://relay.damus.io/": { read: true, write: true },
      "https://unsafe.example": { read: true, write: true },
    });
    expect(plan.read[0]).toBe("wss://custom.example");
    expect(plan.write).not.toContain("wss://custom.example");
    expect(plan.read.filter((url) => url === "wss://relay.damus.io")).toHaveLength(1);
    expect(normalizeRelayUrl("javascript:alert(1)")).toBeNull();
  });
});

