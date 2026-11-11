import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { NostrEvent } from "../types";
import { dedupeLookmarks, networkHighlights, type HighlightSource, type LookmarkTarget } from "../lib/discovery";
import { parseBookmarkList, type NoteBookmark } from "../lib/bookmarks";
import { getReferencedEvent, subscribeDiscovery, subscribeReferencedEvent, type DiscoveryState } from "../lib/nostr";
import { useBookmarks } from "./BookmarkProvider";
import { EventCard, type EventCardProps } from "./EventCard";
import { useProfile } from "./Avatar";
import { navigationTargetForEvent, type OpenThread } from "../lib/threading";
import type { SavedView } from "../lib/routes";
type SharedCardProps = Omit<EventCardProps, "event">;

function ResolvedCard({ pointer, header, ...cardProps }: SharedCardProps & { pointer: NoteBookmark; header?: ReactNode }) {
  const [event, setEvent] = useState<NostrEvent>();
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    setEvent(undefined);
    setSettled(false);
    const subscription = subscribeReferencedEvent({ id: pointer.id, relays: pointer.relay ? [pointer.relay] : undefined }, cardProps.readRelays, setEvent, !cardProps.mock);
    const timer = window.setTimeout(() => setSettled(true), cardProps.mock ? 0 : 5_000);
    return () => { subscription.unsubscribe(); window.clearTimeout(timer); };
  }, [pointer.id, pointer.relay, cardProps.readRelays, cardProps.mock]);
  return <div className="resolved-bookmark">{header}{event
    ? <EventCard event={event} {...cardProps} />
    : <div className="unresolved-bookmark"><strong>{settled ? "Saved note unavailable" : "Resolving saved note…"}</strong><span>{pointer.id.slice(0, 16)}…{pointer.relay ? ` · ${pointer.relay}` : ""}</span><p>{settled ? "The bookmark is intact, but the event was not found on the active read relays." : "Checking the bookmark relay hint and your active read relays."}</p></div>}</div>;
}

function targetForId(id: string, relayHints: string[] = []) {
  const event = getReferencedEvent({ id });
  return event ? navigationTargetForEvent(event, relayHints) : { rootId: id, focusId: id, relayHints };
}

