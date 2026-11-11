import { describe, expect, it } from "vitest";
import * as nip19 from "nostr-tools/nip19";
import { canonicalRoute, eventRoute, eventUrl, formatRoute, parseRoute, profileRoute, profileUrl } from "../src/lib/routes";

describe("Canopy routes", () => {
  const pubkey = "12".repeat(32);
  const eventId = "ab".repeat(32);

  it("parses and formats every durable static and saved route", () => {
    for (const path of ["/feed", "/search", "/activity", "/saved/bookmarks", "/saved/highlights", "/saved/lookmarks"]) {
      expect(formatRoute(parseRoute(path))).toBe(path);
    }
    expect(canonicalRoute(parseRoute("/"))).toEqual({ kind: "feed" });
  });

  it("uses canonical npub and nevent route segments with capped, deduplicated relay hints", () => {
    const profile = profileRoute(pubkey);
    expect(formatRoute(profile)).toBe(`/profile/${nip19.npubEncode(pubkey)}`);
    expect(parseRoute(formatRoute(profile))).toEqual(profile);

    const event = eventRoute(eventId, ["wss://one.example", "wss://one.example/", "https://bad.example", "wss://two.example", "wss://three.example", "wss://four.example", "wss://five.example"], { author: pubkey, kind: 1 });
    expect(event.kind).toBe("event");
    if (event.kind !== "event") throw new Error("expected event route");
    expect(event.target.relayHints).toEqual(["wss://one.example", "wss://two.example", "wss://three.example", "wss://four.example"]);
    expect(parseRoute(formatRoute(event))).toMatchObject({ kind: "event", eventId });
  });

  it("rejects wrong NIP-19 types, malformed identifiers, noncanonical identifiers and unsupported paths", () => {
    expect(parseRoute(`/profile/${nip19.noteEncode(eventId)}`).kind).toBe("not-found");
    expect(parseRoute("/profile/npub1broken")).toMatchObject({ kind: "not-found", reason: "The profile npub is malformed." });
    expect(parseRoute(`/event/${nip19.npubEncode(pubkey)}`).kind).toBe("not-found");
    expect(parseRoute("/event/nevent1broken")).toMatchObject({ kind: "not-found", reason: "The event nevent is malformed." });
    expect(parseRoute("/saved/personal").kind).toBe("not-found");
    expect(parseRoute("/anything/else").kind).toBe("not-found");
  });

  it("constructs absolute, copyable profile and event URLs", () => {
    expect(profileUrl("https://canopy.example/base", pubkey)).toBe(`https://canopy.example/profile/${nip19.npubEncode(pubkey)}`);
    const url = new URL(eventUrl("https://canopy.example", eventId, ["wss://relay.example"], { author: pubkey, kind: 1 }));
    expect(url.pathname).toMatch(/^\/event\/nevent1/);
    expect(parseRoute(url.pathname)).toMatchObject({ kind: "event", eventId });
  });
});
