import { beforeEach, describe, expect, it, vi } from "vitest";
import { nip19 } from "nostr-tools";
import type { NostrEvent } from "../src/types";
import { buildRelayPlan, relayPlanFromProfile } from "../src/lib/relays";
import { blossomServersFromProfile, clearSavedSettings, loadSavedSettings, parseSettingsInput, profileNetworkSettings, saveSettings } from "../src/lib/settings";

function event(kind: number, created_at: number, tags: string[][]): NostrEvent {
  return { id: `${kind}`.padEnd(64, "a"), pubkey: "b".repeat(64), created_at, kind, tags, content: "", sig: "c".repeat(128) };
}

describe("profile network settings", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
    });
  });

  it("uses every valid NIP-65 relay and respects read/write markers", () => {
    const fallback = buildRelayPlan();
    const plan = relayPlanFromProfile(event(10002, 10, [
      ["r", "wss://both.example"],
      ["r", "wss://read.example", "read"],
      ["r", "wss://write.example", "write"],
      ["r", "https://not-a-relay.example"],
    ]), fallback);
    expect(plan.source).toBe("profile");
    expect(plan.read).toEqual(["wss://both.example", "wss://read.example"]);
    expect(plan.write).toEqual(["wss://both.example", "wss://write.example"]);
  });

  it("uses the newest profile lists and validates Blossom HTTPS servers", () => {
    const settings = profileNetworkSettings([
      event(10002, 10, [["r", "wss://old.example"]]),
      event(10002, 20, [["r", "wss://new.example"]]),
      event(10063, 20, [["server", "https://blossom.example/path"], ["server", "http://unsafe.example"]]),
    ], buildRelayPlan());
    expect(settings.relays.read).toEqual(["wss://new.example"]);
    expect(settings.blossomServers).toEqual(["https://blossom.example/path"]);
    expect(blossomServersFromProfile(event(10063, 1, [["server", "bad"]]))).toEqual([]);
  });

  it("persists local overrides and can return to profile defaults", () => {
    const pubkey = "d".repeat(64);
    const settings = parseSettingsInput("wss://read.example", "wss://write.example", "https://blossom.example");
    saveSettings(pubkey, settings);
    expect(loadSavedSettings(pubkey)).toEqual(settings);
    clearSavedSettings(pubkey);
    expect(loadSavedSettings(pubkey)).toBeUndefined();
  });

  it("preserves an imported NStack destination when relay overrides change or reset", () => {
    const pubkey = "e".repeat(64);
    const nstack = { serverUrl: "https://tower.example", workspaceId: "workspace", workspaceName: "Studio", workspaceOwnerNpub: nip19.npubEncode("11".repeat(32)), workspaceServiceNpub: nip19.npubEncode("22".repeat(32)) };
    localStorage.setItem(`canopy.networkSettings.${pubkey}`, JSON.stringify({ nstack }));
    const settings = parseSettingsInput("wss://read.example", "wss://write.example", "https://blossom.example");
    saveSettings(pubkey, settings);
    expect(JSON.parse(localStorage.getItem(`canopy.networkSettings.${pubkey}`) || "null").nstack).toEqual(nstack);
    clearSavedSettings(pubkey);
    expect(JSON.parse(localStorage.getItem(`canopy.networkSettings.${pubkey}`) || "null")).toEqual({ nstack });
  });

  it("does not preserve malformed or credential-shaped NStack data", () => {
    const pubkey = "f".repeat(64);
    localStorage.setItem(`canopy.networkSettings.${pubkey}`, JSON.stringify({ nstack: { serverUrl: "https://tower.example", token: "secret" } }));
    saveSettings(pubkey, parseSettingsInput("wss://read.example", "wss://write.example", ""));
    expect(localStorage.getItem(`canopy.networkSettings.${pubkey}`)).not.toContain("secret");
  });

  it("rejects unusable custom settings", () => {
    expect(() => parseSettingsInput("not-a-relay", "wss://write.example", "")).toThrow("valid read relay");
    expect(() => parseSettingsInput("wss://read.example", "wss://write.example", "http://unsafe.example")).toThrow("HTTPS");
  });
});