function HighlightSourceView({ source, readRelays, mock, onOpenThread }: { source?: HighlightSource; readRelays: string[]; mock?: boolean; onOpenThread: OpenThread }) {
  const [resolvedId, setResolvedId] = useState<string>();
  useEffect(() => {
    setResolvedId(undefined);
    if (source?.type !== "a") return;
    const [kind, pubkey, ...identifier] = source.value.split(":");
    if (!/^\d+$/.test(kind) || !/^[0-9a-f]{64}$/i.test(pubkey) || !identifier.length) return;
    const subscription = subscribeReferencedEvent({ kind: Number(kind), pubkey, identifier: identifier.join(":"), relays: source.relay ? [source.relay] : undefined }, readRelays, (event) => setResolvedId(event?.id), !mock);
    return () => subscription.unsubscribe();
  }, [source, readRelays, mock]);
  if (!source) return <span className="source-reference">No source reference supplied</span>;
  if (source.type === "e" && /^[0-9a-f]{64}$/i.test(source.value)) return <button className="source-link" type="button" onClick={() => onOpenThread(targetForId(source.value, source.relay ? [source.relay] : []))}>Open source note →</button>;
  if (source.type === "a" && resolvedId) return <button className="source-link" type="button" onClick={() => onOpenThread(targetForId(resolvedId, source.relay ? [source.relay] : []))}>Open source article →</button>;
  if (source.type === "r" && /^https?:\/\//i.test(source.value)) return <a className="source-link" href={source.value} target="_blank" rel="noopener noreferrer">Open external source ↗</a>;
  return <span className="source-reference">{source.type}: {source.value}</span>;
}

function HighlightItem({ item, readRelays, mock, onOpenThread }: { item: ReturnType<typeof networkHighlights>[number]; readRelays: string[]; mock?: boolean; onOpenThread: OpenThread }) {
  const profile = useProfile(item.event.pubkey);
  return <article className="highlight-card">
    <div className="discovery-meta"><span>Highlight by</span><strong>{profile.name}</strong><time>{new Date(item.event.created_at * 1000).toLocaleDateString()}</time></div>
    <blockquote>{item.excerpt}</blockquote>
    {item.context && <p><b>Context</b>{item.context}</p>}
    {item.comment && <p><b>Comment</b>{item.comment}</p>}
    <HighlightSourceView source={item.source} readRelays={readRelays} mock={mock} onOpenThread={onOpenThread} />
  </article>;
}

function LookmarkHeader({ target, onOpen }: { target: LookmarkTarget; onOpen(): void }) {
  const latest = target.signals[0];
  const profile = useProfile(latest.event.pubkey);
  const labels = [...new Set(target.signals.map(({ type }) => type))].join(" + ");
  return <div className="lookmark-meta"><span aria-hidden="true">👀</span><div><strong>{profile.name}</strong><small>{labels} · {target.signals.length} network signal{target.signals.length === 1 ? "" : "s"}</small></div><button type="button" onClick={onOpen}>Open target →</button></div>;
}

export function BookmarksPage({ pubkey, view, onViewChange, ...cardProps }: SharedCardProps & { pubkey: string; view: SavedView; onViewChange(view: SavedView): void }) {
  const [discovery, setDiscovery] = useState<DiscoveryState>({ followedPubkeys: [], events: [], truncatedFollows: false });
  const bookmarks = useBookmarks();
  const personal = useMemo(() => parseBookmarkList(bookmarks.event), [bookmarks.event]);
  const highlights = useMemo(() => networkHighlights(discovery.events, discovery.followedPubkeys), [discovery]);
  const lookmarks = useMemo(() => dedupeLookmarks(discovery.events, discovery.followedPubkeys), [discovery]);

  useEffect(() => {
    const subscription = subscribeDiscovery(pubkey, cardProps.readRelays, setDiscovery, !cardProps.mock);
    return () => subscription.unsubscribe();
  }, [pubkey, cardProps.readRelays, cardProps.mock]);

  return <>
    <div className="bookmarks-heading"><p className="eyebrow">Saved and spotted</p><h1>Bookmarks</h1><p>Your list and recent signals from people you follow.</p></div>
    <div className="bookmark-tabs" role="tablist" aria-label="Bookmark views">
      <button role="tab" aria-selected={view === "bookmarks"} onClick={() => onViewChange("bookmarks")}>Personal</button>
      <button role="tab" aria-selected={view === "highlights"} onClick={() => onViewChange("highlights")}>Highlights</button>
      <button role="tab" aria-selected={view === "lookmarks"} onClick={() => onViewChange("lookmarks")}>LookMarks</button>
    </div>
    {view === "bookmarks" && <section className="feed bookmarks-feed" aria-label="Personal bookmarks">
      {personal.notes.length ? [...personal.notes].reverse().slice(0, 100).map((pointer) => <ResolvedCard pointer={pointer} {...cardProps} key={pointer.id} />) : <div className="empty-state"><span>♧</span><h2>No public note bookmarks</h2><p>Use the bookmark control on any note. Private encrypted list content, article addresses, and extension tags remain untouched.</p></div>}
      {personal.articles.length > 0 && <div className="saved-articles"><h2>Saved article addresses</h2>{personal.articles.slice(0, 40).map((address) => <div key={address}><strong>Article reference retained</strong><span>{address}</span></div>)}</div>}
    </section>}
    {view === "highlights" && <section className="highlight-list" aria-label="Network highlights">
      <p className="scope-note">Newest NIP-84 highlights from your current follow list{discovery.truncatedFollows ? " (query capped at 256 follows)" : ""}. Ordinary likes are not included.</p>
      {highlights.length ? highlights.map((item) => <HighlightItem item={item} readRelays={cardProps.readRelays} mock={cardProps.mock} onOpenThread={cardProps.onOpenThread} key={item.event.id} />) : <div className="empty-state"><span>◇</span><h2>No network highlights found</h2><p>Canopy found no recent kind-9802 highlights from followed people on your active relays.</p></div>}
    </section>}
    {view === "lookmarks" && <section className="feed lookmarks-feed" aria-label="Network LookMarks">
      <p className="scope-note">Recent crowd bookmarks from people you follow: 👀 reactions, threaded replies, and quotes. Targets are deduplicated and capped at 40.</p>
      {lookmarks.length ? lookmarks.map((target) => <ResolvedCard pointer={{ id: target.targetId, relay: target.targetRelay }} header={<LookmarkHeader target={target} onOpen={() => cardProps.onOpenThread(targetForId(target.targetId, target.targetRelay ? [target.targetRelay] : []))} />} {...cardProps} key={target.targetId} />) : <div className="empty-state"><span>👀</span><h2>No LookMarks found</h2><p>No recent compatible signals from your followed network were found on the active relays.</p></div>}
    </section>}
  </>;
}
