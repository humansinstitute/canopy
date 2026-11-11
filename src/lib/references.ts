import * as nip19 from "nostr-tools/nip19";
import type { AddressPointer, EventPointer } from "nostr-tools/nip19";

const NIP19_REFERENCE_RE = /\b(?:nostr:)?(?:nprofile1|npub1|nevent1|note1|naddr1)[023456789acdefghjklmnpqrstuvwxyz]+/gi;
const MAX_REFERENCES = 6;

export type ProfileReference = {
  kind: "profile";
  raw: string;
  pubkey: string;
  relays: string[];
};

export type EventReference = {
  kind: "event";
  raw: string;
  pointer: EventPointer | AddressPointer;
};

export type NostrReference = ProfileReference | EventReference;
export type ReferenceSegment = { kind: "text"; text: string } | NostrReference;

export interface ParsedReferences {
  segments: ReferenceSegment[];
  events: EventReference[];
}

function decodeReference(raw: string): NostrReference | null {
  const value = raw.replace(/^nostr:/i, "").toLowerCase();
  try {
    const decoded = nip19.decode(value);
    if (decoded.type === "npub") return { kind: "profile", raw, pubkey: decoded.data, relays: [] };
    if (decoded.type === "nprofile") return { kind: "profile", raw, pubkey: decoded.data.pubkey, relays: decoded.data.relays ?? [] };
    if (decoded.type === "note") return { kind: "event", raw, pointer: { id: decoded.data } };
    if (decoded.type === "nevent") return { kind: "event", raw, pointer: decoded.data };
    if (decoded.type === "naddr") return { kind: "event", raw, pointer: decoded.data };
  } catch {
    // Invalid or truncated NIP-19 values remain ordinary text.
  }
  return null;
}

function eventReferenceKey(reference: EventReference): string {
  return "id" in reference.pointer
    ? `event:${reference.pointer.id}`
    : `address:${reference.pointer.kind}:${reference.pointer.pubkey}:${reference.pointer.identifier}`;
}

export function parseNostrReferences(text: string): ParsedReferences {
  const segments: ReferenceSegment[] = [];
  const events: EventReference[] = [];
  const seenEvents = new Set<string>();
  let cursor = 0;
  let accepted = 0;

  for (const match of text.matchAll(NIP19_REFERENCE_RE)) {
    const raw = match[0];
    const start = match.index ?? 0;
    const reference = accepted < MAX_REFERENCES ? decodeReference(raw) : null;
    if (!reference) continue;
    if (start > cursor) segments.push({ kind: "text", text: text.slice(cursor, start) });
    segments.push(reference);
    cursor = start + raw.length;
    accepted += 1;
    if (reference.kind === "event") {
      const key = eventReferenceKey(reference);
      if (!seenEvents.has(key)) {
        seenEvents.add(key);
        events.push(reference);
      }
    }
  }
  if (cursor < text.length) segments.push({ kind: "text", text: text.slice(cursor) });
  if (!segments.length && text) segments.push({ kind: "text", text });
  return { segments, events };
}

export function referenceAwareText(parsed: ParsedReferences): string {
  return parsed.segments.map((segment) => segment.kind === "text" ? segment.text : segment.kind === "profile" ? "@profile" : "referenced post").join("");
}
