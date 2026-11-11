import { describe, expect, it } from "vitest";
import { finalizeEvent, generateSecretKey, getPublicKey, type EventTemplate, type NostrEvent } from "nostr-tools/pure";
import { BookmarkController, freshestBookmarkList, parseBookmarkList, updateBookmarkTemplate } from "../src/lib/bookmarks";

const secret = generateSecretKey();
const pubkey = getPublicKey(secret);
const NOTE_A = "a".repeat(64);
const NOTE_B = "b".repeat(64);

function list(tags: string[][], content = "opaque-private-content", createdAt = 100): NostrEvent {
  return finalizeEvent({ kind: 10003, created_at: createdAt, tags, content }, secret);
}

describe("NIP-51 bookmarks", () => {
  it("parses valid public note and article entries without interpreting private content", () => {
    const event = list([["e", NOTE_A, "wss://hint.example"], ["a", `30023:${pubkey}:article`], ["e", "bad"], ["x", "extension"]]);
    const parsed = parseBookmarkList(event);
    expect(parsed.notes).toEqual([{ id: NOTE_A, relay: "wss://hint.example" }]);
    expect(parsed.articles).toEqual([`30023:${pubkey}:article`]);
    expect(parsed.event?.content).toBe("opaque-private-content");
  });

  it("immutably adds and removes only the target e tag while preserving every other tag and content", () => {
    const original = list([["a", `30023:${pubkey}:article`], ["x", "extension", "value"], ["e", NOTE_A, "wss://old.example"]]);
    const added = updateBookmarkTemplate(original, NOTE_B, true, "wss://new.example", 101);
    expect(added.tags).toEqual([...original.tags, ["e", NOTE_B, "wss://new.example"]]);
    expect(added.content).toBe(original.content);
    expect(original.tags).toHaveLength(3);

    const removed = updateBookmarkTemplate(finalizeEvent(added, secret), NOTE_A, false, undefined, 102);
    expect(removed.tags).toContainEqual(["a", `30023:${pubkey}:article`]);
    expect(removed.tags).toContainEqual(["x", "extension", "value"]);
    expect(removed.tags).toContainEqual(["e", NOTE_B, "wss://new.example"]);
    expect(removed.tags).not.toContainEqual(["e", NOTE_A, "wss://old.example"]);
    expect(removed.content).toBe("opaque-private-content");
  });

  it("creates a valid empty public list and chooses the freshest signed replacement", () => {
    const template = updateBookmarkTemplate(undefined, NOTE_A, true, undefined, 200);
    expect(template).toMatchObject({ kind: 10003, created_at: 200, content: "", tags: [["e", NOTE_A]] });
    const older = list([], "", 10);
    const newer = list([["e", NOTE_A]], "", 11);
    expect(freshestBookmarkList([older, newer], pubkey)?.id).toBe(newer.id);
  });

  it("optimistically updates, rolls back one failed control, and keeps other controls usable", async () => {
    const snapshots: Array<{ saved: string[]; pending: string[]; error?: string }> = [];
    const controller = new BookmarkController(
      async (template: EventTemplate) => finalizeEvent(template, secret),
      { publish: async (_relays: string[], event: NostrEvent) => [{ from: "wss://relay", ok: event.tags.some((tag) => tag[1] === NOTE_B), message: "offline" }] } as never,
      ["wss://relay"],
    );
    controller.subscribe((snapshot) => snapshots.push({ saved: [...snapshot.saved], pending: [...snapshot.pending], error: snapshot.errors.get(NOTE_A) }));
    const failed = controller.toggle(NOTE_A);
    expect(controller.snapshot().saved.has(NOTE_A)).toBe(true);
    expect(controller.snapshot().pending.has(NOTE_A)).toBe(true);
    expect(controller.snapshot().pending.has(NOTE_B)).toBe(false);
    await failed;
    expect(controller.snapshot().saved.has(NOTE_A)).toBe(false);
    expect(controller.snapshot().errors.get(NOTE_A)).toBe("Bookmark could not be saved.");
    expect(snapshots.some(({ saved, pending }) => saved.includes(NOTE_A) && pending.includes(NOTE_A))).toBe(true);
  });

  it("serializes rapid updates against the freshest successful event", async () => {
    const signed: NostrEvent[] = [];
    const controller = new BookmarkController(
      async (template: EventTemplate) => {
        const event = finalizeEvent(template, secret);
        signed.push(event);
        return event;
      },
      { publish: async () => [{ from: "wss://relay", ok: true, message: "saved" }] } as never,
      ["wss://relay"],
    );
    const first = controller.toggle(NOTE_A);
    const second = controller.toggle(NOTE_B);
    expect(controller.snapshot().saved).toEqual(new Set([NOTE_A, NOTE_B]));
    await Promise.all([first, second]);
    expect(signed).toHaveLength(2);
    expect(parseBookmarkList(signed[1]).notes.map(({ id }) => id)).toEqual([NOTE_A, NOTE_B]);
    expect(controller.snapshot().event?.id).toBe(signed[1].id);
  });
});
