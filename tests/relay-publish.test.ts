import { afterEach, describe, expect, it, vi } from "vitest";
import { finalizeEvent, generateSecretKey } from "nostr-tools/pure";
import { RelayPool } from "applesauce-relay";
import { publishUntilAccepted } from "../src/lib/relay-publish";

const event = finalizeEvent({ kind: 1, created_at: 1, content: "one signed event", tags: [] }, generateSecretKey());
const ack = (from: string, ok: boolean) => ({ from, ok, message: ok ? "saved" : "rejected" });
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };
afterEach(() => vi.useRealTimers());

describe("first relay acceptance", () => {
  it("returns before a hanging relay, fans out once, and keeps the returned snapshot stable", async () => {
    vi.useFakeTimers();
    const later = deferred<ReturnType<typeof ack>[]>();
    const publish = vi.fn(async ([relay]: string[], signed: typeof event) => {
      expect(signed).toBe(event);
      return relay === "fast" ? [ack(relay, true)] : later.promise;
    });
    const result = await publishUntilAccepted({ publish } as never, ["fast", "hang", "fast"], event, 100);
    expect(result).toEqual([ack("fast", true)]);
    expect(publish).toHaveBeenCalledTimes(2);
    later.resolve([ack("hang", false)]);
    await vi.runAllTimersAsync();
    expect(result).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("waits through an early rejection for a later acceptance", async () => {
    const later = deferred<ReturnType<typeof ack>[]>();
    const publish = vi.fn(async ([relay]: string[]) => relay === "reject" ? [ack(relay, false)] : later.promise);
    const result = publishUntilAccepted({ publish } as never, ["reject", "later"], event);
    let done = false;
    void result.then(() => { done = true; });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(done).toBe(false);
    later.resolve([ack("later", true)]);
    expect(await result).toEqual([ack("reject", false), ack("later", true)]);
  });

  it("bounds silent relays and captures thrown, rejected and empty responses", async () => {
    vi.useFakeTimers();
    const publish = vi.fn(([relay]: string[]) => {
      if (relay === "throw") throw new Error("offline");
      if (relay === "reject") return Promise.reject(new Error("disconnected"));
      if (relay === "empty") return Promise.resolve([]);
      return new Promise<never>(() => {});
    });
    const result = publishUntilAccepted({ publish } as never, ["throw", "reject", "empty", "silent"], event, 100);
    await vi.advanceTimersByTimeAsync(100);
    const responses = await result;
    expect(responses).toHaveLength(4);
    expect(responses.every(({ ok }) => !ok)).toBe(true);
    expect(responses.at(-1)?.message).toContain("timed out");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("finishes all rejects immediately and empty relays without publishing", async () => {
    const publish = vi.fn(async ([relay]: string[]) => [ack(relay, false)]);
    expect(await publishUntilAccepted({ publish } as never, [], event)).toEqual([]);
    expect(publish).not.toHaveBeenCalled();
    expect(await publishUntilAccepted({ publish } as never, ["one", "two"], event)).toEqual([ack("one", false), ack("two", false)]);
  });

  it("uses real Applesauce pool aggregation without waiting for another relay", async () => {
    vi.useFakeTimers();
    const pool = new RelayPool();
    const fast = pool.relay("wss://fast.example");
    const slow = pool.relay("wss://slow.example");
    vi.spyOn(fast, "publish").mockResolvedValue(ack(fast.url, true));
    vi.spyOn(slow, "publish").mockImplementation(() => new Promise(() => {}));
    const result = await publishUntilAccepted(pool, [fast.url, slow.url], event, 100);
    expect(result).toEqual([ack(fast.url, true)]);
    expect(fast.publish).toHaveBeenCalledWith(event, { timeout: 100 });
    expect(slow.publish).toHaveBeenCalledTimes(1);
    await vi.runAllTimersAsync();
  });
});
