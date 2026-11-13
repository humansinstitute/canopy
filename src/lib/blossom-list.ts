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

export interface BlossomSnapshot {
  event?: NostrEvent;
  completed: string[];
  failed: string[];
  cachedUnwitnessed: boolean;
}
export const uncertainBlossomSnapshot = (s: BlossomSnapshot) => s.failed.length > 0 || s.cachedUnwitnessed;
export function blossomSnapshotWarning(s: BlossomSnapshot): string {
  return [
    s.failed.length ? `Only ${s.completed.length} of ${s.completed.length + s.failed.length} relays responded completely. Other relays may have a newer list.` : "",
    s.cachedUnwitnessed ? "Keeping your newest verified cached list; responding relays did not return it." : "",
    !s.event ? "No list found on responding relays. This does not prove no list exists elsewhere." : "",
  ].filter(Boolean).join(" ");
}

/** Bounded parallel reads: only complete, untruncated responses establish coverage. */
export async function readBlossomList(pubkey: string, relays: string[], timeout = 6000): Promise<BlossomSnapshot> {
  const targets = [...new Set(relays)];
  if (!targets.length) throw new Error("No read relays configured.");
  const batches = await Promise.all(targets.map((url) => new Promise<{ events: NostrEvent[]; complete: boolean }>((resolve) => {
    const found: NostrEvent[] = [];
    const subscription = new Subscription();
    let settled = false;
    const finish = (events?: NostrEvent[]) => {
      if (settled) return;
      settled = true; clearTimeout(timer); subscription.unsubscribe(); resolve({ events: events ?? found, complete: events !== undefined });
    };
    const timer = setTimeout(() => finish(), timeout);
    try {
      subscription.add(relayPool.relay(url).subscription({ kinds: [BLOSSOM_LIST_KIND], authors: [pubkey], limit: 100 }, { reconnect: 0 }).subscribe({
        next: (message) => {
          if (message === "EOSE") finish(found.length < 100 ? found : undefined);
          else if (message.pubkey === pubkey && message.kind === BLOSSOM_LIST_KIND && verifyEvent(structuredClone(message))) found.push(message);
        }, error: () => finish(), complete: () => finish(),
      }));
    } catch { finish(); }
  })));
  const completed = targets.filter((_, i) => batches[i]!.complete);
  const failed = targets.filter((_, i) => !batches[i]!.complete);
  const events = batches.flatMap((batch) => batch.events);
  const cached = eventStore.getReplaceable(BLOSSOM_LIST_KIND, pubkey) as NostrEvent | undefined;
  const verifiedCached = cached && verifyEvent(structuredClone(cached)) ? cached : undefined;
  const newest = newestBlossomList([...events, ...(verifiedCached ? [verifiedCached] : [])], pubkey);
  const cachedUnwitnessed = !!newest && !batches.some((batch) => batch.complete && batch.events.some((event) => event.id === newest.id));
  if (newest) eventStore.add(newest);
  if (!completed.length) throw new Error("No relay completed loading your Blossom list. Check your connection and retry; existing data is untouched.");
  return { event: newest, completed, failed, cachedUnwitnessed };
}

export async function publishBlossomList(options: {
  pubkey: string; base?: NostrEvent; servers: string[]; read(): Promise<BlossomSnapshot>; allowUncertain?: boolean;
  signer: NostrProvider; pool: Pick<RelayPool, "publish">; writeRelays: string[]; active(): boolean;
}) {
  const { base, signer, pubkey, active } = options;
  const assertCurrent = async () => {
    if (!active() || await signer.getPublicKey() !== pubkey || !active()) throw new Error("Account or editor changed; publication cancelled.");
  };
  const assertBase = async () => {
    const current = await options.read();
    if (current.event?.id !== base?.id) throw new Error("A newer Blossom list was found. Reload and review it before publishing; your edits are still here.");
    if (uncertainBlossomSnapshot(current) && !options.allowUncertain) throw new Error("Relay coverage is now incomplete. Reload and review the warning before publishing; your edits are still here.");
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
