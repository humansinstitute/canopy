import type { RelayPool } from "applesauce-relay";
import { Subscription } from "rxjs";
import { verifyEvent, type EventTemplate } from "nostr-tools/pure";
import type { NostrEvent, NostrProvider } from "../types";
import { eventStore, relayPool } from "./nostr";
import { publishUntilAccepted } from "./relay-publish";

export const BLOSSOM_LIST_KIND = 10063;
import { normalizeProfileServer, validateProfileServers } from "./blossom-servers";
export { MAX_BLOSSOM_SERVERS, normalizeProfileServer, validateProfileServers } from "./blossom-servers";

export function newestBlossomList(events: NostrEvent[], pubkey: string): NostrEvent | undefined {
  return events.filter((event) => event.kind === BLOSSOM_LIST_KIND && event.pubkey === pubkey)
    .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))[0];
}

export function blossomListTemplate(base: NostrEvent | undefined, servers: string[], now = Math.floor(Date.now() / 1000)): EventTemplate {
  if (base && base.created_at > now) throw new Error("The current list is future-dated. Wait until its timestamp before replacing it.");
  return { kind: BLOSSOM_LIST_KIND, created_at: Math.max(now, (base?.created_at ?? 0) + 1), content: "",
    tags: [...validateProfileServers(servers).map((url) => {
      const retained = base?.tags.find((tag) => { try { return tag[0] === "server" && normalizeProfileServer(tag[1] ?? "") === url; } catch { return false; } });
      return ["server", url, ...(retained?.slice(2) ?? [])];
    }), ...(base?.tags ?? []).filter(([name]) => name !== "server").map((tag) => [...tag])] };
}

/** EOSE from every configured read relay is required. A timeout/CLOSED is not absence. */
export async function readBlossomList(pubkey: string, relays: string[], timeout = 6000): Promise<NostrEvent | undefined> {
  const targets = [...new Set(relays)];
  if (!targets.length) throw new Error("No read relays configured.");
  const batches = await Promise.all(targets.map((url) => new Promise<NostrEvent[]>((resolve, reject) => {
    const found: NostrEvent[] = [];
    const subscription = new Subscription();
    const timer = setTimeout(() => { subscription.unsubscribe(); reject(new Error("Read relays did not finish loading your Blossom list. Retry before publishing.")); }, timeout);
    const fail = () => { clearTimeout(timer); subscription.unsubscribe(); reject(new Error("Your Blossom list could not be reliably read. Retry before publishing.")); };
    subscription.add(relayPool.relay(url).subscription({ kinds: [BLOSSOM_LIST_KIND], authors: [pubkey], limit: 100 }, { reconnect: 0 }).subscribe({
      next: (message) => {
        if (message === "EOSE") {
          clearTimeout(timer); subscription.unsubscribe();
          if (found.length >= 100) reject(new Error("Blossom list response was truncated. Refusing to replace it."));
          else resolve(found);
        } else if (message.pubkey === pubkey && message.kind === BLOSSOM_LIST_KIND && verifyEvent(structuredClone(message))) found.push(message);
      }, error: fail, complete: () => { if (!subscription.closed) fail(); },
    }));
  })));
  const cached = eventStore.getReplaceable(BLOSSOM_LIST_KIND, pubkey) as NostrEvent | undefined;
  const events = batches.flat();
  if (cached && verifyEvent(structuredClone(cached))) events.push(cached);
  const newest = newestBlossomList(events, pubkey);
  if (newest) eventStore.add(newest);
  return newest;
}

export async function publishBlossomList(options: {
  pubkey: string; base?: NostrEvent; servers: string[]; read(): Promise<NostrEvent | undefined>;
  signer: NostrProvider; pool: Pick<RelayPool, "publish">; writeRelays: string[]; active(): boolean;
}) {
  const { base, signer, pubkey, active } = options;
  const assertCurrent = async () => {
    if (!active() || await signer.getPublicKey() !== pubkey || !active()) throw new Error("Account or editor changed; publication cancelled.");
  };
  const assertBase = async () => {
    const current = await options.read();
    if (current?.id !== base?.id) throw new Error("A newer Blossom list was found. Reload and review it before publishing; your edits are still here.");
  };
  if (!options.writeRelays.length) throw new Error("No write relays configured.");
  const template = blossomListTemplate(base, options.servers);
  await assertBase();
  await assertCurrent();
  const signed = await signer.signEvent(structuredClone(template));
  if (signed.pubkey !== pubkey || signed.kind !== template.kind || signed.created_at !== template.created_at || signed.content !== "" || JSON.stringify(signed.tags) !== JSON.stringify(template.tags) || !verifyEvent(structuredClone(signed))) throw new Error("Signer returned a changed or invalid Blossom list.");
  // Amber/browser approval can take time. Check for concurrent edits again before sending.
  await assertBase();
  await assertCurrent();
  const results = await publishUntilAccepted(options.pool, options.writeRelays, signed);
  const accepted = results.filter((result) => result.ok).map((result) => result.from);
  if (!accepted.length) throw new Error(`No relay confirmed publication. Your edits are retained; reload before retrying. ${results.map((r) => r.message).filter(Boolean).join("; ")}`);
  return { event: signed, accepted, total: new Set(options.writeRelays).size };
}
