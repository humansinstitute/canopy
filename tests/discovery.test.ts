import { describe, expect, it } from "vitest";
import { finalizeEvent, generateSecretKey, getPublicKey, type NostrEvent } from "nostr-tools/pure";
import { classifyLookmark, dedupeLookmarks, networkHighlights } from "../src/lib/discovery";

const followedSecret = generateSecretKey();
const followed = getPublicKey(followedSecret);
const outsiderSecret = generateSecretKey();
const target = "c".repeat(64);

function event(kind: number, content: string, tags: string[][], createdAt: number, secret = followedSecret): NostrEvent {
  return finalizeEvent({ kind, content, tags, created_at: createdAt }, secret);
}

describe("NIP-84 network highlights", () => {
  it("keeps only followed kind-9802 events, newest first, with source and context", () => {
    const older = event(9802, "A useful passage", [["e", target, "wss://source"], ["context", "Surrounding paragraph"], ["comment", "Worth revisiting"]], 10);
    const media = event(9802, "", [["r", "https://example.com/video", "source"]], 11);
    const like = event(7, "+", [["e", target]], 12);
    const outsider = event(9802, "Outsider", [["e", target]], 13, outsiderSecret);
    const result = networkHighlights([older, media, like, outsider], [followed]);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ excerpt: "Media or non-text highlight", source: { type: "r", value: "https://example.com/video" } });
    expect(result[1]).toMatchObject({ excerpt: "A useful passage", context: "Surrounding paragraph", comment: "Worth revisiting" });
  });
});

describe("LookMarks classification", () => {
  it("classifies only the documented reaction, NIP-10 reply, and NIP-18 quote shapes", () => {
    expect(classifyLookmark(event(7, "👀", [["e", target]], 1))?.type).toBe("reaction");
    expect(classifyLookmark(event(1, "take a look 👀", [["e", target, "", "reply"]], 2))?.type).toBe("reply");
    expect(classifyLookmark(event(1, "quoted 👀", [["q", target, "wss://quote"]], 3))?.type).toBe("quote");
    expect(classifyLookmark(event(7, "+", [["e", target]], 4))).toBeUndefined();
    expect(classifyLookmark(event(1, "👀 but no reference", [], 5))).toBeUndefined();
  });

  it("deduplicates targets while retaining newest and distinct signal context", () => {
    const reaction = event(7, "👀", [["e", target]], 10);
    const reply = event(1, "👀 later", [["e", target, "", "reply"]], 12);
    const quote = event(1, "👀 quote", [["q", target]], 11);
    const outsider = event(7, "👀", [["e", "d".repeat(64)]], 20, outsiderSecret);
    const result = dedupeLookmarks([reaction, reply, quote, outsider], [followed]);
    expect(result).toHaveLength(1);
    expect(result[0].targetId).toBe(target);
    expect(result[0].latestAt).toBe(12);
    expect(result[0].signals.map(({ type }) => type)).toEqual(["reply", "quote", "reaction"]);
  });
});
