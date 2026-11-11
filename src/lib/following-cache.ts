import type { NostrEvent } from "../types";
import { flushLocalIndex, upsertLocalIdentities } from "./local-search";
import { fetchFollowingSnapshot, fetchProfilesInBatches, type ProfileBatchProgress } from "./nostr";

export const PROFILE_REFRESH_MS = 24 * 60 * 60 * 1_000;
export const FOLLOWING_SYNC_MS = 72 * 60 * 60 * 1_000;
export const CACHE_RECHECK_MS = 15 * 60 * 1_000;
const STORAGE_VERSION = 1;
const PUBKEY = /^[0-9a-f]{64}$/;

export type CacheStage = "following" | "profiles";
export type CachePhase = "idle" | "following" | "profiles";

export interface CacheAttempt {
  at: number;
  stage: CacheStage;
  error?: string;
}

export interface FollowingCacheRecord {
  version: 1;
  followedPubkeys: string[];
  followingSyncedAt?: number;
  profilesRefreshedAt?: number;
  lastAttempt?: CacheAttempt;
}

export interface FollowingCacheStatus extends FollowingCacheRecord {
  phase: CachePhase;
  progress?: ProfileBatchProgress;
  pendingForce: boolean;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface FollowingCacheDependencies {
  now(): number;
  storage: StorageLike;
  isOnline(): boolean;
  isVisible(): boolean;
  syncFollowing(): Promise<{ event: NostrEvent; followedPubkeys: string[] }>;
  persistFollowed(pubkeys: string[], seenAt: number): Promise<void>;
  refreshProfiles(pubkeys: string[], onProgress: (progress: ProfileBatchProgress) => void): Promise<{ failed: number; total: number; profiles: number }>;
  flushProfiles(): Promise<void>;
  setInterval(handler: () => void, milliseconds: number): number;
  clearInterval(handle: number): void;
  addWindowListener(type: "online", handler: () => void): void;
  removeWindowListener(type: "online", handler: () => void): void;
  addDocumentListener(type: "visibilitychange", handler: () => void): void;
  removeDocumentListener(type: "visibilitychange", handler: () => void): void;
}

function storageKey(pubkey: string): string {
  return `canopy.followingCache.v1.${pubkey.toLowerCase()}`;
}

function validTimestamp(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function normalizeFollowedPubkeys(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((value): value is string => typeof value === "string" && PUBKEY.test(value.toLowerCase())).map((value) => value.toLowerCase()))].sort();
}

export function loadFollowingCache(storage: StorageLike, pubkey: string): FollowingCacheRecord {
  const empty: FollowingCacheRecord = { version: STORAGE_VERSION, followedPubkeys: [] };
  try {
    const parsed = JSON.parse(storage.getItem(storageKey(pubkey)) || "null") as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== "object") return empty;
    const attempt = parsed.lastAttempt as Record<string, unknown> | undefined;
    return {
      version: STORAGE_VERSION,
      followedPubkeys: normalizeFollowedPubkeys(parsed.followedPubkeys),
      followingSyncedAt: validTimestamp(parsed.followingSyncedAt),
      profilesRefreshedAt: validTimestamp(parsed.profilesRefreshedAt),
      lastAttempt: attempt && (attempt.stage === "following" || attempt.stage === "profiles") && validTimestamp(attempt.at) !== undefined
        ? { at: attempt.at as number, stage: attempt.stage, ...(typeof attempt.error === "string" ? { error: attempt.error.slice(0, 300) } : {}) }
        : undefined,
    };
  } catch {
    return empty;
  }
}

export function isDue(lastSuccess: number | undefined, cadence: number, now: number): boolean {
  return lastSuccess === undefined || now - lastSuccess >= cadence;
}

function message(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "The relay refresh failed.";
}

export class FollowingCacheController {
  private record: FollowingCacheRecord;
  private phase: CachePhase = "idle";
  private progress?: ProfileBatchProgress;
  private pendingForce = false;
  private inFlight?: Promise<void>;
  private queuedForce?: Promise<void>;
  private listeners = new Set<(status: FollowingCacheStatus) => void>();
  private interval?: number;
  private readonly wake = () => { void this.check(); };

  constructor(private readonly viewerPubkey: string, private readonly dependencies: FollowingCacheDependencies) {
    this.record = loadFollowingCache(dependencies.storage, viewerPubkey);
  }

  getStatus(): FollowingCacheStatus {
    return { ...this.record, followedPubkeys: [...this.record.followedPubkeys], phase: this.phase, progress: this.progress, pendingForce: this.pendingForce };
  }

  subscribe(listener: (status: FollowingCacheStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.getStatus());
    return () => this.listeners.delete(listener);
  }

  start(): void {
    if (this.interval !== undefined) return;
    this.interval = this.dependencies.setInterval(this.wake, CACHE_RECHECK_MS);
    this.dependencies.addWindowListener("online", this.wake);
    this.dependencies.addDocumentListener("visibilitychange", this.wake);
    void this.check();
  }

