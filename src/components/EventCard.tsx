import { GuestAccess } from "./GuestAccess";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { VideoPlayer } from "./VideoPlayer";
import type { RelayPool } from "applesauce-relay";
import * as nip19 from "nostr-tools/nip19";
import type { NostrEvent } from "../types";
import { parseContent, shouldCollapsePost } from "../lib/content";
import { parseNostrReferences, referenceAwareText } from "../lib/references";
import { Avatar, useProfile } from "./Avatar";
import { getProfileEvent } from "../lib/nostr";
import { likeNote, replyToNote, repostNote, validateZapAmount, zapNote, type InteractionSummary, type InvoicePayer } from "../lib/interactions";
import { EmbeddedEvent, RichNoteText } from "./NostrReferences";
import { EnhancedTextarea } from "./EnhancedTextarea";
import { useBookmarks } from "./BookmarkProvider";
import type { ZapPreferences } from "../lib/zap-preferences";
import { getReplyContext, type OpenThread } from "../lib/threading";
import { ReplyContextIndicator } from "./ReplyContextIndicator";
import { Composer } from "./Composer";
import { activeMentionPubkeys, type SelectedMention } from "../lib/composer";
import { eventUrl } from "../lib/routes";

const LONG_PRESS_MS = 550;
const LONG_PRESS_MOVEMENT_PX = 12;
const FOLLOW_UP_EVENT_GUARD_MS = 1_200;

function timeAgo(timestamp: number): string {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - timestamp);
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

type ActiveMedia = { kind: "image" | "video"; src: string; label: string; opener?: HTMLElement };

function SafeImage({ src, index, onOpen }: { src: string; index: number; onOpen(media: ActiveMedia): void }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  if (failed) return <div className="image-fallback" role="status">Image unavailable</div>;
  const label = `Image attached to this note${index ? `, ${index + 1}` : ""}`;
  return (
    <button className={`media-frame media-open ${loaded ? "is-loaded" : ""}`} type="button" onClick={() => onOpen({ kind: "image", src, label })} aria-label={`Open ${label.toLowerCase()}`}>
      <img src={src} alt={label} loading="lazy" decoding="async" onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />
    </button>
  );
}

function VideoPreview({ src, index, onOpen }: { src: string; index: number; onOpen(media: ActiveMedia): void }) {
  const label = `Video attached to this note${index ? `, ${index + 1}` : ""}`;
  return <button className="video-preview media-open" type="button" onClick={(event) => { const opener = event.currentTarget; flushSync(() => onOpen({ kind: "video", src, label, opener })); }} aria-label={`Play ${label.toLowerCase()}`}><span aria-hidden="true">▶</span><strong>Play video</strong></button>;
}

function MediaViewer({ media, onClose }: { media: ActiveMedia; onClose(): void }) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape" && media.kind === "image") onClose(); };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  return createPortal(<div className="media-viewer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="media-viewer-card" role={media.kind === "image" ? "dialog" : undefined} aria-modal={media.kind === "image" ? true : undefined} aria-label={media.kind === "image" ? "Image viewer" : undefined}>
      {media.kind === "image" && <button className="media-viewer-close" type="button" onClick={onClose} aria-label="Close media viewer">×</button>}
      {media.kind === "image"
        ? <img src={media.src} alt={media.label} />
        : <VideoPlayer key={media.src} src={media.src} label={media.label} returnFocus={media.opener} onClose={onClose} />}
      {media.kind === "image" && <a href={media.src} target="_blank" rel="noopener noreferrer">Open original</a>}
    </section>
  </div>, document.body);
}

function resultMessage(action: string, result: InteractionSummary): string {
  if (result.status === "failed") throw new Error(`No relay accepted the ${action}.`);
  return result.status === "partial" ? `${action} published; some relays were unavailable.` : `${action} published.`;
}

