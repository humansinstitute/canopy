import { useEffect, useState } from "react";
import type { RelayPool } from "applesauce-relay";
import type { NostrEvent } from "../types";
import { compactPubkey } from "../lib/content";
import { subscribeContactList, subscribeProfileFeed, type ProfileFeedState } from "../lib/nostr";
import { Avatar, useProfile } from "./Avatar";
import { EventCard } from "./EventCard";
import type { InvoicePayer } from "../lib/interactions";
import { ProfileShare } from "./ProfileShare";
import { isFollowing, type ContactListController } from "../lib/identity";
import type { ZapPreferences } from "../lib/zap-preferences";
import type { OpenThread } from "../lib/threading";

interface ProfilePageProps {
  pubkey: string;
  viewerPubkey?: string;
  contacts?: ContactListController;
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

export function ProfilePage({ pubkey, viewerPubkey, contacts, readRelays, writeRelays, blossomServers, pool, onPublished, onOpenProfile, onOpenThread, payInvoice, zapPreferences, mock, onBack }: ProfilePageProps) {
  const profile = useProfile(pubkey);
  const [feed, setFeed] = useState<ProfileFeedState>({ status: "loading", events: [] });
  const [sharing, setSharing] = useState(false);
  const [following, setFollowing] = useState(false);
  const [followPending, setFollowPending] = useState(false);
  const [followMessage, setFollowMessage] = useState<string>();

  useEffect(() => {
    setFeed({ status: "loading", events: [] });
    const subscription = subscribeProfileFeed(pubkey, readRelays, setFeed, !mock);
    return () => subscription.unsubscribe();
  }, [pubkey, readRelays, mock]);

  useEffect(() => {
    if (!viewerPubkey || !contacts || pubkey === viewerPubkey) return;
    const subscription = subscribeContactList(viewerPubkey, (event) => {
      contacts.setRemote(event);
      if (!followPending) setFollowing(isFollowing(event, pubkey));
    });
    return () => subscription.unsubscribe();
  }, [pubkey, viewerPubkey, contacts, followPending]);

  async function toggleFollow() {
    if (!contacts || followPending) return;
    const previous = following;
    const target = !previous;
    setFollowing(target);
    setFollowPending(true);
    setFollowMessage(undefined);
    try {
      const result = await contacts.setFollowing(pubkey, target);
      setFollowMessage(result.status === "partial"
        ? `${target ? "Follow" : "Unfollow"} published to ${result.accepted} relay${result.accepted === 1 ? "" : "s"}; some relays were unavailable.`
        : target ? "Following." : "Unfollowed.");
    } catch (error) {
      setFollowing(previous);
      setFollowMessage(error instanceof Error ? error.message : "The follow update failed.");
    } finally {
      setFollowPending(false);
    }
  }

  return (
    <>
      <div className="profile-heading">
        <button className="back-button" type="button" onClick={onBack} aria-label="Back from profile">←</button>
        <Avatar pubkey={pubkey} />
        <div className="profile-heading-copy"><p className="eyebrow">Profile</p><h1>{profile.name}</h1><p>{compactPubkey(pubkey)}</p></div>
        <div className="profile-heading-actions">
          {viewerPubkey && contacts && pubkey !== viewerPubkey && <button className={`follow-button ${following ? "is-following" : ""}`} type="button" onClick={toggleFollow} disabled={followPending} aria-pressed={following}>{followPending ? (following ? "Following…" : "Unfollowing…") : following ? "Following" : "Follow"}</button>}
          <button className="profile-share-button" type="button" onClick={() => setSharing(true)} aria-label={`Share ${profile.name}'s profile`}><span aria-hidden="true">⌁</span> Share</button>
        </div>
      </div>
      {followMessage && <p className="profile-follow-message" role="status">{followMessage}</p>}
      <section className="feed profile-feed" aria-label={`${profile.name}'s posts`}>
        {feed.events.length
          ? feed.events.map((event) => <EventCard event={event} readRelays={readRelays} writeRelays={writeRelays} blossomServers={blossomServers} pool={pool} onPublished={onPublished} onOpenProfile={onOpenProfile} onOpenThread={onOpenThread} payInvoice={payInvoice} zapPreferences={zapPreferences} mock={mock} key={event.id} />)
          : feed.status === "loading"
            ? <div className="empty-state"><span>◌</span><h2>Loading posts</h2><p>Canopy is checking your read relays for posts from {profile.name}.</p></div>
            : <div className="empty-state"><span>◌</span><h2>No posts found</h2><p>This user has no recent kind-1 posts on your current read relays.</p></div>}
      </section>
      {sharing && <ProfileShare pubkey={pubkey} name={profile.name} onClose={() => setSharing(false)} />}
    </>
  );
}
