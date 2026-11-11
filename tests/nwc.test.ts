import { beforeEach, describe, expect, it, vi } from "vitest";
import { nip04, nip44 } from "nostr-tools";
import { finalizeEvent, generateSecretKey, getPublicKey, type NostrEvent } from "nostr-tools/pure";
import { bytesToHex } from "nostr-tools/utils";
import { of, Subject } from "rxjs";
import { clearNwcConnection, loadNwcConnection, nwcConnectionSummary, parseNwcConnection, payInvoiceWithNwc, saveNwcConnection } from "../src/lib/nwc";

const walletSecret = generateSecretKey();
const walletPubkey = getPublicKey(walletSecret);
const clientSecret = generateSecretKey();
const clientSecretHex = bytesToHex(clientSecret);
const uri = `nostr+walletconnect://${walletPubkey}?relay=${encodeURIComponent("wss://wallet.example")}&secret=${clientSecretHex}`;
const invoice = `lnbc${"a".repeat(80)}`;

describe("NIP-47 wallet connections", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
    });
  });

  it("strictly validates and stores a masked browser-local connection", () => {
    expect(parseNwcConnection(uri)).toEqual({ walletPubkey, secret: clientSecretHex, relays: ["wss://wallet.example"] });
    saveNwcConnection("a".repeat(64), uri);
    expect(loadNwcConnection("a".repeat(64))).toBe(uri);
    expect(nwcConnectionSummary(uri)).not.toContain(clientSecretHex);
    clearNwcConnection("a".repeat(64));
    expect(loadNwcConnection("a".repeat(64))).toBeUndefined();
    expect(() => parseNwcConnection(uri.replace("wss%3A", "ws%3A"))).toThrow("secure WSS");
  });

  it("negotiates NIP-44, publishes a correlated pay_invoice request, and decrypts the response", async () => {
    const responses = new Subject<NostrEvent>();
    const info = finalizeEvent({ kind: 13_194, created_at: 10, tags: [["encryption", "nip44_v2 nip04"]], content: "pay_invoice get_balance" }, walletSecret);
    let sent: NostrEvent | undefined;
    const pool = {
      request: () => of(info),
      subscription: () => responses,
      publish: vi.fn(async (_relays: string[], event: NostrEvent) => {
        sent = event;
        const conversationKey = nip44.v2.utils.getConversationKey(walletSecret, event.pubkey);
        expect(JSON.parse(nip44.v2.decrypt(event.content, conversationKey))).toEqual({ method: "pay_invoice", params: { invoice } });
        expect(event.tags).toContainEqual(["encryption", "nip44_v2"]);
        const response = finalizeEvent({ kind: 23_195, created_at: event.created_at, tags: [["p", event.pubkey], ["e", event.id]], content: nip44.v2.encrypt(JSON.stringify({ result_type: "pay_invoice", result: { preimage: "paid", fees_paid: 21 } }), conversationKey) }, walletSecret);
        queueMicrotask(() => responses.next(response));
        return [{ from: "wss://wallet.example", ok: true, message: "saved", event }];
      }),
    };
    const result = await payInvoiceWithNwc(uri, invoice, pool as never, 1_000);
    expect(sent?.kind).toBe(23_194);
    expect(sent?.pubkey).toBe(getPublicKey(clientSecret));
    expect(result).toMatchObject({ preimage: "paid", feesPaid: 21, requestId: sent?.id });
  });

  it("uses legacy NIP-04 only when wallet info does not advertise encryption", async () => {
    const responses = new Subject<NostrEvent>();
    const info = finalizeEvent({ kind: 13_194, created_at: 10, tags: [], content: "pay_invoice" }, walletSecret);
    const pool = {
      request: () => of(info),
      subscription: () => responses,
      publish: async (_relays: string[], event: NostrEvent) => {
        expect(event.tags.some(([name]) => name === "encryption")).toBe(false);
        expect(JSON.parse(nip04.decrypt(walletSecret, event.pubkey, event.content)).method).toBe("pay_invoice");
        const response = finalizeEvent({ kind: 23_195, created_at: event.created_at, tags: [["p", event.pubkey], ["e", event.id]], content: nip04.encrypt(walletSecret, event.pubkey, JSON.stringify({ result_type: "pay_invoice", result: { preimage: "legacy-paid" } })) }, walletSecret);
        queueMicrotask(() => responses.next(response));
        return [{ from: "wss://wallet.example", ok: true, message: "saved", event }];
      },
    };
    await expect(payInvoiceWithNwc(uri, invoice, pool as never, 1_000)).resolves.toMatchObject({ preimage: "legacy-paid" });
  });

  it("rejects connections without pay_invoice permission before publishing", async () => {
    const info = finalizeEvent({ kind: 13_194, created_at: 10, tags: [["encryption", "nip44_v2"]], content: "get_balance" }, walletSecret);
    const publish = vi.fn();
    await expect(payInvoiceWithNwc(uri, invoice, { request: () => of(info), subscription: () => new Subject(), publish } as never, 100)).rejects.toThrow("not allowed");
    expect(publish).not.toHaveBeenCalled();
  });

  it("times out and cleans up when an accepted request receives no response", async () => {
    const info = finalizeEvent({ kind: 13_194, created_at: 10, tags: [["encryption", "nip44_v2"]], content: "pay_invoice" }, walletSecret);
    const responses = new Subject<NostrEvent>();
    await expect(payInvoiceWithNwc(uri, invoice, {
      request: () => of(info),
      subscription: () => responses,
      publish: async (_relays: string[], event: NostrEvent) => [{ from: "wss://wallet.example", ok: true, message: "saved", event }],
    } as never, 10)).rejects.toThrow("did not respond in time");
    expect(responses.observed).toBe(false);
  });
});
