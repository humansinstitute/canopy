import { useEffect, useState } from "react";
import { compactPubkey } from "../lib/content";
import { localIndexStats, onLocalIndexChange, searchLocalIndex, type LocalIndexStats, type LocalSearchResults } from "../lib/local-search";
import { Avatar, useProfile } from "./Avatar";
import { getReferencedEvent } from "../lib/nostr";
import { navigationTargetForEvent, type OpenThread } from "../lib/threading";
import { parseExactIdentity, resolveRemoteIdentity, type ExactIdentity, type IdentityResolution } from "../lib/remote-identity";
import type { FollowingCacheStatus } from "../lib/following-cache";

function bytesLabel(bytes: number | undefined): string {
  if (bytes === undefined) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString()} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function PostResult({ post, onOpen }: { post: LocalSearchResults["posts"][number]; onOpen: OpenThread }) {
  const profile = useProfile(post.pubkey);
  const target = getReferencedEvent({ id: post.id });
  return <button className="search-result search-post-result" type="button" onClick={() => onOpen(target ? navigationTargetForEvent(target) : { rootId: post.id, focusId: post.id, relayHints: [] })}>
    <Avatar pubkey={post.pubkey} size="small" />
    <span><strong>{profile.name}</strong><small>{new Date(post.createdAt * 1_000).toLocaleDateString()}</small><span>{post.content.slice(0, 220)}</span></span>
    <b aria-hidden="true">→</b>
  </button>;
}

export interface SearchPageProps {
  readRelays: string[];
  mock: boolean;
  onOpenProfile(pubkey: string): void;
  onOpenThread: OpenThread;
  resolveIdentity?: (identity: ExactIdentity, readRelays: string[], mock: boolean) => Promise<IdentityResolution>;
  cacheStatus?: FollowingCacheStatus;
  onRefreshCache?(): void;
}

