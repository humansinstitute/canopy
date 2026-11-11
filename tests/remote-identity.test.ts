import { describe, expect, it, vi } from "vitest";
import * as nip19 from "nostr-tools/nip19";
import type { NostrEvent } from "../src/types";
import { mergeLocalIdentity, recordsFromEvent, searchRecords } from "../src/lib/local-search";
import { parseExactIdentity, resolveRemoteIdentity } from "../src/lib/remote-identity";

describe("remote identity resolution", () => {
  const pubkey = "34".repeat(32);
  const npub = nip19.npubEncode(pubkey);

  it("accepts exact npub/nprofile forms and leaves partial ordinary text local", () => {
    expect(parseExactIdentity(npub)).toMatchObject({ kind: "identity", identity: { pubkey, npub, relayHints: [] } });
    expect(parseExactIdentity(`nostr:${npub}`)).toMatchObject({ kind: "identity", identity: { pubkey } });
    const nprofile = nip19.nprofileEncode({ pubkey, relays: ["wss://hint.example"] });
    expect(parseExactIdentity(`nostr:${nprofile}`)).toMatchObject({ kind: "identity", identity: { pubkey, relayHints: ["wss://hint.example"] } });
    expect(parseExactIdentity(npub.slice(0, 20))).toMatchObject({ kind: "invalid" });
    expect(parseExactIdentity("Alice")).toEqual({ kind: "none" });
  });

  it("persists a fallback identity, combines relay hints and reports found metadata", async () => {
    const profile = { kind: 0 } as NostrEvent;
    const persistIdentity = vi.fn(async () => undefined);
    const fetchProfile = vi.fn(async () => profile);
    const identity = { pubkey, npub, relayHints: ["wss://hint.example"] };
    const result = await resolveRemoteIdentity(identity, ["wss://read.example", "wss://hint.example/"], false, { persistIdentity, fetchProfile });
    expect(persistIdentity).toHaveBeenCalledWith(pubkey);
    expect(fetchProfile).toHaveBeenCalledWith(pubkey, ["wss://hint.example", "wss://read.example"], true);
    expect(result.metadataFound).toBe(true);
  });

  it("never contacts relays in mock mode and keeps an honest no-result fallback", async () => {
    const persistIdentity = vi.fn(async () => undefined);
    const fetchProfile = vi.fn();
    const result = await resolveRemoteIdentity({ pubkey, npub, relayHints: [] }, ["wss://read.example"], true, { persistIdentity, fetchProfile });
    expect(fetchProfile).not.toHaveBeenCalled();
    expect(persistIdentity).toHaveBeenCalledOnce();
    expect(result.metadataFound).toBe(false);
  });

  it("enriches fallback people without losing recency or npub searchability", () => {
    const fallback = mergeLocalIdentity(pubkey, undefined, 500);
    expect(fallback.name).toBe(`${pubkey.slice(0, 8)}…${pubkey.slice(-6)}`);
    const metadataEvent = { id: "aa".repeat(32), pubkey, kind: 0, created_at: 400, tags: [], content: JSON.stringify({ display_name: "Remote Alice", name: "remote_alice" }), sig: "bb".repeat(64) };
    const enriched = recordsFromEvent(metadataEvent, new Map([[pubkey, fallback]])).people[0]!;
    expect(enriched).toMatchObject({ name: "Remote Alice", username: "remote_alice", lastSeen: 500, npub });
    expect(searchRecords([enriched], [], npub).people).toEqual([enriched]);
  });
});
