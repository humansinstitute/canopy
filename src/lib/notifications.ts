import type { NostrEvent } from "../types";
import { navigationTargetForEvent, type ThreadNavigationTarget } from "./threading";

export type NotificationKind = "mention" | "reply" | "reaction" | "repost";

export interface NotificationItem {
  event: NostrEvent;
  type: NotificationKind;
}

export function classifyNotification(event: NostrEvent, pubkey: string): NotificationKind | null {
  if (event.pubkey === pubkey) return null;
  if (!event.tags.some((tag) => tag[0] === "p" && tag[1] === pubkey)) return null;
  if (event.kind === 7) return "reaction";
  if (event.kind === 6 || event.kind === 16) return "repost";
  if (event.kind === 1) {
    return event.tags.some((tag) => tag[0] === "e") ? "reply" : "mention";
  }
  return null;
}

export function notificationsFrom(events: NostrEvent[], pubkey: string): NotificationItem[] {
  return events.flatMap((event) => {
    const type = classifyNotification(event, pubkey);
    return type ? [{ event, type }] : [];
  });
}

export function unreadCount(items: NotificationItem[], seenAt: number): number {
  return items.filter(({ event }) => event.created_at > seenAt).length;
}

export function notificationThreadTarget(event: NostrEvent): ThreadNavigationTarget | null {
  if (event.kind === 1) {
    return navigationTargetForEvent(event, [], "notification");
  }
  const eventTags = event.tags.filter((tag) => tag[0] === "e" && /^[0-9a-f]{64}$/i.test(tag[1] ?? ""));
  const focusTag = eventTags.find((tag) => tag[3] === "reply") ?? eventTags.at(-1);
  if (!focusTag) return null;
  const rootTag = eventTags.find((tag) => tag[3] === "root");
  return {
    rootId: (rootTag?.[1] ?? focusTag[1]).toLowerCase(),
    focusId: focusTag[1].toLowerCase(),
    relayHints: [...new Set([rootTag?.[2], focusTag[2]].filter((relay): relay is string => Boolean(relay)))],
    source: "notification",
  };
}

