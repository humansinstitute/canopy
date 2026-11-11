import { publishUntilAccepted } from "./relay-publish";
import { NoteFactory } from "applesauce-common/factories";
import { getAccountProvider } from "./session";
import type { NostrProvider } from "../types";
import type { RelayPool } from "applesauce-relay";
import type { NostrEvent } from "../types";
import * as nip19 from "nostr-tools/nip19";

export interface PublishSummary {
  event: NostrEvent;
  accepted: string[];
  rejected: { relay: string; reason: string }[];
  status: "success" | "partial" | "failed";
}

export interface QuoteTarget {
  event: NostrEvent;
  relayHint?: string;
}

export interface PostOptions {
  mentionedPubkeys?: string[];
  quote?: QuoteTarget;
}

export function quoteReference({ event, relayHint }: QuoteTarget): string {
  return `nostr:${nip19.neventEncode({ id: event.id, author: event.pubkey, kind: event.kind, relays: relayHint ? [relayHint] : [] })}`;
}

export function quoteContent(content: string, quote?: QuoteTarget): string {
  const clean = content.trim();
  return quote ? [clean, quoteReference(quote)].filter(Boolean).join("\n\n") : clean;
}

export function validatePost(content: string): string {
  const clean = content.trim();
  if (!clean) throw new Error("Write something before posting.");
  if (clean.length > 2_800) throw new Error("Posts are limited to 2,800 characters in Canopy.");
  return clean;
}

export class PostPublisher {
  private pending = false;

  get isPending(): boolean {
    return this.pending;
  }

  async publish(content: string, relays: string[], pool: Pick<RelayPool, "publish">, options: PostOptions = {}): Promise<PublishSummary> {
    if (this.pending) throw new Error("This post is already being published.");
    this.pending = true;
    try {
      const clean = validatePost(quoteContent(content, options.quote));
      const signer = getAccountProvider();
      let factory = NoteFactory.create(clean);
      for (const pubkey of new Set(options.mentionedPubkeys ?? [])) factory = factory.mention(pubkey);
      if (options.quote) {
        const { event, relayHint } = options.quote;
        factory = factory.modifyPublicTags((tags) => [
          ...tags.filter(([name, value]) => name !== "q" || value !== event.id),
          ["q", event.id, relayHint ?? "", event.pubkey],
        ]);
      }
      const event = await factory.sign(signer);
      const results = await publishUntilAccepted(pool, relays, event);
      const accepted = results.filter((r) => r.ok).map((r) => r.from);
      const rejected = results.filter((r) => !r.ok).map((r) => ({ relay: r.from, reason: r.message || "Relay rejected the event" }));
      return {
        event,
        accepted,
        rejected,
        status: accepted.length === 0 ? "failed" : rejected.length ? "partial" : "success",
      };
    } finally {
      this.pending = false;
    }
  }
}