  stop(): void {
    if (this.interval !== undefined) this.dependencies.clearInterval(this.interval);
    this.interval = undefined;
    this.dependencies.removeWindowListener("online", this.wake);
    this.dependencies.removeDocumentListener("visibilitychange", this.wake);
  }

  check(force = false): Promise<void> {
    if (force && this.inFlight) {
      this.pendingForce = true;
      this.emit();
      if (!this.queuedForce) this.queuedForce = this.inFlight.then(() => this.check(true)).finally(() => { this.queuedForce = undefined; });
      return this.queuedForce;
    }
    if (this.inFlight) return this.inFlight;
    if (!this.dependencies.isOnline() || !this.dependencies.isVisible()) return Promise.resolve();
    const now = this.dependencies.now();
    const followingDue = force || isDue(this.record.followingSyncedAt, FOLLOWING_SYNC_MS, now);
    const profilesDue = force || isDue(this.record.profilesRefreshedAt, PROFILE_REFRESH_MS, now);
    if (!followingDue && !profilesDue) return Promise.resolve();
    this.pendingForce = false;
    this.inFlight = this.run(followingDue, profilesDue).finally(() => {
      this.phase = "idle";
      this.progress = undefined;
      this.inFlight = undefined;
      this.emit();
    });
    return this.inFlight;
  }

  private async run(followingDue: boolean, profilesDue: boolean): Promise<void> {
    let latestError: CacheAttempt | undefined;
    if (followingDue) {
      this.phase = "following";
      this.record.lastAttempt = { at: this.dependencies.now(), stage: "following" };
      this.persist();
      try {
        const result = await this.dependencies.syncFollowing();
        const snapshot = normalizeFollowedPubkeys(result.followedPubkeys);
        await this.dependencies.persistFollowed(snapshot, Math.floor(this.dependencies.now() / 1_000));
        this.record.followedPubkeys = snapshot;
        this.record.followingSyncedAt = this.dependencies.now();
      } catch (error) {
        latestError = { at: this.dependencies.now(), stage: "following", error: message(error) };
      }
      this.record.lastAttempt = latestError ?? { at: this.dependencies.now(), stage: "following" };
      this.persist();
    }
    if (profilesDue) {
      this.phase = "profiles";
      this.progress = { completed: 0, total: Math.ceil(this.record.followedPubkeys.length / 100), profiles: 0 };
      this.record.lastAttempt = { at: this.dependencies.now(), stage: "profiles" };
      this.persist();
      try {
        const result = await this.dependencies.refreshProfiles(this.record.followedPubkeys, (progress) => {
          this.progress = progress;
          this.emit();
        });
        await this.dependencies.flushProfiles();
        if (result.failed > 0) throw new Error(`${result.failed} of ${result.total} profile batches failed; ${result.profiles} profiles were updated.`);
        this.record.profilesRefreshedAt = this.dependencies.now();
      } catch (error) {
        latestError = { at: this.dependencies.now(), stage: "profiles", error: message(error) };
      }
      this.record.lastAttempt = latestError ?? { at: this.dependencies.now(), stage: "profiles" };
      this.persist();
    }
  }

  private persist(): void {
    try { this.dependencies.storage.setItem(storageKey(this.viewerPubkey), JSON.stringify(this.record)); } catch { /* Browser storage can be disabled. */ }
    this.emit();
  }

  private emit(): void {
    const status = this.getStatus();
    this.listeners.forEach((listener) => listener(status));
  }
}

export function browserFollowingCacheDependencies(viewerPubkey: string, readRelays: string[], mockEvents?: NostrEvent[]): FollowingCacheDependencies {
  const mockDelay = window.__CANOPY_MOCK_CACHE_DELAY__ ?? 0;
  const delay = async () => { if (mockEvents && mockDelay > 0) await new Promise((resolve) => window.setTimeout(resolve, mockDelay)); };
  return {
    now: () => Date.now(),
    storage: localStorage,
    isOnline: () => navigator.onLine,
    isVisible: () => document.visibilityState === "visible",
    syncFollowing: async () => { await delay(); return fetchFollowingSnapshot(viewerPubkey, readRelays, mockEvents); },
    persistFollowed: upsertLocalIdentities,
    refreshProfiles: async (pubkeys, onProgress) => { await delay(); return fetchProfilesInBatches(pubkeys, readRelays, onProgress, mockEvents); },
    flushProfiles: flushLocalIndex,
    setInterval: (handler, milliseconds) => window.setInterval(handler, milliseconds),
    clearInterval: (handle) => window.clearInterval(handle),
    addWindowListener: (type, handler) => window.addEventListener(type, handler),
    removeWindowListener: (type, handler) => window.removeEventListener(type, handler),
    addDocumentListener: (type, handler) => document.addEventListener(type, handler),
    removeDocumentListener: (type, handler) => document.removeEventListener(type, handler),
  };
}