function ActionIcon({ name, filled = false }: { name: "like" | "reply" | "quote" | "repost" | "zap" | "bookmark"; filled?: boolean }) {
  if (name === "like") return <svg viewBox="0 0 24 24" aria-hidden="true"><path fill={filled ? "currentColor" : "none"} d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z" /></svg>;
  if (name === "reply") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 17-5-5 5-5" /><path d="M20 18v-2a4 4 0 0 0-4-4H4" /></svg>;
  if (name === "quote") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17H4a2 2 0 0 1-2-2v-3a5 5 0 0 1 5-5" /><path d="M17 17h-3a2 2 0 0 1-2-2v-3a5 5 0 0 1 5-5" /></svg>;
  if (name === "repost") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m17 2 4 4-4 4" /><path d="M3 11V9a3 3 0 0 1 3-3h15" /><path d="m7 22-4-4 4-4" /><path d="M21 13v2a3 3 0 0 1-3 3H3" /></svg>;
  if (name === "bookmark") return <svg viewBox="0 0 24 24" aria-hidden="true"><path fill={filled ? "currentColor" : "none"} d="M6 3h12v18l-6-4-6 4V3Z" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 4.5 13H11l-1 9 8.5-11H12l1-9Z" /></svg>;
}

export interface EventCardProps {
  event: NostrEvent;
  readRelays: string[];
  writeRelays: string[];
  blossomServers: string[];
  pool: Pick<RelayPool, "publish">;
  onPublished(event: NostrEvent): void;
  onOpenProfile(pubkey: string): void;
  onOpenThread: OpenThread;
  payInvoice?: InvoicePayer;
  zapPreferences: ZapPreferences;
  mock?: boolean;
  showReplyContext?: boolean;
}

