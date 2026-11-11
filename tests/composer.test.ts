import { describe, expect, it } from "vitest";
import * as nip19 from "nostr-tools/nip19";
import { activeMentionPubkeys, commonsGifSearchUrl, findEmojiQuery, findMentionQuery, insertMediaUrl, insertMention, insertText, parseCommonsGifs, searchEmoji } from "../src/lib/composer";

describe("composer enhancements", () => {
  it("finds shortcode queries only at the cursor after a boundary", () => {
    expect(findEmojiQuery("Ready :thu", 10)).toEqual({ start: 6, end: 10, query: "thu" });
    expect(findEmojiQuery("https://example.com:443", 23)).toBeUndefined();
    expect(searchEmoji("thu")[0]).toMatchObject({ emoji: "👍", shortcode: "thumbsup" });
  });

  it("replaces a shortcode or inserts a media URL at the selected position", () => {
    expect(insertText("Ready :thu", 6, 10, "👍")).toEqual({ value: "Ready 👍", cursor: 8 });
    expect(insertMediaUrl("before after", 7, 7, "https://upload.wikimedia.org/test.gif")).toEqual({
      value: "before \nhttps://upload.wikimedia.org/test.gif\nafter",
      cursor: 46,
    });
  });

  it("builds a CORS-enabled Commons search and accepts only safe GIF results", () => {
    const url = new URL(commonsGifSearchUrl("happy dance"));
    expect(url.hostname).toBe("commons.wikimedia.org");
    expect(url.searchParams.get("origin")).toBe("*");
    expect(url.searchParams.get("gsrsearch")).toBe("happy dance filemime:image/gif");
    expect(parseCommonsGifs({ query: { pages: [
      { title: "File:Happy.gif", imageinfo: [{ mime: "image/gif", url: "https://upload.wikimedia.org/happy.gif", descriptionurl: "https://commons.wikimedia.org/wiki/File:Happy.gif", width: 200, height: 100, size: 1234 }] },
      { title: "File:Wrong.png", imageinfo: [{ mime: "image/png", url: "https://upload.wikimedia.org/wrong.png", descriptionurl: "https://commons.wikimedia.org/wiki/File:Wrong.png" }] },
      { title: "File:Unsafe.gif", imageinfo: [{ mime: "image/gif", url: "http://example.com/unsafe.gif", descriptionurl: "https://commons.wikimedia.org/wiki/File:Unsafe.gif" }] },
    ] } })).toEqual([{ title: "Happy.gif", url: "https://upload.wikimedia.org/happy.gif", sourceUrl: "https://commons.wikimedia.org/wiki/File:Happy.gif", width: 200, height: 100, size: 1234 }]);
  });

  it("finds an active @ token and replaces only that token at the cursor", () => {
    const value = "Keep this draft and say @ali tomorrow";
    const query = findMentionQuery(value, 28)!;
    expect(query).toEqual({ start: 24, end: 28, query: "ali" });
    const inserted = insertMention(value, query, { pubkey: "11".repeat(32) }, ["wss://relay.example"]);
    expect(inserted.value.startsWith("Keep this draft and say nostr:nprofile1")).toBe(true);
    expect(inserted.value.endsWith(" tomorrow")).toBe(true);
    const decoded = nip19.decode(inserted.mention.reference.slice(6));
    expect(decoded).toMatchObject({ type: "nprofile", data: { pubkey: "11".repeat(32), relays: ["wss://relay.example"] } });
    expect(findMentionQuery("email@example.com", 17)).toBeUndefined();
  });

  it("keeps p-tag provenance tied to selected references and deduplicates people", () => {
    const mention = { pubkey: "22".repeat(32), reference: "nostr:nprofile1selected" };
    expect(activeMentionPubkeys(`hello ${mention.reference}`, [mention, mention])).toEqual([mention.pubkey]);
    expect(activeMentionPubkeys("nostr:nprofile1typed-by-hand", [mention])).toEqual([]);
  });
});
