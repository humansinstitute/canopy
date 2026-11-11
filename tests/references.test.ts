import { describe, expect, it } from "vitest";
import { nip19 } from "nostr-tools";
import { parseNostrReferences, referenceAwareText } from "../src/lib/references";

describe("NIP-19 content references", () => {
  const pubkey = "a".repeat(64);
  const eventId = "b".repeat(64);

  it("decodes URI and bare profile/event forms while preserving surrounding text", () => {
    const profile = nip19.nprofileEncode({ pubkey, relays: ["wss://relay.example"] });
    const event = nip19.neventEncode({ id: eventId, author: pubkey, kind: 1 });
    const parsed = parseNostrReferences(`Ask nostr:${profile} about ${event}.`);

    expect(parsed.segments.map(({ kind }) => kind)).toEqual(["text", "profile", "text", "event", "text"]);
    expect(parsed.segments[1]).toMatchObject({ kind: "profile", pubkey, relays: ["wss://relay.example"] });
    expect(parsed.events[0]).toMatchObject({ kind: "event", pointer: { id: eventId, author: pubkey, kind: 1 } });
    expect(referenceAwareText(parsed)).toBe("Ask @profile about referenced post.");
  });

  it("supports npub, note and address references and leaves invalid values as text", () => {
    const npub = nip19.npubEncode(pubkey);
    const note = nip19.noteEncode(eventId);
    const naddr = nip19.naddrEncode({ kind: 30023, pubkey, identifier: "guide" });
    const parsed = parseNostrReferences(`${npub} ${note} nostr:${naddr} nostr:nevent1broken`);

    expect(parsed.segments.filter(({ kind }) => kind === "profile")).toHaveLength(1);
    expect(parsed.events).toHaveLength(2);
    expect(referenceAwareText(parsed)).toContain("nostr:nevent1broken");
  });
});
