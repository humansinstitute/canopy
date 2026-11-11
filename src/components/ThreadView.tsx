import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { RelayPool } from "applesauce-relay";
import type { NostrEvent } from "../types";
import { subscribeReferencedEvent, subscribeThread } from "../lib/nostr";
import { buildThreadTree, navigationTargetForEvent, type OpenThread, type ThreadNavigationTarget, type ThreadTreeNode } from "../lib/threading";
import { EventCard } from "./EventCard";
import type { InvoicePayer } from "../lib/interactions";
import type { ZapPreferences } from "../lib/zap-preferences";

interface ThreadViewProps {
  target: ThreadNavigationTarget;
  readRelays: string[];
  writeRelays: string[];
  blossomServers: string[];
  pool: Pick<RelayPool, "publish">;
  onPublished(event: NostrEvent): void;
  onOpenProfile(pubkey: string): void;
  onOpenThread: OpenThread;
  payInvoice?: InvoicePayer;
  zapPreferences: ZapPreferences;
  mock: boolean;
  onBack(): void;
}

type ViewMode = "default" | "expanded" | "side-branches";

export function ThreadView({ target, readRelays, writeRelays, blossomServers, pool, onPublished, onOpenProfile, onOpenThread, payInvoice, zapPreferences, mock, onBack }: ThreadViewProps) {
  const [threadEvents, setThreadEvents] = useState<NostrEvent[]>([]);
  const [focusEvent, setFocusEvent] = useState<NostrEvent>();
  const [lookupFinished, setLookupFinished] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("default");
  const [overrides, setOverrides] = useState<Map<string, boolean>>(() => new Map());
  const scrolledTarget = useRef<string | undefined>(undefined);
  const resolvedTarget = useMemo(() => focusEvent ? navigationTargetForEvent(focusEvent, target.relayHints, target.source) : target, [focusEvent, target]);
  const targetKey = `${resolvedTarget.rootId}:${resolvedTarget.focusId}`;

  useEffect(() => {
    setThreadEvents([]);
    const subscription = subscribeThread(resolvedTarget.rootId, readRelays, setThreadEvents, !mock);
    return () => subscription.unsubscribe();
  }, [resolvedTarget.rootId, readRelays, mock]);

  useEffect(() => {
    setFocusEvent(undefined);
    setLookupFinished(false);
    const timer = window.setTimeout(() => setLookupFinished(true), mock ? 100 : 6_000);
    const subscription = subscribeReferencedEvent({ id: target.focusId, relays: target.relayHints }, readRelays, setFocusEvent, !mock);
    return () => { window.clearTimeout(timer); subscription.unsubscribe(); };
  }, [target.focusId, target.relayHints, readRelays, mock]);

  useEffect(() => {
    setViewMode("default");
    setOverrides(new Map());
  }, [targetKey]);

  const events = useMemo(() => {
    const unique = new Map(threadEvents.map((event) => [event.id, event]));
    if (focusEvent) unique.set(focusEvent.id, focusEvent);
    return [...unique.values()];
  }, [threadEvents, focusEvent]);
  const tree = useMemo(() => buildThreadTree(events, resolvedTarget.rootId, resolvedTarget.focusId), [events, resolvedTarget.rootId, resolvedTarget.focusId]);
  const focusPath = useMemo(() => new Set(tree.focusPath), [tree.focusPath]);

  useEffect(() => {
    if (!tree.nodes.has(resolvedTarget.focusId) || scrolledTarget.current === targetKey) return;
    let frame = 0;
    const scroll = () => {
      scrolledTarget.current = targetKey;
      frame = window.requestAnimationFrame(() => {
        const element = document.getElementById(`thread-event-${resolvedTarget.focusId}`);
        element?.scrollIntoView?.({ block: "center", inline: "nearest", behavior: "auto" });
      });
    };
    if (tree.pathComplete) scroll();
    const settleTimer = tree.pathComplete ? 0 : window.setTimeout(scroll, mock ? 80 : 450);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      if (settleTimer) window.clearTimeout(settleTimer);
    };
  }, [resolvedTarget.focusId, targetKey, tree.nodes, tree.pathComplete, mock]);

  function isCollapsed(node: ThreadTreeNode): boolean {
    if (!node.descendantCount || focusPath.has(node.event.id)) return false;
    const override = overrides.get(node.event.id);
    if (override !== undefined) return override;
    if (viewMode === "expanded") return false;
    if (viewMode === "side-branches") return true;
    return tree.initialCollapsed.has(node.event.id);
  }

  function toggle(node: ThreadTreeNode) {
    setOverrides((current) => new Map(current).set(node.event.id, !isCollapsed(node)));
  }

  function setMode(mode: ViewMode) {
    setViewMode(mode);
    setOverrides(new Map());
  }

  function renderNode(node: ThreadTreeNode, depth: number) {
    const collapsed = isCollapsed(node);
    const focused = node.event.id === resolvedTarget.focusId;
    const directReplies = node.children.length;
    const replyLabel = `${directReplies} direct ${directReplies === 1 ? "reply" : "replies"}, ${node.descendantCount} total`;
    return <li className="thread-node" style={{ "--thread-depth": Math.min(depth, 5), "--thread-step": depth < 4 ? "18px" : "6px" } as CSSProperties} key={node.event.id}>
      <div id={`thread-event-${node.event.id}`} className={`thread-card${focused ? " thread-card--focus" : ""}`} data-thread-event-id={node.event.id}>
        {focused && <span className="thread-focus-label">{target.source === "notification" ? "From notification" : "Opened here"}</span>}
        <EventCard event={node.event} readRelays={readRelays} writeRelays={writeRelays} blossomServers={blossomServers} pool={pool} onPublished={onPublished} onOpenProfile={onOpenProfile} onOpenThread={onOpenThread} payInvoice={payInvoice} zapPreferences={zapPreferences} mock={mock} showReplyContext={false} />
        {node.descendantCount > 0 && <button className="branch-toggle" type="button" aria-expanded={!collapsed} aria-label={`${collapsed ? "Expand" : "Collapse"} replies to this note: ${replyLabel}`} onClick={() => toggle(node)}><span aria-hidden="true">{collapsed ? "+" : "−"}</span>{replyLabel}</button>}
      </div>
      {!collapsed && node.children.length > 0 && <ol className="thread-children" aria-label={`Replies to note ${node.event.id.slice(0, 8)}`}>{node.children.map((child) => renderNode(child, depth + 1))}</ol>}
    </li>;
  }

  const position = tree.pathComplete
    ? tree.focusDepth === 0 ? "Original post · opened here" : `Original post → ${tree.focusDepth} ${tree.focusDepth === 1 ? "reply" : "replies"} deep → opened note`
    : "Original post → part of the path is unavailable → opened note";

  return <>
    <div className="thread-heading">
      <button className="back-button" type="button" onClick={onBack} aria-label="Back from thread">←</button>
      <div><p className="eyebrow">Conversation</p><h1>Message thread</h1></div>
    </div>
    <div className="thread-overview" aria-live="polite">
      <div><strong>{position}</strong><span>{tree.nodes.size} {tree.nodes.size === 1 ? "note" : "notes"} · {tree.replyCount} {tree.replyCount === 1 ? "reply" : "replies"}</span></div>
      <div className="thread-actions" aria-label="Thread display controls"><button type="button" onClick={() => setMode("expanded")}>Expand all</button><button type="button" onClick={() => setMode("side-branches")}>Collapse side branches</button></div>
    </div>
    {lookupFinished && !focusEvent && <div className="empty-state" role="status"><h2>Note not found</h2><p>The opened note is unavailable on these public relays. It may arrive later; you can also try reloading.</p></div>}
    <section className="feed thread-feed" aria-label="Message thread">
      {events.length ? <>
        {tree.root && <ol className="thread-tree" aria-label="Conversation tree">{renderNode(tree.root, 0)}</ol>}
        {tree.otherReplies.length > 0 && <section className="thread-others" aria-labelledby="other-replies-heading"><div><h2 id="other-replies-heading">Other replies</h2><p>Their missing or conflicting ancestry could not be placed safely.</p></div><ol className="thread-tree thread-tree--other">{tree.otherReplies.map((node) => renderNode(node, 0))}</ol></section>}
      </> : !lookupFinished && <div className="empty-state"><span>◌</span><h2>Finding the conversation</h2><p>Canopy is loading the opened note, original post and replies from your read relays.</p></div>}
    </section>
  </>;
}
