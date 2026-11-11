import { useEffect, useState } from "react";
import type { NostrEvent } from "../types";
import type { EventReference, ProfileReference, ReferenceSegment } from "../lib/references";
import { ensureProfile, getReferencedEvent, subscribeReferencedEvent } from "../lib/nostr";
import { parseContent } from "../lib/content";
import { Avatar, useProfile } from "./Avatar";
import { navigationTargetForEvent, type OpenThread } from "../lib/threading";

function ProfileMention({ reference, readRelays, onOpenProfile }: { reference: ProfileReference; readRelays: string[]; onOpenProfile(pubkey: string): void }) {
  const profile = useProfile(reference.pubkey);
  useEffect(() => ensureProfile(reference.pubkey, [...reference.relays, ...readRelays]), [reference.pubkey, reference.relays, readRelays]);
  return <button className="profile-reference" type="button" onClick={() => onOpenProfile(reference.pubkey)} aria-label={`View ${profile.name}'s profile`}><Avatar pubkey={reference.pubkey} size="small" /><span>@{profile.name}</span></button>;
}

export function RichNoteText({ segments, readRelays, onOpenProfile }: { segments: ReferenceSegment[]; readRelays: string[]; onOpenProfile(pubkey: string): void }) {
  return <>{segments.map((segment, index) => segment.kind === "text"
    ? <span key={`text-${index}`}>{segment.text}</span>
    : segment.kind === "profile"
      ? <ProfileMention key={`${segment.raw}-${index}`} reference={segment} readRelays={readRelays} onOpenProfile={onOpenProfile} />
      : <span className="event-reference-label" key={`${segment.raw}-${index}`}>referenced post</span>)}</>;
}

function referenceLabel(reference: EventReference): string {
  return "id" in reference.pointer ? "Referenced post" : "Referenced event";
}

export function EmbeddedEvent({ reference, readRelays, mock, onOpenThread }: { reference: EventReference; readRelays: string[]; mock: boolean; onOpenThread: OpenThread }) {
  const [event, setEvent] = useState<NostrEvent | undefined>(() => getReferencedEvent(reference.pointer));
  const [settled, setSettled] = useState(() => Boolean(event) || mock);

  useEffect(() => {
    setEvent(getReferencedEvent(reference.pointer));
    setSettled(Boolean(getReferencedEvent(reference.pointer)) || mock);
    const subscription = subscribeReferencedEvent(reference.pointer, readRelays, (next) => {
      if (next) setEvent(next);
    }, !mock);
    const timer = window.setTimeout(() => setSettled(true), mock ? 0 : 5_200);
    return () => {
      subscription.unsubscribe();
      window.clearTimeout(timer);
    };
  }, [reference.pointer, readRelays, mock]);

  if (!event) return <div className="embedded-event embedded-event--empty"><strong>{referenceLabel(reference)}</strong><span>{settled ? "Not found on your current relays" : "Loading from your relays…"}</span></div>;
  return <ResolvedEmbeddedEvent event={event} readRelays={readRelays} onOpenThread={onOpenThread} />;
}

function ResolvedEmbeddedEvent({ event, readRelays, onOpenThread }: { event: NostrEvent; readRelays: string[]; onOpenThread: OpenThread }) {
  const profile = useProfile(event.pubkey);
  useEffect(() => ensureProfile(event.pubkey, readRelays), [event.pubkey, readRelays]);
  const preview = parseContent(event.content).text || `Nostr event kind ${event.kind}`;
  return <button className="embedded-event" type="button" onClick={() => onOpenThread(navigationTargetForEvent(event, readRelays))} aria-label={`Open referenced post by ${profile.name}`}>
    <Avatar pubkey={event.pubkey} size="small" />
    <span className="embedded-event-copy"><strong>{profile.name}</strong><span>{preview}</span></span>
    <span className="embedded-event-arrow" aria-hidden="true">›</span>
  </button>;
}
