import { describe, expect, it, vi } from "vitest";
import { finalizeEvent, generateSecretKey, getPublicKey, type EventTemplate, type NostrEvent } from "nostr-tools/pure";
import { ContactListController, isFollowing, mergeProfileMetadata, profileDraft, profileEventTemplate, ProfilePublisher, updateContactListTemplate } from "../src/lib/identity";

const secret = generateSecretKey();
const pubkey = getPublicKey(secret);
const A = "a".repeat(64);
const B = "b".repeat(64);

function contact(tags: string[][], createdAt = 100, content = "opaque-contact-content"): NostrEvent {
  return finalizeEvent({ kind: 3, created_at: createdAt, tags, content }, secret);
}

function metadata(content: string, createdAt = 100): NostrEvent {
  return finalizeEvent({ kind: 0, created_at: createdAt, tags: [], content }, secret);
}

describe("NIP-02 contact lists", () => {
  it("adds only an absent target and preserves relay, petname, extension tags and content exactly", () => {
    const current = contact([["p", A, "wss://hint.example", "Alice"], ["x", "custom", "value"], ["client", "canopy"]]);
    const next = updateContactListTemplate(current, B, true, 101);
    expect(next.tags).toEqual([...current.tags, ["p", B]]);
    expect(next.content).toBe("opaque-contact-content");
    expect(current.tags).toHaveLength(3);
  });

  it("removes every exact target p tag and nothing else", () => {
    const current = contact([["p", A, "wss://one", "Alice"], ["p", B], ["p", A, "wss://two"], ["x", A], ["p", `${A.slice(0, 63)}b`]]);
    const next = updateContactListTemplate(current, A, false, 101);
    expect(next.tags).toEqual([["p", B], ["x", A], ["p", `${A.slice(0, 63)}b`]]);
    expect(isFollowing(finalizeEvent(next, secret), A)).toBe(false);
  });

  it("resolves the latest list before a first mutation and serializes rapid updates on the freshest signed event", async () => {
    const signed: NostrEvent[] = [];
    const original = contact([["p", A, "wss://existing", "Alice"], ["z", "keep"]]);
    const loadLatest = vi.fn(async () => original);
    const inserted: NostrEvent[] = [];
    const controller = new ContactListController(
      async (template: EventTemplate) => { const event = finalizeEvent(template, secret); signed.push(event); return event; },
      { publish: async () => [{ from: "wss://relay", ok: true, message: "saved" }] } as never,
      ["wss://relay"], loadLatest, (event) => inserted.push(event),
    );
    const first = controller.setFollowing(B, true);
    const second = controller.setFollowing(A, false);
    await Promise.all([first, second]);
    expect(loadLatest).toHaveBeenCalledOnce();
    expect(signed[0]?.tags).toEqual([...original.tags, ["p", B]]);
    expect(signed[1]?.tags).toEqual([["z", "keep"], ["p", B]]);
    expect(signed[1]!.created_at).toBeGreaterThan(signed[0]!.created_at);
    expect(inserted).toEqual(signed);
  });

  it("rejects total relay failure without inserting the optimistic replacement", async () => {
    const inserted = vi.fn();
    const controller = new ContactListController(
      async (template: EventTemplate) => finalizeEvent(template, secret),
      { publish: async () => [{ from: "wss://relay", ok: false, message: "offline" }] } as never,
      ["wss://relay"], async () => contact([["p", A]]), inserted,
    );
    await expect(controller.setFollowing(B, true)).rejects.toThrow("Follow could not be published");
    expect(inserted).not.toHaveBeenCalled();
  });
});

describe("kind-0 profile metadata", () => {
  it("prefills and merges managed fields while preserving unknown values", () => {
    const previous = metadata(JSON.stringify({ display_name: "Old", lud06: "lnurl1keep", custom: { theme: "moss" }, website: "https://old.example" }));
    const draft = { ...profileDraft(previous), display_name: "  New Name  ", website: "", about: " Hello " };
    expect(mergeProfileMetadata(previous, draft)).toEqual({ display_name: "New Name", about: "Hello", lud06: "lnurl1keep", custom: { theme: "moss" } });
    const template = profileEventTemplate(previous, draft, 101);
    expect(template.kind).toBe(0);
    expect(template.tags).toEqual([]);
  });

  it("safely starts from empty metadata when prior JSON is malformed", () => {
    const previous = metadata("{not-json");
    const draft = { ...profileDraft(previous), name: "canopy" };
    expect(mergeProfileMetadata(previous, draft)).toEqual({ name: "canopy" });
  });

  it("rejects unsafe URLs and unreasonable field lengths", () => {
    const blank = profileDraft(undefined);
    expect(() => mergeProfileMetadata(undefined, { ...blank, picture: "http://example.com/me.jpg" })).toThrow("Picture must use HTTPS");
    expect(() => mergeProfileMetadata(undefined, { ...blank, website: "not a url" })).toThrow("Website must be a valid HTTPS URL");
    expect(() => mergeProfileMetadata(undefined, { ...blank, nip05: "not-an-address" })).toThrow("NIP-05 address must look like");
    expect(() => mergeProfileMetadata(undefined, { ...blank, display_name: "x".repeat(81) })).toThrow("display name is too long");
  });

  it("prevents duplicate saves, retains total failures, and inserts accepted events", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const inserted: NostrEvent[] = [];
    const publisher = new ProfilePublisher(
      async (template: EventTemplate) => { await gate; return finalizeEvent(template, secret); },
      { publish: async ([relay]: string[]) => [{ from: relay, ok: relay === "wss://one", message: relay === "wss://one" ? "saved" : "offline" }] } as never,
      ["wss://one", "wss://two"], (event) => inserted.push(event),
    );
    const first = publisher.save(undefined, { ...profileDraft(undefined), name: "canopy" });
    await expect(publisher.save(undefined, profileDraft(undefined))).rejects.toThrow("already being saved");
    release();
    await expect(first).resolves.toMatchObject({ status: "published", accepted: 1, rejected: 0 });
    expect(inserted).toHaveLength(1);

    const failed = new ProfilePublisher(
      async (template: EventTemplate) => finalizeEvent(template, secret),
      { publish: async () => [{ from: "wss://one", ok: false, message: "offline" }] } as never,
      ["wss://one"], (event) => inserted.push(event),
    );
    await expect(failed.save(undefined, profileDraft(undefined))).rejects.toThrow("edits are still here");
    expect(inserted).toHaveLength(1);
  });
});
