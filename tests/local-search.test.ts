import { describe, expect, it } from "vitest";
import * as nip19 from "nostr-tools/nip19";
import type { NostrEvent } from "../src/types";
import { MAX_INDEXED_POST_CHARS, estimateIndexBytes, recordsFromEvent, searchRecords } from "../src/lib/local-search";

function event(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: "aa".repeat(32),
    pubkey: "11".repeat(32),
    kind: 1,
    created_at: 100,
    content: "A wonderfully fast local search",
    tags: [],
    sig: "bb".repeat(64),
    ...overrides,
  };
}

describe("local search index", () => {
  it("captures authors, mentioned people, profile names and kind-1 text", () => {
    const mentioned = "22".repeat(32);
    const referenced = "33".repeat(32);
    const note = recordsFromEvent(event({ tags: [["p", mentioned]], content: `A post with nostr:${nip19.npubEncode(referenced)}` }));
    expect(note.people.map(({ pubkey }) => pubkey)).toEqual(["11".repeat(32), mentioned, referenced]);
    expect(note.post?.content).toContain(nip19.npubEncode(referenced));

    const existing = new Map(note.people.map((person) => [person.pubkey, person]));
    const metadata = recordsFromEvent(event({ kind: 0, content: JSON.stringify({ display_name: "Álice Canopy", name: "alice" }) }), existing);
    expect(metadata.people[0]).toMatchObject({ name: "Álice Canopy", username: "alice" });
    expect(metadata.people[0]?.npub).toBe(nip19.npubEncode("11".repeat(32)));
  });

  it("searches names, npubs and multi-word post text without case or accents", () => {
    const person = recordsFromEvent(event({ kind: 0, content: JSON.stringify({ display_name: "Álice Canopy" }) })).people[0]!;
    const post = recordsFromEvent(event()).post!;
    expect(searchRecords([person], [post], "alice").people).toHaveLength(1);
    expect(searchRecords([person], [post], person.npub.slice(0, 18)).people).toHaveLength(1);
    expect(searchRecords([person], [post], "fast search").posts).toEqual([post]);
    expect(searchRecords([person], [post], "missing").posts).toHaveLength(0);
  });

  it("matches cached usernames independently of display names", () => {
    const person = recordsFromEvent(event({ kind: 0, content: JSON.stringify({ display_name: "Alice Canopy", name: "garden_alice" }) })).people[0]!;
    expect(searchRecords([person], [], "garden_al").people).toEqual([person]);
  });

  it("caps unusually long notes and estimates only the persisted post text", () => {
    const post = recordsFromEvent(event({ content: "x".repeat(MAX_INDEXED_POST_CHARS + 500) })).post!;
    expect(post.content).toHaveLength(MAX_INDEXED_POST_CHARS);
    expect(estimateIndexBytes([], [post])).toBe(360 + MAX_INDEXED_POST_CHARS * 2);
  });
});
