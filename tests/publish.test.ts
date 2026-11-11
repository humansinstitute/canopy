import { setSessionAccount } from "../src/lib/session";
import { finalizeEvent, generateSecretKey, getPublicKey, type EventTemplate } from "nostr-tools/pure";
import { describe, expect, it } from "vitest";
import * as nip19 from "nostr-tools/nip19";
import { PostPublisher, quoteContent, validatePost } from "../src/lib/publish";

function installSigner() {
  const secret = generateSecretKey();
  setSessionAccount(getPublicKey(secret));
  window.nostr = {
    getPublicKey: async () => getPublicKey(secret),
    signEvent: async (template: EventTemplate) => finalizeEvent(template, secret),
  };
}

describe("quick post", () => {
  it("builds kind 1, signs and completes on acceptance", async () => {
    installSigner();
    const result = await new PostPublisher().publish("  hello nostr  ", ["wss://one", "wss://two"], {
      publish: async ([relay]: string[]) => [{ from: relay, ok: relay === "wss://one", message: relay === "wss://one" ? "ok" : "down" }],
    } as never);
    expect(result.event.kind).toBe(1);
    expect(result.event.content).toBe("hello nostr");
    expect(result.status).toBe("success");
  });

  it("prevents duplicate concurrent publication", async () => {
    installSigner();
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const publisher = new PostPublisher();
    const first = publisher.publish("first", ["wss://one"], { publish: async () => { await waiting; return [{ from: "wss://one", ok: true, message: "ok" }]; } } as never);
    await expect(publisher.publish("second", ["wss://one"], {} as never)).rejects.toThrow("already being published");
    release();
    await first;
  });

  it("rejects blank and pathological posts", () => {
    expect(() => validatePost("  ")).toThrow("Write something");
    expect(() => validatePost("x".repeat(2801))).toThrow("2,800");
  });

  it("publishes deduplicated selected p tags and a portable NIP-18 quote", async () => {
    installSigner();
    const quotedSecret = generateSecretKey();
    const quoted = finalizeEvent({ kind: 1, created_at: 1_700_000_000, tags: [], content: "source note" }, quotedSecret);
    const mentioned = getPublicKey(generateSecretKey());
    const result = await new PostPublisher().publish("my take", ["wss://write.example"], {
      publish: async (_relays: string[], event: ReturnType<typeof finalizeEvent>) => [{ from: "wss://write.example", ok: Boolean(event.id), message: "ok" }],
    } as never, { mentionedPubkeys: [mentioned, mentioned], quote: { event: quoted, relayHint: "wss://read.example" } });
    const q = result.event.tags.find(([name]) => name === "q");
    expect(q).toEqual(["q", quoted.id, "wss://read.example", quoted.pubkey]);
    expect(result.event.tags.filter(([name, value]) => name === "p" && value === mentioned)).toHaveLength(1);
    const rawReference = result.event.content.split("\n\n").at(-1)!;
    const decoded = nip19.decode(rawReference.slice(6));
    expect(decoded).toMatchObject({ type: "nevent", data: { id: quoted.id, author: quoted.pubkey, relays: ["wss://read.example"] } });
    expect(quoteContent("", { event: quoted })).toMatch(/^nostr:nevent1/);
  });
});

