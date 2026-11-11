import { setSessionAccount } from "../src/lib/session";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { finalizeEvent, generateSecretKey, getPublicKey, type EventTemplate, type NostrEvent } from "nostr-tools/pure";
import { useFetchImplementation } from "nostr-tools/nip57";
import { likeNote, replyToNote, repostNote, validateZapAmount, zapNote } from "../src/lib/interactions";

const ownerSecret = generateSecretKey();
const authorSecret = generateSecretKey();
const authorPubkey = getPublicKey(authorSecret);
const note = finalizeEvent({ kind: 1, created_at: 1_700_000_000, tags: [], content: "hello" }, authorSecret);

function tag(event: NostrEvent, name: string): string[] | undefined {
  return event.tags.find(([kind]) => kind === name);
}

describe("note interactions", () => {
  beforeEach(() => {
    setSessionAccount(getPublicKey(ownerSecret));
    window.nostr = {
      getPublicKey: async () => getPublicKey(ownerSecret),
      signEvent: async (template: EventTemplate) => finalizeEvent(template, ownerSecret),
    };
  });

  afterEach(() => {
    delete window.webln;
    vi.restoreAllMocks();
    useFetchImplementation(globalThis.fetch);
  });

  it("publishes signed likes and reposts through the supplied relay pool", async () => {
    const published: NostrEvent[] = [];
    const pool = { publish: async (_relays: string[], event: NostrEvent) => {
      published.push(event);
      return [{ from: "wss://relay.example", ok: true, message: "saved" }];
    } } as never;

    const liked = await likeNote(note, ["wss://relay.example"], pool);
    const reposted = await repostNote(note, ["wss://relay.example"], pool);

    expect(liked.event.kind).toBe(7);
    expect(tag(liked.event, "e")?.[1]).toBe(note.id);
    expect(tag(liked.event, "p")?.[1]).toBe(authorPubkey);
    expect(reposted.event.kind).toBe(6);
    expect(reposted.event.content).toContain(note.id);
    expect(published).toHaveLength(2);
  });

  it("creates a NIP-10 reply and reports relay failures", async () => {
    const result = await replyToNote(note, "  a useful reply  ", ["wss://relay.example"], {
      publish: async () => [{ from: "wss://relay.example", ok: false, message: "offline" }],
    } as never);

    expect(result.event.kind).toBe(1);
    expect(result.event.content).toBe("a useful reply");
    expect(tag(result.event, "e")?.[1]).toBe(note.id);
    expect(tag(result.event, "p")?.[1]).toBe(authorPubkey);
    expect(result.status).toBe("failed");
  });

  it("adds selected people once while preserving reply p tags", async () => {
    const mentioned = getPublicKey(generateSecretKey());
    const result = await replyToNote(note, "hello mention", ["wss://relay.example"], {
      publish: async () => [{ from: "wss://relay.example", ok: true, message: "ok" }],
    } as never, [mentioned, mentioned, authorPubkey]);
    expect(result.event.tags.filter(([name, value]) => name === "p" && value === mentioned)).toHaveLength(1);
    expect(result.event.tags.filter(([name, value]) => name === "p" && value === authorPubkey)).toHaveLength(1);
    expect(result.event.tags.some(([name]) => name === "e")).toBe(true);
  });

  it("signs a NIP-57 zap request and hands the invoice to WebLN", async () => {
    const invoice = `lnbc${"a".repeat(80)}`;
    const lnurlFetch = vi.fn(async () => new Response(JSON.stringify({
      allowsNostr: true,
      nostrPubkey: authorPubkey,
      callback: "https://pay.example/zap",
    })));
    useFetchImplementation(lnurlFetch);
    const invoiceFetch = vi.fn(async () => new Response(JSON.stringify({ pr: invoice })));
    vi.stubGlobal("fetch", invoiceFetch);
    const enable = vi.fn(async () => undefined);
    const sendPayment = vi.fn(async () => ({ preimage: "ok" }));
    window.webln = { enable, sendPayment };
    const profile = finalizeEvent({ kind: 0, created_at: 1_700_000_001, tags: [], content: JSON.stringify({ lud16: "alice@example.com" }) }, authorSecret);

    const result = await zapNote(note, profile, 21, ["wss://relay.example"], "great note");

    expect(result.status).toBe("paid");
    expect(result.zapRequest.kind).toBe(9734);
    expect(tag(result.zapRequest, "amount")?.[1]).toBe("21000");
    expect(tag(result.zapRequest, "e")?.[1]).toBe(note.id);
    expect(result.zapRequest.content).toBe("great note");
    expect(lnurlFetch).toHaveBeenCalledWith("https://example.com/.well-known/lnurlp/alice");
    expect(invoiceFetch).toHaveBeenCalledOnce();
    expect(enable).toHaveBeenCalledOnce();
    expect(sendPayment).toHaveBeenCalledWith(invoice);
  });

  it("prefers a configured NIP-47 payer over WebLN", async () => {
    const invoice = `lnbc${"b".repeat(80)}`;
    useFetchImplementation(vi.fn(async () => new Response(JSON.stringify({ allowsNostr: true, nostrPubkey: authorPubkey, callback: "https://pay.example/zap" }))));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ pr: invoice }))));
    const sendPayment = vi.fn();
    window.webln = { enable: vi.fn(), sendPayment };
    const payInvoice = vi.fn(async () => ({ preimage: "paid" }));
    const profile = finalizeEvent({ kind: 0, created_at: 1_700_000_001, tags: [], content: JSON.stringify({ lud16: "alice@example.com" }) }, authorSecret);
    const result = await zapNote(note, profile, 21, ["wss://relay.example"], "", payInvoice);
    expect(result.paymentMethod).toBe("nwc");
    expect(payInvoice).toHaveBeenCalledWith(invoice);
    expect(sendPayment).not.toHaveBeenCalled();
  });

  it("rejects unsafe zap amounts", () => {
    expect(() => validateZapAmount(0)).toThrow("whole zap amount");
    expect(() => validateZapAmount(1.5)).toThrow("whole zap amount");
    expect(() => validateZapAmount(1_000_001)).toThrow("whole zap amount");
  });
});
