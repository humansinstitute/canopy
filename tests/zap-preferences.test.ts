// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ZAP_PREFERENCES, loadZapPreferences, saveZapPreferences, validateZapPreferences } from "../src/lib/zap-preferences";

describe("zap preferences", () => {
  beforeEach(() => localStorage.clear());

  it("uses the 21-sat blank-message defaults", () => {
    expect(loadZapPreferences("alice")).toEqual(DEFAULT_ZAP_PREFERENCES);
  });

  it("saves and loads independently for each pubkey", () => {
    saveZapPreferences("alice", { amount: 42, message: "nice note" });
    saveZapPreferences("bob", { amount: 7, message: "" });
    expect(loadZapPreferences("alice")).toEqual({ amount: 42, message: "nice note" });
    expect(loadZapPreferences("bob")).toEqual({ amount: 7, message: "" });
  });

  it("falls back safely for malformed, incomplete, or blocked storage", () => {
    localStorage.setItem("canopy.zapPreferences.alice", "not json");
    expect(loadZapPreferences("alice")).toEqual(DEFAULT_ZAP_PREFERENCES);
    localStorage.setItem("canopy.zapPreferences.alice", JSON.stringify({ amount: 0, message: "nope" }));
    expect(loadZapPreferences("alice")).toEqual(DEFAULT_ZAP_PREFERENCES);
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(loadZapPreferences("alice")).toEqual(DEFAULT_ZAP_PREFERENCES);
    getItem.mockRestore();
  });

  it("validates whole-sat limits and the zap message cap", () => {
    expect(validateZapPreferences(1, "a".repeat(280))).toEqual({ amount: 1, message: "a".repeat(280) });
    expect(validateZapPreferences(1_000_000, "")).toEqual({ amount: 1_000_000, message: "" });
    for (const amount of [0, 1.5, 1_000_001, Number.NaN]) {
      expect(() => validateZapPreferences(amount, "")).toThrow("whole default zap amount");
    }
    expect(() => validateZapPreferences(21, "a".repeat(281))).toThrow("280 characters");
  });

  it("reports a failed save when persistence is blocked", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(() => saveZapPreferences("alice", { amount: 55, message: "thanks" })).toThrow("blocked");
    setItem.mockRestore();
  });
});
