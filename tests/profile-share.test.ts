import { describe, expect, it } from "vitest";
import * as nip19 from "nostr-tools/nip19";
import { profileShareIdentity } from "../src/lib/profile-share";
import { profileUrl } from "../src/lib/routes";

describe("profile sharing", () => {
  it("builds a canonical npub and nostr URI for QR sharing", () => {
    const pubkey = "12".repeat(32);
    const identity = profileShareIdentity(pubkey.toUpperCase());
    expect(identity.npub).toBe(nip19.npubEncode(pubkey));
    expect(identity.nostrUri).toBe(`nostr:${identity.npub}`);
    expect(nip19.decode(identity.npub)).toEqual({ type: "npub", data: pubkey });
    expect(profileUrl("https://canopy.example", pubkey)).toBe(`https://canopy.example/profile/${identity.npub}`);
  });

  it("rejects malformed public keys", () => {
    expect(() => profileShareIdentity("npub1not-a-hex-key")).toThrow("invalid Nostr public key");
  });
});