export function EventCard({ event, readRelays, writeRelays, blossomServers, pool, onPublished, onOpenProfile, onOpenThread, payInvoice, zapPreferences, mock = false, showReplyContext = true }: EventCardProps) {
  const requestLogin = useContext(GuestAccess);
  const parsed = useMemo(() => parseContent(event.content, event.tags), [event.content, event.tags]);
  const references = useMemo(() => parseNostrReferences(parsed.text), [parsed.text]);
  const replyContext = useMemo(() => getReplyContext(event), [event]);
  const profile = useProfile(event.pubkey);
  const [busy, setBusy] = useState<"repost" | "reply">();
  const [message, setMessage] = useState<string>();
  const [replyOpen, setReplyOpen] = useState(false);
  const [reply, setReply] = useState("");
  const [replyMentions, setReplyMentions] = useState<SelectedMention[]>([]);
  const [replyUploading, setReplyUploading] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [zapOpen, setZapOpen] = useState(false);
  const [zapAmount, setZapAmount] = useState(String(zapPreferences.amount));
  const [zapComment, setZapComment] = useState(zapPreferences.message);
  const [invoice, setInvoice] = useState<string>();
  const [zapPending, setZapPending] = useState(false);
  const [zappedAmount, setZappedAmount] = useState<number>();
  const [liked, setLiked] = useState(false);
  const [likePending, setLikePending] = useState(false);
  const [reposted, setReposted] = useState(false);
  const [contentExpanded, setContentExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeMedia, setActiveMedia] = useState<ActiveMedia>();
  const zapPendingRef = useRef(false);
  const longPressTimer = useRef<number | undefined>(undefined);
  const longPressPointer = useRef<{ id: number; x: number; y: number } | undefined>(undefined);
  const suppressZapClickUntil = useRef(0);
  const bookmarks = useBookmarks();
  const bookmarked = bookmarks.saved.has(event.id);
  const bookmarkPending = bookmarks.pending.has(event.id);
  const bookmarkError = bookmarks.errors.get(event.id);
  const collapsible = shouldCollapsePost(referenceAwareText(references));
  const contentId = `note-content-${event.id}`;
  const zapHintId = `zap-hint-${event.id}`;

  useEffect(() => () => {
    if (longPressTimer.current !== undefined) window.clearTimeout(longPressTimer.current);
  }, []);

  async function copyIdentifier(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setMessage(`${label} copied.`);
    } catch {
      setMessage(`Copy was blocked. ${label}: ${value}`);
    } finally {
      setMenuOpen(false);
    }
  }

  async function submitLike() {
    if (liked || likePending) return;
    setLiked(true);
    setLikePending(true);
    setMessage(undefined);
    try {
      const result = await likeNote(event, writeRelays, pool);
      const nextMessage = resultMessage("Like", result);
      onPublished(result.event);
      setMessage(nextMessage);
    } catch (error) {
      setLiked(false);
      setMessage(error instanceof Error ? error.message : "The like could not be published.");
    } finally {
      setLikePending(false);
    }
  }

  async function run(action: "repost", publish: () => Promise<InteractionSummary>) {
    if (busy) return;
    setBusy(action);
    setMessage(undefined);
    try {
      const result = await publish();
      onPublished(result.event);
      setReposted(true);
      setMessage(resultMessage("Repost", result));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `The ${action} could not be published.`);
    } finally {
      setBusy(undefined);
    }
  }

  async function submitReply() {
    if (busy || replyUploading) return;
    setBusy("reply");
    setMessage(undefined);
    try {
      const result = await replyToNote(event, reply, writeRelays, pool, activeMentionPubkeys(reply, replyMentions));
      onPublished(result.event);
      setReply("");
      setReplyMentions([]);
      setReplyOpen(false);
      setMessage(resultMessage("Reply", result));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The reply could not be published.");
    } finally {
      setBusy(undefined);
    }
  }

  function cancelLongPress() {
    if (longPressTimer.current !== undefined) window.clearTimeout(longPressTimer.current);
    longPressTimer.current = undefined;
    longPressPointer.current = undefined;
  }

  function openCustomZap() {
    cancelLongPress();
    setZapAmount(String(zapPreferences.amount));
    setZapComment(zapPreferences.message);
    setInvoice(undefined);
    setZapOpen(true);
    setReplyOpen(false);
    setQuoteOpen(false);
  }

  function guardFollowUpZapEvents() {
    suppressZapClickUntil.current = Date.now() + FOLLOW_UP_EVENT_GUARD_MS;
  }

  function startZapLongPress(pointerEvent: React.PointerEvent<HTMLButtonElement>) {
    if (pointerEvent.pointerType !== "touch" || zapPendingRef.current) return;
    cancelLongPress();
    longPressPointer.current = { id: pointerEvent.pointerId, x: pointerEvent.clientX, y: pointerEvent.clientY };
    longPressTimer.current = window.setTimeout(() => {
      longPressTimer.current = undefined;
      longPressPointer.current = undefined;
      guardFollowUpZapEvents();
      openCustomZap();
    }, LONG_PRESS_MS);
  }

  function moveZapLongPress(pointerEvent: React.PointerEvent<HTMLButtonElement>) {
    const start = longPressPointer.current;
    if (!start || start.id !== pointerEvent.pointerId) return;
    if (Math.hypot(pointerEvent.clientX - start.x, pointerEvent.clientY - start.y) > LONG_PRESS_MOVEMENT_PX) cancelLongPress();
  }

  async function submitZap(amountInput: number | string, comment: string, reopenOnFailure: boolean) {
    if (zapPendingRef.current) return;
    let amount: number;
    try { amount = validateZapAmount(Number(amountInput)); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Choose a valid zap amount."); return; }
    const previousZappedAmount = zappedAmount;
    zapPendingRef.current = true;
    setZapPending(true);
    setZappedAmount(amount);
    setZapOpen(false);
    setMessage(undefined);
    setInvoice(undefined);
    try {
      const result = await zapNote(event, getProfileEvent(event.pubkey), amount, writeRelays, comment, payInvoice);
      if (result.status === "paid") {
        setMessage(`Zapped ${amount.toLocaleString()} sats${result.paymentMethod === "nwc" ? " through Nostr Wallet Connect" : ""}.`);
        setZapOpen(false);
      } else {
        setZappedAmount(previousZappedAmount);
        setInvoice(result.invoice);
        setZapAmount(String(amount));
        setZapComment(comment);
        setZapOpen(true);
        setMessage("Invoice ready. Open it in your Lightning wallet or copy it below.");
      }
    } catch (error) {
      setZappedAmount(previousZappedAmount);
      setZapOpen(reopenOnFailure);
      setMessage(error instanceof Error ? error.message : "The zap could not be prepared.");
    } finally {
      zapPendingRef.current = false;
      setZapPending(false);
    }
  }

  function activateDefaultZap() {
    if (Date.now() <= suppressZapClickUntil.current || zapPendingRef.current) return;
    void submitZap(zapPreferences.amount, zapPreferences.message, false);
  }

  function handleZapKeyDown(keyEvent: React.KeyboardEvent<HTMLButtonElement>) {
    if (!keyEvent.shiftKey || (keyEvent.key !== "Enter" && keyEvent.key !== " ")) return;
    keyEvent.preventDefault();
    guardFollowUpZapEvents();
    openCustomZap();
  }
  return (
    <article className="event-card" data-testid="event-card">
      <div className="event-head">
        <button className="author-button" type="button" onClick={() => onOpenProfile(event.pubkey)} aria-label={`View ${profile.name}'s profile`}>
          <Avatar pubkey={event.pubkey} />
          <span className="event-author"><strong>{profile.name}</strong><small>{timeAgo(event.created_at)}</small></span>
        </button>
        <button className="icon-button" type="button" aria-label="More note options" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>•••</button>
        {menuOpen && <div className="event-menu" role="menu" aria-label="Post options">
          <button type="button" role="menuitem" onClick={() => copyIdentifier(eventUrl(window.location.origin, event.id, readRelays, { author: event.pubkey, kind: event.kind }), "Canopy link")}>Copy Canopy link</button>
          <button type="button" role="menuitem" onClick={() => copyIdentifier(`nostr:${nip19.neventEncode({ id: event.id, author: event.pubkey, kind: event.kind, relays: readRelays.slice(0, 4) })}`, "Event reference")}>Copy event reference</button>
          <button type="button" role="menuitem" onClick={() => copyIdentifier(event.id, "Raw event ID")}>Copy raw event ID</button>
        </div>}
      </div>
      {showReplyContext && replyContext && <ReplyContextIndicator eventId={event.id} context={replyContext} readRelays={readRelays} mock={mock} onOpenThread={onOpenThread} />}
      {parsed.text && <div className="event-copy">
        <p id={contentId} className={`event-content${collapsible && !contentExpanded ? " event-content--collapsed" : ""}`}><RichNoteText segments={references.segments} readRelays={readRelays} onOpenProfile={onOpenProfile} /></p>
        {collapsible && <button className="read-more-button" type="button" aria-controls={contentId} aria-expanded={contentExpanded} onClick={() => setContentExpanded((expanded) => !expanded)}>{contentExpanded ? "Show less" : "Read more"}</button>}
      </div>}
      {references.events.length > 0 && <div className="embedded-events" aria-label="Referenced events">{references.events.map((reference) => <EmbeddedEvent reference={reference} readRelays={readRelays} mock={mock} onOpenThread={onOpenThread} key={reference.raw} />)}</div>}
      {parsed.images.length > 0 && (
        <div className={`media-grid media-grid--${Math.min(parsed.images.length, 4)}`}>
          {parsed.images.map((image, index) => <SafeImage key={image} src={image} index={index} onOpen={setActiveMedia} />)}
        </div>
      )}
      {parsed.videos.length > 0 && <div className="video-grid" aria-label="Videos attached to this note">{parsed.videos.map((video, index) => <VideoPreview key={video} src={video} index={index} onOpen={setActiveMedia} />)}</div>}
      {parsed.links.map((link) => (
        <a className="link-card" href={link} target="_blank" rel="noopener noreferrer" key={link}>
          <span>Open link</span><small>{new URL(link).hostname}</small>
        </a>
      ))}
      {requestLogin ? <div className="event-actions"><button type="button" onClick={requestLogin}>Log in to interact</button></div> : <div className="event-actions" aria-label="Note actions">
        <button type="button" aria-label="Like note" onClick={submitLike} disabled={likePending || liked}><ActionIcon name="like" filled={liked} />{liked ? "Liked" : "Like"}</button>
        <button type="button" aria-label="Reply to note" onClick={() => { setReplyOpen((open) => !open); setQuoteOpen(false); setZapOpen(false); }} disabled={Boolean(busy)}><ActionIcon name="reply" />Reply</button>
        <button type="button" aria-label="Quote note" onClick={() => { setQuoteOpen((open) => !open); setReplyOpen(false); setZapOpen(false); }} disabled={Boolean(busy)}><ActionIcon name="quote" />Quote</button>
        <button type="button" aria-label="Repost note" onClick={() => run("repost", () => repostNote(event, writeRelays, pool))} disabled={Boolean(busy) || reposted}><ActionIcon name="repost" />{reposted ? "Reposted" : "Repost"}</button>
        <button
          type="button"
          aria-label={zappedAmount ? `Zap note, ${zappedAmount.toLocaleString()} sats${zapPending ? " pending" : " sent"}` : "Zap note"}
          aria-describedby={zapHintId}
          onClick={activateDefaultZap}
          onKeyDown={handleZapKeyDown}
          onContextMenu={(contextEvent) => { contextEvent.preventDefault(); if (!zapPendingRef.current) { guardFollowUpZapEvents(); openCustomZap(); } }}
          onPointerDown={startZapLongPress}
          onPointerMove={moveZapLongPress}
          onPointerUp={cancelLongPress}
          onPointerCancel={cancelLongPress}
          onPointerLeave={(pointerEvent) => { if (pointerEvent.pointerType === "touch") cancelLongPress(); }}
          disabled={zapPending}
        ><ActionIcon name="zap" />{zappedAmount ? `${zappedAmount.toLocaleString()} sats` : "Zap"}</button>
        <span className="sr-only" id={zapHintId}>Tap to zap {zapPreferences.amount.toLocaleString()} sats. Long-press, right-click, or press Shift+Enter for a custom zap.</span>
        <button type="button" aria-label={bookmarked ? "Remove bookmark" : "Bookmark note"} aria-pressed={bookmarked} onClick={() => bookmarks.toggle(event.id, readRelays[0])} disabled={bookmarkPending}><ActionIcon name="bookmark" filled={bookmarked} />{bookmarkPending ? "Saving…" : bookmarked ? "Saved" : "Save"}</button>
      </div>}
      {replyOpen && <div className="action-panel reply-panel">
        <label htmlFor={`reply-${event.id}`}>Reply to {profile.name}</label>
        <EnhancedTextarea id={`reply-${event.id}`} value={reply} mentions={replyMentions} maxLength={2_800} rows={3} placeholder="Write a reply…" onChange={setReply} disabled={busy === "reply"} blossomServers={blossomServers} relayHints={readRelays} onMentionSelected={(mention) => setReplyMentions((current) => [...current.filter(({ pubkey }) => pubkey !== mention.pubkey), mention])} onUploadingChange={setReplyUploading} />
        <button className="primary-button compact" type="button" onClick={submitReply} disabled={busy === "reply" || replyUploading || !reply.trim()}>{busy === "reply" ? "Publishing…" : replyUploading ? "Uploading image…" : "Publish reply"}</button>
      </div>}
      {quoteOpen && <div className="action-panel quote-panel"><Composer writeRelays={writeRelays} readRelays={readRelays} blossomServers={blossomServers} pool={pool} quote={{ event, relayHint: readRelays[0] }} onPublished={onPublished} onComplete={() => { setQuoteOpen(false); setMessage("Quote published."); }} onCancel={() => setQuoteOpen(false)} /></div>}
      {zapOpen && <div className="action-panel zap-panel">
        <label htmlFor={`zap-${event.id}`}>Zap {profile.name}</label>
        <div className="zap-fields"><input id={`zap-${event.id}`} inputMode="numeric" type="number" min="1" max="1000000" step="1" value={zapAmount} onChange={(change) => setZapAmount(change.target.value)} aria-label="Zap amount in sats" /><span>sats</span></div>
        <input value={zapComment} maxLength={280} placeholder="Optional zap message" onChange={(change) => setZapComment(change.target.value)} aria-label="Zap message" />
        <button className="primary-button compact" type="button" onClick={() => void submitZap(zapAmount, zapComment, true)} disabled={zapPending}>{zapPending ? "Sending…" : payInvoice ? "Zap with NWC" : "Continue to wallet"}</button>
        {invoice && <div className="invoice-actions"><a href={`lightning:${invoice}`}>Open Lightning wallet</a><button type="button" onClick={async () => { try { await navigator.clipboard.writeText(invoice); setMessage("Invoice copied."); } catch { setMessage("Copy was blocked. Use Open Lightning wallet instead."); } }}>Copy invoice</button></div>}
      </div>}
      {message && <p className="action-message" role="status">{message}</p>}
      {bookmarkError && <p className="action-message" role="alert">{bookmarkError}</p>}
      {activeMedia && <MediaViewer media={activeMedia} onClose={() => setActiveMedia(undefined)} />}
    </article>
  );
}