function successLabel(timestamp: number | undefined, now = Date.now()): string {
  if (timestamp === undefined) return "Never";
  const elapsed = Math.max(0, now - timestamp);
  if (elapsed < 60_000) return "Just now";
  if (elapsed < 60 * 60_000) return `${Math.floor(elapsed / 60_000)} min ago`;
  if (elapsed < 24 * 60 * 60_000) return `${Math.floor(elapsed / (60 * 60_000))} hr ago`;
  const days = Math.floor(elapsed / (24 * 60 * 60_000));
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function CacheStatus({ status, onRefresh }: { status: FollowingCacheStatus; onRefresh(): void }) {
  const busy = status.phase !== "idle" || status.pendingForce;
  const progress = status.phase === "following"
    ? "Syncing following list…"
    : status.phase === "profiles"
      ? status.progress?.total
        ? `Refreshing profile batch ${Math.min(status.progress.completed + 1, status.progress.total)} of ${status.progress.total}…`
        : "Refreshing profile details…"
      : status.pendingForce ? "Finishing current refresh…" : undefined;
  return <section className="cache-status" aria-labelledby="cache-status-title">
    <div className="cache-status-heading"><div><p className="eyebrow">Public identity cache</p><h2 id="cache-status-title">Following cache</h2></div><button className="secondary-button compact" type="button" onClick={onRefresh} disabled={busy}>{busy ? "Refreshing…" : "Refresh now"}</button></div>
    <dl>
      <div><dt>Following list</dt><dd>{successLabel(status.followingSyncedAt)}</dd></div>
      <div><dt>Profile details</dt><dd>{successLabel(status.profilesRefreshedAt)}</dd></div>
      <div><dt>Cached following</dt><dd>{status.followedPubkeys.length.toLocaleString()}</dd></div>
    </dl>
    {progress && <p className="cache-progress" role="status">{progress}</p>}
    {!progress && status.lastAttempt?.error && <p className="cache-error" role="alert">Last refresh: {status.lastAttempt.error} Your previous cache is still available.</p>}
    <p className="cache-cadence">Profile details refresh every 24 hours; the following list resyncs every 72 hours while Canopy is open, visible and online.</p>
  </section>;
}

export function SearchPage({ readRelays, mock, onOpenProfile, onOpenThread, resolveIdentity = resolveRemoteIdentity, cacheStatus, onRefreshCache }: SearchPageProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LocalSearchResults>({ people: [], posts: [] });
  const [stats, setStats] = useState<LocalIndexStats>();
  const [error, setError] = useState<string>();
  const [resolveMessage, setResolveMessage] = useState<string>();
  const [resolving, setResolving] = useState(false);
  const exactIdentity = parseExactIdentity(query);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      void Promise.all([searchLocalIndex(query), localIndexStats()]).then(([nextResults, nextStats]) => {
        if (!active) return;
        setResults(nextResults);
        setStats(nextStats);
        setError(undefined);
      }).catch(() => { if (active) setError("Local search is unavailable in this browser."); });
    };
    const timer = window.setTimeout(refresh, 80);
    const unsubscribe = onLocalIndexChange(refresh);
    return () => { active = false; window.clearTimeout(timer); unsubscribe(); };
  }, [query]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = parseExactIdentity(query);
    if (parsed.kind === "none") return;
    if (parsed.kind === "invalid") { setResolveMessage(parsed.message); return; }
    if (resolving) return;
    setResolving(true);
    setResolveMessage("Resolving this identity from your read relays…");
    try {
      const result = await resolveIdentity(parsed.identity, readRelays, mock);
      if (!result.metadataFound) {
        setResolveMessage(mock
          ? "No profile metadata is present in this mock session. Opening the identity anyway…"
          : "No profile metadata was found before the relay timeout. Opening the identity anyway…");
        await new Promise((resolve) => window.setTimeout(resolve, 700));
      }
      onOpenProfile(result.identity.pubkey);
    } catch {
      setResolveMessage("The relays could not resolve profile metadata. Opening the identity anyway…");
      await new Promise((resolve) => window.setTimeout(resolve, 700));
      onOpenProfile(parsed.identity.pubkey);
    } finally {
      setResolving(false);
    }
  }

  return <>
    <div className="search-heading"><p className="eyebrow">On this device</p><h1>Search Canopy</h1><p>People and the latest {(21_256).toLocaleString()} notes Canopy has encountered.</p></div>
    {cacheStatus && onRefreshCache && <CacheStatus status={cacheStatus} onRefresh={onRefreshCache} />}
    <form className="local-search-box" onSubmit={submit}><span aria-hidden="true">⌕</span><input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setResolveMessage(undefined); }} placeholder="Search names, npubs or post text" aria-label="Search local people and posts" autoFocus />{exactIdentity.kind !== "none" && <button type="submit" disabled={resolving}>{resolving ? "Resolving…" : "Open identity"}</button>}</form>
    {resolveMessage && <p className="identity-resolve-message" role={exactIdentity.kind === "invalid" ? "alert" : "status"}>{resolveMessage}</p>}
    {stats && <p className="search-stats">{stats.people.toLocaleString()} people · {stats.posts.toLocaleString()} posts · ≈ {bytesLabel(stats.estimatedIndexBytes)} local index{stats.siteUsageBytes !== undefined ? ` · ${bytesLabel(stats.siteUsageBytes)} total site storage` : ""}</p>}
    {error ? <div className="empty-state"><span>!</span><h2>Search unavailable</h2><p>{error}</p></div> : <div className="search-sections">
      <section aria-labelledby="people-results"><h2 id="people-results">People</h2>
        <div className="search-results">{results.people.map((person) => <button className="search-result" type="button" onClick={() => onOpenProfile(person.pubkey)} key={person.pubkey}><Avatar pubkey={person.pubkey} size="small" /><span><strong>{person.name || person.username || compactPubkey(person.pubkey)}</strong><small>{person.npub}</small></span><b aria-hidden="true">→</b></button>)}</div>
        {!results.people.length && <p className="search-empty">No cached people match.</p>}
      </section>
      <section aria-labelledby="post-results"><h2 id="post-results">Posts</h2>
        {!query.trim() ? <p className="search-empty">Type a word or phrase to search cached post text.</p> : results.posts.length ? <div className="search-results">{results.posts.map((post) => <PostResult post={post} onOpen={onOpenThread} key={post.id} />)}</div> : <p className="search-empty">No cached posts match.</p>}
      </section>
    </div>}
    <p className="local-search-note">This public Nostr data stays in this browser. Canopy stores text and identifiers only—not media files, private keys or signing authority.</p>
  </>;
}
