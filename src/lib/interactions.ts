import { publishUntilAccepted } from "./relay-publish";
import { NoteFactory, ReactionFactory, ShareFactory, ZapRequestFactory } from "applesauce-common/factories";
import { getAccountProvider } from "./session";
import type { NostrProvider } from "../types";
import type { RelayPool } from "applesauce-relay";
import { getZapEndpoint } from "nostr-tools/nip57";
import type { NostrEvent } from "../types";

export interface InteractionSummary {
  event: NostrEvent;
  accepted: string[];
  rejected: { relay: string; reason: string }[];
  status: "success" | "partial" | "failed";
}

export interface ZapResult {
  status: "paid" | "invoice";
  invoice: string;
  zapRequest: NostrEvent;
  paymentMethod?: "nwc" | "webln";
}

export type InvoicePayer = (invoice: string) => Promise<unknown>;

type PublishPool = Pick<RelayPool, "publish">;
type SignableFactory = { sign(signer: NostrProvider): Promise<NostrEvent> };

async function publishFactory(factory: SignableFactory, relays: string[], pool: PublishPool): Promise<InteractionSummary> {
  const event = await factory.sign(getAccountProvider());
  const results = await publishUntilAccepted(pool, relays, event);
  const accepted = results.filter(({ ok }) => ok).map(({ from }) => from);
  const rejected = results.filter(({ ok }) => !ok).map(({ from, message }) => ({ relay: from, reason: message || "Relay rejected the event" }));
  return { event, accepted, rejected, status: accepted.length === 0 ? "failed" : rejected.length ? "partial" : "success" };
}

export function validateReply(content: string): string {
  const clean = content.trim();
  if (!clean) throw new Error("Write a reply first.");
  if (clean.length > 2_800) throw new Error("Replies are limited to 2,800 characters.");
  return clean;
}

export function validateZapAmount(sats: number): number {
  if (!Number.isSafeInteger(sats) || sats < 1 || sats > 1_000_000) throw new Error("Choose a whole zap amount from 1 to 1,000,000 sats.");
  return sats;
}

export function likeNote(event: NostrEvent, relays: string[], pool: PublishPool): Promise<InteractionSummary> {
  return publishFactory(ReactionFactory.like(event), relays, pool);
}

export function repostNote(event: NostrEvent, relays: string[], pool: PublishPool): Promise<InteractionSummary> {
  return publishFactory(ShareFactory.share(event), relays, pool);
}

export function replyToNote(event: NostrEvent, content: string, relays: string[], pool: PublishPool, mentionedPubkeys: string[] = []): Promise<InteractionSummary> {
  let factory = NoteFactory.reply(event, validateReply(content));
  for (const pubkey of new Set(mentionedPubkeys)) factory = factory.mention(pubkey);
  return publishFactory(factory, relays, pool);
}

export async function zapNote(
  event: NostrEvent,
  profileEvent: NostrEvent | undefined,
  sats: number,
  relays: string[],
  comment = "",
  payInvoice?: InvoicePayer,
): Promise<ZapResult> {
  const signer = getAccountProvider();
  validateZapAmount(sats);
  if (!profileEvent) throw new Error("The recipient's Lightning address has not loaded yet.");
  const callback = await getZapEndpoint(profileEvent);
  if (!callback) throw new Error("This profile does not advertise a Nostr-enabled Lightning address.");
  const callbackUrl = new URL(callback);
  if (callbackUrl.protocol !== "https:") throw new Error("The recipient's Lightning endpoint is not secure.");

  const amount = sats * 1_000;
  const zapRequest = await ZapRequestFactory.event(event, amount, relays).message(comment.trim().slice(0, 280)).sign(signer);
  callbackUrl.searchParams.set("amount", String(amount));
  callbackUrl.searchParams.set("nostr", JSON.stringify(zapRequest));
  const response = await fetch(callbackUrl, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`The Lightning provider returned HTTP ${response.status}.`);
  const payload = await response.json() as { pr?: unknown; reason?: unknown; status?: unknown };
  if (payload.status === "ERROR") throw new Error(typeof payload.reason === "string" ? payload.reason : "The Lightning provider rejected the zap.");
  if (typeof payload.pr !== "string" || payload.pr.length > 8_000 || !/^ln(?:bc|tb|bcrt)[0-9a-z]+$/i.test(payload.pr)) {
    throw new Error("The Lightning provider returned an invalid invoice.");
  }

  await signer.getPublicKey();
  if (payInvoice) {
    await payInvoice(payload.pr);
    return { status: "paid", invoice: payload.pr, zapRequest, paymentMethod: "nwc" };
  }
  if (window.webln) {
    await window.webln.enable();
    await window.webln.sendPayment(payload.pr);
    return { status: "paid", invoice: payload.pr, zapRequest, paymentMethod: "webln" };
  }
  return { status: "invoice", invoice: payload.pr, zapRequest };
}
