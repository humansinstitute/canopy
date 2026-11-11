import { describe, expect, it, vi } from "vitest";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import type { NostrEvent } from "../src/types";
import {
  FOLLOWING_SYNC_MS,
  FollowingCacheController,
  PROFILE_REFRESH_MS,
  isDue,
  loadFollowingCache,
  normalizeFollowedPubkeys,
  type FollowingCacheDependencies,
} from "../src/lib/following-cache";
import { fetchFollowingSnapshot, fetchProfilesInBatches } from "../src/lib/nostr";

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

function dependencies(storage: MemoryStorage, nowRef: { value: number }, overrides: Partial<FollowingCacheDependencies> = {}): FollowingCacheDependencies {
  return {
    now: () => nowRef.value,
    storage,
    isOnline: () => true,
    isVisible: () => true,
    syncFollowing: vi.fn(async () => ({ event: {} as NostrEvent, followedPubkeys: ["a".repeat(64)] })),
    persistFollowed: vi.fn(async () => undefined),
    refreshProfiles: vi.fn(async (_pubkeys, progress) => { progress({ completed: 1, total: 1, profiles: 1 }); return { failed: 0, total: 1, profiles: 1 }; }),
    flushProfiles: vi.fn(async () => undefined),
    setInterval: vi.fn(() => 1),
    clearInterval: vi.fn(),
    addWindowListener: vi.fn(),
    removeWindowListener: vi.fn(),
    addDocumentListener: vi.fn(),
    removeDocumentListener: vi.fn(),
    ...overrides,
  };
}

describe("following cache schedule", () => {
  it("uses inclusive 24-hour and 72-hour due boundaries", () => {
    const now = 10 * FOLLOWING_SYNC_MS;
    expect(isDue(now - PROFILE_REFRESH_MS + 1, PROFILE_REFRESH_MS, now)).toBe(false);
    expect(isDue(now - PROFILE_REFRESH_MS, PROFILE_REFRESH_MS, now)).toBe(true);
    expect(isDue(now - FOLLOWING_SYNC_MS + 1, FOLLOWING_SYNC_MS, now)).toBe(false);
    expect(isDue(now - FOLLOWING_SYNC_MS, FOLLOWING_SYNC_MS, now)).toBe(true);
    expect(isDue(undefined, PROFILE_REFRESH_MS, now)).toBe(true);
  });

  it("isolates viewers and falls back safely from old or corrupt stored state", async () => {
    const storage = new MemoryStorage();
    const now = { value: 1_000 };
    storage.setItem(`canopy.followingCache.v1.${"b".repeat(64)}`, "not json");
    storage.setItem(`canopy.followingCache.v1.${"c".repeat(64)}`, JSON.stringify({ version: 0, followedPubkeys: ["D".repeat(64), "bad"], followingSyncedAt: "yesterday" }));
    expect(loadFollowingCache(storage, "b".repeat(64))).toMatchObject({ followedPubkeys: [] });
    expect(loadFollowingCache(storage, "c".repeat(64))).toMatchObject({ followedPubkeys: ["d".repeat(64)], followingSyncedAt: undefined });
    const controller = new FollowingCacheController("a".repeat(64), dependencies(storage, now));
    await controller.check();
    expect(loadFollowingCache(storage, "a".repeat(64)).followedPubkeys).toEqual(["a".repeat(64)]);
    expect(loadFollowingCache(storage, "c".repeat(64)).followedPubkeys).toEqual(["d".repeat(64)]);
  });

  it("retains prior snapshot and successful timestamps after partial failure", async () => {
    const storage = new MemoryStorage();
    const viewer = "e".repeat(64);
    const prior = "f".repeat(64);
    storage.setItem(`canopy.followingCache.v1.${viewer}`, JSON.stringify({ version: 1, followedPubkeys: [prior], followingSyncedAt: 100, profilesRefreshedAt: 200 }));
    const now = { value: FOLLOWING_SYNC_MS + 1_000 };
    const deps = dependencies(storage, now, {
      syncFollowing: vi.fn(async () => { throw new Error("relays unavailable"); }),
      refreshProfiles: vi.fn(async () => ({ failed: 1, total: 2, profiles: 1 })),
    });
    const controller = new FollowingCacheController(viewer, deps);
    await controller.check(true);
    expect(controller.getStatus()).toMatchObject({ followedPubkeys: [prior], followingSyncedAt: 100, profilesRefreshedAt: 200, phase: "idle" });
    expect(controller.getStatus().lastAttempt?.error).toContain("1 of 2 profile batches failed");
    expect(deps.refreshProfiles).toHaveBeenCalledWith([prior], expect.any(Function));
  });

  it("records success only after fallback persistence and profile-index flush", async () => {
    const calls: string[] = [];
    const now = { value: 9_000 };
    const deps = dependencies(new MemoryStorage(), now, {
      persistFollowed: vi.fn(async () => { calls.push("fallbacks"); }),
      refreshProfiles: vi.fn(async () => { calls.push("profiles"); return { failed: 0, total: 1, profiles: 1 }; }),
      flushProfiles: vi.fn(async () => { calls.push("flush"); }),
    });
    const controller = new FollowingCacheController("1".repeat(64), deps);
    await controller.check(true);
    expect(calls).toEqual(["fallbacks", "profiles", "flush"]);
    expect(controller.getStatus()).toMatchObject({ followingSyncedAt: 9_000, profilesRefreshedAt: 9_000 });
  });

  it("coalesces automatic checks and queues one forced pass behind in-flight work", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const syncFollowing = vi.fn(async () => { await blocked; return { event: {} as NostrEvent, followedPubkeys: [] }; });
    const deps = dependencies(new MemoryStorage(), { value: 5_000 }, { syncFollowing });
    const controller = new FollowingCacheController("2".repeat(64), deps);
    const first = controller.check();
    const automatic = controller.check();
    const forced = controller.check(true);
    const duplicateForce = controller.check(true);
    expect(syncFollowing).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, automatic, forced, duplicateForce]);
    expect(syncFollowing).toHaveBeenCalledTimes(2);
  });
});

