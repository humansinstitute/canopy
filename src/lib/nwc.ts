import { changeSetting, readSetting } from "./settings-state";
import type { RelayPool } from "applesauce-relay";
import { nip04, nip44 } from "nostr-tools";
import { finalizeEvent, getPublicKey, type NostrEvent } from "nostr-tools/pure";
import { hexToBytes } from "nostr-tools/utils";
import { lastValueFrom, toArray, type Subscription } from "rxjs";

export interface NwcConnection {
  walletPubkey: string;
  secret: string;
  relays: string[];
}

export interface NwcPaymentResult {
  preimage: string;
  feesPaid?: number;
  requestId: string;
}

type NwcPool = Pick<RelayPool, "publish" | "request" | "subscription">;
type Encryption = "nip44_v2" | "nip04";

const HEX_32 = /^[0-9a-f]{64}$/i;
const MAX_URI_LENGTH = 4_096;
const RESPONSE_TIMEOUT_MS = 20_000;

function normalizeRelay(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "wss:" || !url.hostname || url.username || url.password || url.hash) return null;
    url.pathname = url.pathname.replace(/\/$/, "") || "/";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function parseNwcConnection(connectionUri: string): NwcConnection {
  const raw = connectionUri.trim();
  if (!raw || raw.length > MAX_URI_LENGTH) throw new Error("Paste a valid Nostr Wallet Connect URI.");
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("Paste a valid Nostr Wallet Connect URI."); }
  if (url.protocol !== "nostr+walletconnect:" || url.username || url.password || url.hash) throw new Error("The wallet connection must use a nostr+walletconnect URI.");
  const walletPubkey = (url.hostname || url.pathname.replace(/^\/+/, "")).toLowerCase();
  const secret = (url.searchParams.get("secret") || "").toLowerCase();
  if (!HEX_32.test(walletPubkey) || !HEX_32.test(secret)) throw new Error("The wallet connection has an invalid NIP-47 key.");
  const requestedRelays = url.searchParams.getAll("relay");
  const relays = [...new Set(requestedRelays.map(normalizeRelay).filter((relay): relay is string => Boolean(relay)))];
  if (!requestedRelays.length || relays.length !== requestedRelays.length || relays.length > 5) throw new Error("The wallet connection must contain one to five secure WSS relays.");
  return { walletPubkey, secret, relays };
}

export function nwcConnectionSummary(connectionUri: string): string {
  const connection = parseNwcConnection(connectionUri);
  return `${connection.walletPubkey.slice(0, 8)}…${connection.walletPubkey.slice(-6)} · ${connection.relays.length} relay${connection.relays.length === 1 ? "" : "s"}`;
}

const storageKey = (pubkey: string) => `canopy.nwc.${pubkey}`;

export function loadNwcConnection(pubkey: string): string | undefined {
  let value: string;
  try { const saved = readSetting(pubkey, "nwc"); value = (saved ? saved.value : localStorage.getItem(storageKey(pubkey))) as string || ""; } catch { return undefined; }
  if (!value) return undefined;
  try { parseNwcConnection(value); return value; } catch { localStorage.removeItem(storageKey(pubkey)); return undefined; }
}

export function saveNwcConnection(pubkey: string, connectionUri: string): string {
  parseNwcConnection(connectionUri);
  const value = connectionUri.trim();
  changeSetting(pubkey, "nwc", value);
  // Retain compatibility for existing local clients; the atomic settings record takes precedence.
  try { localStorage.setItem(storageKey(pubkey), value); } catch { /* Already persisted atomically. */ }
  return value;
}

export function clearNwcConnection(pubkey: string): void {
  changeSetting(pubkey, "nwc", null);
  localStorage.removeItem(storageKey(pubkey));
}

function encryptionFromInfo(info: NostrEvent | undefined): Encryption {
  const advertised = info?.tags.find(([name]) => name === "encryption")?.[1]?.split(/\s+/).filter(Boolean);
  if (!advertised?.length) return "nip04";
  if (advertised.includes("nip44_v2")) return "nip44_v2";
  if (advertised.includes("nip04")) return "nip04";
  throw new Error("This wallet does not advertise a supported NIP-47 encryption mode.");
}

function encryptPayload(encryption: Encryption, secretKey: Uint8Array, walletPubkey: string, payload: string): string {
  return encryption === "nip44_v2"
    ? nip44.v2.encrypt(payload, nip44.v2.utils.getConversationKey(secretKey, walletPubkey))
    : nip04.encrypt(secretKey, walletPubkey, payload);
}

