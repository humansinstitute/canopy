import { afterEach, describe, expect, it, vi } from "vitest";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { Observable } from "rxjs";
import { blossomListTemplate, newestBlossomList, normalizeProfileServer, publishBlossomList, readBlossomList, validateProfileServers } from "../src/lib/blossom-list";
import { relayPool } from "../src/lib/nostr";

const secret = generateSecretKey();
const pubkey = getPublicKey(secret);
const base = finalizeEvent({ kind: 10063, created_at: 10, content: "", tags: [["server", "https://one.example/path/", "extension"], ["custom", "keep"], ["server", "https://two.example"]] }, secret);
const signed = (template: Parameters<typeof finalizeEvent>[0]) => finalizeEvent(template, secret);
const options = () => ({ pubkey, base, servers: ["https://two.example", "https://one.example/path"], read: vi.fn(async () => base), signer: { getPublicKey: vi.fn(async () => pubkey), signEvent: vi.fn(async (template) => signed(template)) }, pool: { publish: vi.fn(async () => [{ from: "wss://a.example", ok: true }]) } as never, writeRelays: ["wss://a.example", "wss://b.example"], active: () => true });
afterEach(() => vi.restoreAllMocks());

describe("BUD-03 publication", () => {
  it("normalizes ordered paths, rejects duplicates, empty lists and unsafe URLs", () => {
    expect(normalizeProfileServer("https://EXAMPLE.com:443/a/")).toBe("https://example.com/a");
    expect(validateProfileServers(["https://b.example", "https://a.example/path"])).toEqual(["https://b.example", "https://a.example/path"]);
    for (const url of ["http://a.example", "https://name:secret@a.example", "https://a.example?token=secret", "https://a.example#x", "bad", "https:\\evil.example"]) expect(() => validateProfileServers([url])).toThrow();
    expect(() => validateProfileServers([])).toThrow("requires");
    expect(() => validateProfileServers(["https://a.example", "https://A.example/"])).toThrow("duplicate");
  });
  it("preserves unknown and retained server tag fields, order and empty content", () => {
    expect(blossomListTemplate(base, ["https://two.example", "https://one.example/path"], 20)).toEqual({ kind: 10063, created_at: 20, content: "", tags: [["server", "https://two.example"], ["server", "https://one.example/path", "extension"], ["custom", "keep"]] });
    expect(() => blossomListTemplate(base, ["https://a.example"], 9)).toThrow("future");
    expect(blossomListTemplate(base, ["https://a.example"], 10).created_at).toBe(11);
  });
  it("resolves timestamp ties by smallest ID and isolates accounts", () => {
    const a = { ...base, id: "a".repeat(64) }, b = { ...base, id: "b".repeat(64) };
    expect(newestBlossomList([b, { ...base, pubkey: "f".repeat(64), created_at: 999 }, a], pubkey)).toBe(a);
  });
  it("rechecks freshness after signer and reports only acknowledged relays", async () => {
    const opts = options(); const result = await publishBlossomList(opts);
    expect(opts.read).toHaveBeenCalledTimes(2);
    expect(result.accepted).toEqual(["wss://a.example"]);
    expect(result.total).toBe(2);
    expect(result.event.tags[0]).toEqual(["server", "https://two.example"]);
  });
  it("retains edits on rejection, cancellation, account switch and changed signer body", async () => {
    const reject = options(); reject.signer.signEvent.mockRejectedValue(new Error("Cancelled"));
    await expect(publishBlossomList(reject)).rejects.toThrow("Cancelled");
    const changed = options(); changed.signer.getPublicKey.mockResolvedValue("f".repeat(64));
    await expect(publishBlossomList(changed)).rejects.toThrow("cancelled");
    expect(changed.signer.signEvent).not.toHaveBeenCalled();
    const closed = options(); closed.active = () => false;
    await expect(publishBlossomList(closed)).rejects.toThrow("cancelled");
    const altered = options(); altered.signer.signEvent.mockImplementation(async (t) => signed({ ...t, tags: [] }));
    await expect(publishBlossomList(altered)).rejects.toThrow("changed or invalid");
    const failure = options(); failure.pool = { publish: vi.fn(async () => [{ from: "wss://a.example", ok: false, message: "blocked" }]) } as never;
    await expect(publishBlossomList(failure)).rejects.toThrow("No relay confirmed");
  });
  it("refuses a newer baseline before signing and during approval", async () => {
    const newer = finalizeEvent({ ...base, created_at: 11 }, secret);
    const stale = options(); stale.read.mockResolvedValue(newer);
    await expect(publishBlossomList(stale)).rejects.toThrow("newer Blossom list");
    expect(stale.signer.signEvent).not.toHaveBeenCalled();
    const racing = options(); racing.read.mockResolvedValueOnce(base).mockResolvedValueOnce(newer);
    await expect(publishBlossomList(racing)).rejects.toThrow("newer Blossom list");
  });
  it("requires EOSE from every relay and validates ingress", async () => {
    const isolatedKey = getPublicKey(generateSecretKey());
    vi.spyOn(relayPool, "relay").mockImplementation((url) => ({ subscription: () => new Observable((s) => { queueMicrotask(() => { if (url.includes("complete")) { s.next("EOSE"); s.complete(); } }); }) }) as never);
    await expect(readBlossomList(isolatedKey, ["wss://complete.example", "wss://silent.example"], 10)).rejects.toThrow("did not finish");
    await expect(readBlossomList(isolatedKey, ["wss://complete.example"], 10)).resolves.toBeUndefined();
    vi.mocked(relayPool.relay).mockImplementation(() => ({ subscription: () => new Observable((s) => { queueMicrotask(() => { s.next({ ...base, sig: "0".repeat(128) }); s.next(base); s.next("EOSE"); }); }) }) as never);
    await expect(readBlossomList(pubkey, ["wss://complete.example"], 100)).resolves.toMatchObject({ id: base.id, sig: base.sig });
  });
});
