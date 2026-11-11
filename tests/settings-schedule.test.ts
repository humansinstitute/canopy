// @vitest-environment jsdom
import { beforeEach, expect, it } from "vitest";
import { syncCheckpointKey, syncIsDue, SETTINGS_SYNC_INTERVAL } from "../src/lib/settings-schedule";
import { changeSetting, readSettingsState } from "../src/lib/settings-state";
const destination = { serverUrl: "https://tower.example", workspaceId: "workspace", workspaceName: "Name", workspaceOwnerNpub: "owner", workspaceServiceNpub: "service" };
beforeEach(() => localStorage.clear());
it("isolates checkpoint by account and canonical destination, ignoring display names", () => {
  const key = syncCheckpointKey("a", destination);
  expect(syncCheckpointKey("a", { ...destination, workspaceName: "Renamed", serverUrl: "https://tower.example/" })).toBe(key);
  for (const patch of [{ workspaceId: "another" }, { serverUrl: "https://another.example" }, { serverUrl: "https://tower.example/another" }, { workspaceOwnerNpub: "another" }, { workspaceServiceNpub: "another" }]) expect(syncCheckpointKey("a", { ...destination, ...patch })).not.toBe(key);
  expect(syncCheckpointKey("b", destination)).not.toBe(key);
});
it("requires first restore, changed state and 24h; invalid or future checkpoints cannot suppress sync", () => {
  expect(syncIsDue("checkpoint", "v1", 1000)).toBe(true);
  localStorage.setItem("checkpoint", JSON.stringify({ successAt: 1000, fingerprint: "v1" }));
  expect(syncIsDue("checkpoint", "v1", 1000 + SETTINGS_SYNC_INTERVAL - 1)).toBe(false);
  expect(syncIsDue("checkpoint", "v1", 1000 + SETTINGS_SYNC_INTERVAL)).toBe(true);
  expect(syncIsDue("checkpoint", "v2", 1001)).toBe(true);
  expect(syncIsDue("checkpoint", "v1", 999)).toBe(true);
  localStorage.setItem("checkpoint", "invalid");
  expect(syncIsDue("checkpoint", "v1")).toBe(true);
});
it("unchanged saves do not advance edit clocks", () => {
  changeSetting("a", "zap", { amount: 21, message: "Thanks" });
  const before = readSettingsState("a");
  changeSetting("a", "zap", { amount: 21, message: "Thanks" });
  expect(readSettingsState("a")).toEqual(before);
  changeSetting("a", "zap", { amount: 21, message: "Changed" });
  expect(readSettingsState("a").fields.zap!.clock).toBe(before.fields.zap!.clock + 1);
});