function decryptPayload(encryption: Encryption, secretKey: Uint8Array, walletPubkey: string, payload: string): string {
  if (payload.length > 65_536) throw new Error("The wallet returned an oversized NIP-47 response.");
  return encryption === "nip44_v2"
    ? nip44.v2.decrypt(payload, nip44.v2.utils.getConversationKey(secretKey, walletPubkey))
    : nip04.decrypt(secretKey, walletPubkey, payload);
}

async function walletInfo(connection: NwcConnection, pool: NwcPool): Promise<NostrEvent | undefined> {
  const events = await lastValueFrom(pool.request(connection.relays, { kinds: [13_194], authors: [connection.walletPubkey], limit: 1 }, { timeout: 5_000, reconnect: 1 }).pipe(toArray()), { defaultValue: [] });
  return [...events].sort((a, b) => b.created_at - a.created_at)[0] as NostrEvent | undefined;
}

export async function payInvoiceWithNwc(connectionUri: string, invoice: string, pool: NwcPool, timeoutMs = RESPONSE_TIMEOUT_MS): Promise<NwcPaymentResult> {
  if (!/^ln(?:bc|tb|bcrt)[0-9a-z]+$/i.test(invoice) || invoice.length > 8_000) throw new Error("Cannot send an invalid Lightning invoice to the wallet.");
  const connection = parseNwcConnection(connectionUri);
  const secretKey = hexToBytes(connection.secret);
  const clientPubkey = getPublicKey(secretKey);
  let info: NostrEvent | undefined;
  try { info = await walletInfo(connection, pool); }
  catch { throw new Error("Canopy could not read this wallet's NIP-47 info event."); }
  if (!info) throw new Error("This wallet has not published its required NIP-47 info event.");
  if (!info.content.split(/\s+/).includes("pay_invoice")) throw new Error("This NIP-47 connection is not allowed to pay invoices.");
  const encryption = encryptionFromInfo(info);
  const request = finalizeEvent({
    kind: 23_194,
    created_at: Math.floor(Date.now() / 1_000),
    tags: [
      ["p", connection.walletPubkey],
      ["expiration", String(Math.floor(Date.now() / 1_000) + Math.ceil(timeoutMs / 1_000) + 15)],
      ...(encryption === "nip44_v2" ? [["encryption", "nip44_v2"]] : []),
    ],
    content: encryptPayload(encryption, secretKey, connection.walletPubkey, JSON.stringify({ method: "pay_invoice", params: { invoice } })),
  }, secretKey);

  let cancelResponse = () => undefined;
  const responsePromise = new Promise<NostrEvent>((resolve, reject) => {
    let subscription: Subscription | undefined;
    const timer = window.setTimeout(() => { subscription?.unsubscribe(); reject(new Error("The NIP-47 wallet did not respond in time.")); }, timeoutMs);
    cancelResponse = () => { window.clearTimeout(timer); subscription?.unsubscribe(); };
    subscription = pool.subscription(connection.relays, { kinds: [23_195], authors: [connection.walletPubkey], "#p": [clientPubkey], "#e": [request.id], since: request.created_at - 5 }, { reconnect: 1, resubscribe: false }).subscribe({
      next: (event) => { window.clearTimeout(timer); subscription?.unsubscribe(); resolve(event as NostrEvent); },
      error: () => { window.clearTimeout(timer); reject(new Error("The NIP-47 wallet relay connection failed.")); },
    });
  });

  let published: Awaited<ReturnType<NwcPool["publish"]>>;
  try { published = await pool.publish(connection.relays, request); }
  catch { cancelResponse(); throw new Error("The NIP-47 payment request could not reach its wallet relay."); }
  if (!published.some(({ ok }) => ok)) { cancelResponse(); throw new Error("No NIP-47 wallet relay accepted the payment request."); }
  const response = await responsePromise;
  let payload: { result_type?: unknown; result?: { preimage?: unknown; fees_paid?: unknown }; error?: { message?: unknown; code?: unknown } | null };
  try { payload = JSON.parse(decryptPayload(encryption, secretKey, connection.walletPubkey, response.content)); }
  catch { throw new Error("The NIP-47 wallet returned an unreadable response."); }
  if (payload.error) throw new Error(typeof payload.error.message === "string" ? payload.error.message : "The NIP-47 wallet rejected the payment.");
  if (payload.result_type !== "pay_invoice" || typeof payload.result?.preimage !== "string") throw new Error("The NIP-47 wallet returned an invalid payment response.");
  return { preimage: payload.result.preimage, feesPaid: typeof payload.result.fees_paid === "number" ? payload.result.fees_paid : undefined, requestId: request.id };
}
