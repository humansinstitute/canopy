import { afterEach, describe, expect, it, vi } from "vitest";
import { getAccountProvider, setSessionAccount, getNostrProvider, hasRememberedLogin, rememberLogin, requestLogin, watchNostrProvider } from "../src/lib/session";

describe("signer login", () => {
  it("detects only a complete NIP-07 signing surface", () => {
    expect(getNostrProvider({} as Window)).toBeNull();
    const provider = { getPublicKey: async () => "a".repeat(64), signEvent: async () => ({}) as never };
    expect(getNostrProvider({ nostr: provider } as unknown as Window)).toBe(provider);
  });

  it("accepts a valid public key and rejects malformed keys", async () => {
    await expect(requestLogin({ getPublicKey: async () => "A".repeat(64), signEvent: async () => ({}) as never })).resolves.toBe("a".repeat(64));
    await expect(requestLogin({ getPublicKey: async () => "npub1bad", signEvent: async () => ({}) as never })).rejects.toThrow("invalid public key");
  });

  it("remembers only the intent to reconnect through the browser signer", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };

    expect(hasRememberedLogin(storage)).toBe(false);
    rememberLogin(storage);
    expect(hasRememberedLogin(storage)).toBe(true);
    expect([...values.entries()]).toEqual([["canopy.rememberLogin", "1"]]);
  });
});


describe("passive signer discovery", () => {
  afterEach(() => vi.useRealTimers());
  it("finds late injection and partial initialization without invoking permissions", async () => {
    vi.useFakeTimers();
    const events = new EventTarget();
    const target = Object.assign(events, { setInterval, clearInterval, setTimeout, clearTimeout }) as unknown as Window;
    const changed = vi.fn();
    const stop = watchNostrProvider(changed, target);
    await vi.advanceTimersByTimeAsync(0);
    expect(changed).toHaveBeenLastCalledWith(null);
    const getPublicKey = vi.fn();
    target.nostr = { getPublicKey } as unknown as NonNullable<Window["nostr"]>;
    await vi.advanceTimersByTimeAsync(900);
    expect(changed).toHaveBeenCalledTimes(1);
    target.nostr.signEvent = vi.fn();
    await vi.advanceTimersByTimeAsync(300);
    expect(changed).toHaveBeenLastCalledWith(target.nostr);
    expect(getPublicKey).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);
    expect(changed).toHaveBeenCalledTimes(2);
    delete target.nostr;
    events.dispatchEvent(new Event("focus"));
    expect(changed).toHaveBeenLastCalledWith(null);
    stop();
    target.nostr = { getPublicKey, signEvent: vi.fn() };
    events.dispatchEvent(new Event("nostr#initialized"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(changed).toHaveBeenCalledTimes(3);
  });
  it("cleans up before the first check (React StrictMode effect replay)", async () => {
    vi.useFakeTimers();
    const target = Object.assign(new EventTarget(), { setInterval, clearInterval, setTimeout, clearTimeout }) as unknown as Window;
    const changed = vi.fn();
    watchNostrProvider(changed, target)();
    await vi.advanceTimersByTimeAsync(1000);
    expect(changed).not.toHaveBeenCalled();
  });
});

describe("account-bound operations", () => {
  it("uses replacement bridges for the same account and revokes retained handles on logout", async () => {
    setSessionAccount("a".repeat(64));
    const signer = getAccountProvider();
    window.nostr = { getPublicKey: async () => "a".repeat(64), signEvent: vi.fn() };
    await expect(signer.getPublicKey()).resolves.toBe("a".repeat(64));
    delete window.nostr;
    await expect(signer.getPublicKey()).rejects.toThrow("temporarily unavailable");
    window.nostr = { getPublicKey: async () => "a".repeat(64), signEvent: vi.fn() };
    await expect(signer.getPublicKey()).resolves.toBe("a".repeat(64));
    setSessionAccount();
    setSessionAccount("a".repeat(64));
    await expect(signer.getPublicKey()).rejects.toThrow("account changed");
  });

  it("blocks different identities before signing and drops results after an in-place identity switch", async () => {
    let identity = "a".repeat(64);
    let finish!: (event: never) => void;
    const signEvent = vi.fn(() => new Promise<never>(resolve => { finish = resolve; }));
    window.nostr = { getPublicKey: async () => identity, signEvent };
    setSessionAccount(identity);
    const signer = getAccountProvider();
    const template = { kind: 1, created_at: 1, tags: [], content: "private draft" };
    const pending = signer.signEvent(template);
    await vi.waitFor(() => expect(signEvent).toHaveBeenCalledOnce());
    identity = "b".repeat(64);
    finish({ ...template, pubkey: "a".repeat(64) } as never);
    await expect(pending).rejects.toThrow("account changed");
    await expect(signer.signEvent(template)).rejects.toThrow("account changed");
    expect(signEvent).toHaveBeenCalledOnce();
  });
});
