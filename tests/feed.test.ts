import { describe, expect, it } from "vitest";
import { filter, firstValueFrom } from "rxjs";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import type { NostrEvent } from "../src/types";
import { addLocalEvent, followedPubkeys, followingFeed$, newestUnique, profileFeed$ } from "../src/lib/nostr";
import { profileDisplayName } from "../src/components/Avatar";

const note = (id: string, created_at: number): NostrEvent => ({
  id: id.repeat(64),
  pubkey: "a".repeat(64),
  created_at,
  kind: 1,
  tags: [],
  content: id,
  sig: "b".repeat(128),
});

describe("following feed", () => {
  it("normalizes and deduplicates valid contact pubkeys", () => {
    const alice = "a".repeat(64);
    const bob = "b".repeat(64);
    expect(followedPubkeys([{ pubkey: bob }, { pubkey: alice }, { pubkey: bob }, { pubkey: "bad" }])).toEqual([alice, bob]);
    expect(followedPubkeys(undefined)).toBeUndefined();
  });

  it("deduplicates notes and keeps stable newest-first order", () => {
    const old = note("1", 10);
    const recent = note("2", 20);
    expect(newestUnique([old, recent, old]).map(({ id }) => id)).toEqual([recent.id, old.id]);
  });

  it("uses the reactive contact model to exclude global authors", async () => {
    const ownerSecret = generateSecretKey();
    const followedSecret = generateSecretKey();
    const outsiderSecret = generateSecretKey();
    const owner = getPublicKey(ownerSecret);
    const followed = getPublicKey(followedSecret);
    addLocalEvent(finalizeEvent({ kind: 3, created_at: 5, tags: [["p", followed]], content: "" }, ownerSecret));
    const followedNote = finalizeEvent({ kind: 1, created_at: 20, tags: [], content: "followed" }, followedSecret);
    addLocalEvent(followedNote);
    addLocalEvent(finalizeEvent({ kind: 1, created_at: 30, tags: [], content: "outsider" }, outsiderSecret));

    const state = await firstValueFrom(followingFeed$(owner, [], false).pipe(filter(({ status }) => status === "ready")));
    expect(state.followCount).toBe(1);
    expect(state.events).toEqual([followedNote]);
  });

  it("builds a newest-first feed for exactly one selected profile", async () => {
    const selectedSecret = generateSecretKey();
    const otherSecret = generateSecretKey();
    const selected = getPublicKey(selectedSecret);
    const older = finalizeEvent({ kind: 1, created_at: 40, tags: [], content: "older profile post" }, selectedSecret);
    const newer = finalizeEvent({ kind: 1, created_at: 50, tags: [], content: "newer profile post" }, selectedSecret);
    addLocalEvent(older);
    addLocalEvent(newer);
    addLocalEvent(finalizeEvent({ kind: 1, created_at: 60, tags: [], content: "another profile" }, otherSecret));

    const state = await firstValueFrom(profileFeed$(selected, [], false).pipe(filter(({ status }) => status === "ready")));
    expect(state.events).toEqual([newer, older]);
  });

  it("prefers display name, then name, then a compact identifier", () => {
    const pubkey = "c".repeat(64);
    expect(profileDisplayName({ display_name: "Alice", name: "alice" }, pubkey)).toBe("Alice");
    expect(profileDisplayName({ display_name: "", name: "alice" }, pubkey)).toBe("alice");
    expect(profileDisplayName(undefined, pubkey)).toContain("…");
  });
});
