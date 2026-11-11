// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { changeSetting, changeSettings, mergeSettings, readSettingsState } from "../src/lib/settings-state";
import { localSettingsSnapshot, validateSettingsState } from "../src/lib/settings-sync";
import { clearNwcConnection, loadNwcConnection, saveNwcConnection } from "../src/lib/nwc";
import { loadSavedSettings } from "../src/lib/settings";
import { loadZapPreferences } from "../src/lib/zap-preferences";
const pubkey = "11".repeat(32);
const uri = `nostr+walletconnect://${"22".repeat(32)}?relay=wss%3A%2F%2Fwallet.example&secret=${"33".repeat(32)}`;
beforeEach(() => localStorage.clear());
describe("atomic private settings and conflict resolution", () => {
  it("saves a complete form atomically, migrates legacy values, and isolates accounts", () => {
    localStorage.setItem(`canopy.nwc.${pubkey}`, uri);
    expect(localSettingsSnapshot(pubkey).fields.nwc?.value).toBe(uri);
    changeSettings(pubkey, { network: { read: ["wss://read.example"], write: ["wss://write.example"], blossom: [] }, nwc: uri, zap: { amount: 55, message: "nice" } });
    expect(loadNwcConnection(pubkey)).toBe(uri);
    expect(loadSavedSettings(pubkey)?.relays.read).toEqual(["wss://read.example"]);
    expect(loadZapPreferences(pubkey).amount).toBe(55);
    expect(loadNwcConnection("44".repeat(32))).toBeUndefined();
    expect(() => validateSettingsState(readSettingsState(pubkey), "44".repeat(32))).toThrow();
  });
  it("keeps independent concurrent changes, prefers removal on a tie, and rejects stale resurrection", () => {
    saveNwcConnection(pubkey, uri);
    const stale = readSettingsState(pubkey);
    changeSetting(pubkey, "zap", { amount: 34, message: "" });
    const other = readSettingsState(pubkey);
    clearNwcConnection(pubkey);
    const removed = readSettingsState(pubkey);
    expect(mergeSettings(stale, removed).fields.nwc?.value).toBeNull();
    expect(mergeSettings(removed, stale).fields.nwc?.value).toBeNull();
    expect(mergeSettings(removed, other).fields.zap?.value).toEqual({ amount: 34, message: "" });
    const concurrent = structuredClone(removed);
    concurrent.fields.nwc!.value = uri;
    expect(mergeSettings(concurrent, removed).fields.nwc?.value).toBeNull();
  });
  it("does not seed an empty first device or silently claim a failed local save", () => {
    expect(localSettingsSnapshot(pubkey).fields).toEqual({});
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    expect(() => saveNwcConnection(pubkey, uri)).toThrow("quota");
    set.mockRestore();
    expect(loadNwcConnection(pubkey)).toBeUndefined();
  });
  it("rejects malformed backup fields before applying anything", () => {
    const base = { schema: 1, pubkey, fields: { nwc: { clock: 2, writer: "device", value: "bad" } } };
    expect(() => validateSettingsState(base, pubkey)).toThrow();
    base.fields.nwc.value = uri;
    base.fields.nwc.clock = -1;
    expect(() => validateSettingsState(base, pubkey)).toThrow();
    expect(() => validateSettingsState({ schema: 1, pubkey, fields: { token: "bad" } }, pubkey)).toThrow();
  });
});
