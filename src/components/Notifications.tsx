import type { NotificationItem } from "../lib/notifications";
import { notificationThreadTarget } from "../lib/notifications";
import { Avatar, useProfile } from "./Avatar";
import type { OpenThread } from "../lib/threading";

const labels = { mention: "mentioned you", reply: "replied to a thread", reaction: "reacted to your note", repost: "reposted your note" } as const;

function NotificationRow({ item, onOpenThread }: { item: NotificationItem; onOpenThread: OpenThread }) {
  const { event, type } = item;
  const profile = useProfile(event.pubkey);
  const target = notificationThreadTarget(event);
  return (
    <button className="notification" type="button" disabled={!target} onClick={() => target && onOpenThread(target)}>
      <Avatar pubkey={event.pubkey} size="small" />
      <div><strong>{profile.name} {labels[type]}</strong>{event.content && <p>{event.content.slice(0, 180)}</p>}</div>
      <span className="notification-arrow" aria-hidden="true">›</span>
    </button>
  );
}

export function Notifications({ items, onOpenThread }: { items: NotificationItem[]; onOpenThread: OpenThread }) {
  if (!items.length) return <div className="empty-state"><span>◌</span><h2>All quiet here</h2><p>Mentions, replies, reactions and reposts from the last two weeks will appear here.</p></div>;
  return (
    <section className="notification-list" aria-label="Recent notifications">
      <p className="local-note">Unread state lives only in this browser. Canopy does not send push notifications.</p>
      {items.map((item) => <NotificationRow item={item} onOpenThread={onOpenThread} key={item.event.id} />)}
    </section>
  );
}