describe("following cache relay inputs", () => {
  it("lowercases, validates and deduplicates p tags from the latest seeded kind-3", async () => {
    const ownerSecret = generateSecretKey();
    const owner = getPublicKey(ownerSecret);
    const valid = "AB".repeat(32);
    const older = finalizeEvent({ kind: 3, created_at: 1, tags: [["p", "c".repeat(64)]], content: "" }, ownerSecret);
    const latest = finalizeEvent({ kind: 3, created_at: 2, tags: [["p", valid], ["p", valid.toLowerCase()], ["p", "bad"], ["x", "d".repeat(64)]], content: "" }, ownerSecret);
    const result = await fetchFollowingSnapshot(owner, ["wss://must-not-be-used.example"], [older, latest]);
    expect(result.event.id).toBe(latest.id);
    expect(result.followedPubkeys).toEqual([valid.toLowerCase()]);
    expect(normalizeFollowedPubkeys([valid, valid.toLowerCase(), "bad"])).toEqual([valid.toLowerCase()]);
  });

  it("processes seeded profile metadata in bounded sequential batches", async () => {
    const secrets = Array.from({ length: 5 }, () => generateSecretKey());
    const authors = secrets.map(getPublicKey);
    const events = secrets.map((secret, index) => finalizeEvent({ kind: 0, created_at: index + 1, tags: [], content: JSON.stringify({ name: `person-${index}` }) }, secret));
    const progress: Array<{ completed: number; total: number; profiles: number }> = [];
    const result = await fetchProfilesInBatches(authors, ["wss://must-not-be-used.example"], (value) => progress.push(value), events, 2);
    expect(result).toEqual({ completed: 3, total: 3, profiles: 5, failed: 0 });
    expect(progress.map(({ completed }) => completed)).toEqual([0, 1, 2, 3]);
  });
});
