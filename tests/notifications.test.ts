import { describe, expect, it } from "vitest";
import type { NostrEvent } from "../src/types";
import { classifyNotification, notificationThreadTarget, notificationsFrom, unreadCount } from "../src/lib/notifications";

const me = "a".repeat(64);
const event = (kind: number, tags: string[][] = [["p", me]], created_at = 20): NostrEvent => ({ id: `${kind}`.padStart(64, "0"), pubkey: "b".repeat(64), created_at, kind, tags, content: "+", sig: "c".repeat(128) });

describe("notification classification", () => {
  it("classifies mentions, replies, reactions and reposts", () => {
    expect(classifyNotification(event(1), me)).toBe("mention");
    expect(classifyNotification(event(1, [["p", me], ["e", "d".repeat(64)]]), me)).toBe("reply");
    expect(classifyNotification(event(7), me)).toBe("reaction");
    expect(classifyNotification(event(6), me)).toBe("repost");
  });

  it("excludes self activity and counts unread locally", () => {
    expect(classifyNotification({ ...event(1), pubkey: me }, me)).toBeNull();
    const items = notificationsFrom([event(1, [["p", me]], 10), event(7, [["p", me]], 30)], me);
    expect(unreadCount(items, 20)).toBe(1);
  });

  it("resolves notification conversations using NIP-10 and legacy targets", () => {
    const root = "d".repeat(64);
    const reply = "e".repeat(64);
    const replyEvent = event(1, [["p", me], ["e", root, "wss://relay.damus.io", "root"], ["e", reply, "wss://nos.lol", "reply"]]);
    expect(notificationThreadTarget(replyEvent)).toEqual({ rootId: root, focusId: replyEvent.id, relayHints: ["wss://relay.damus.io", "wss://nos.lol"], source: "notification" });
    const mention = event(1, [["p", me]]);
    expect(notificationThreadTarget(mention)).toEqual({ rootId: mention.id, focusId: mention.id, relayHints: [], source: "notification" });
    expect(notificationThreadTarget(event(7, [["p", me], ["e", root]]))).toEqual({ rootId: root, focusId: root, relayHints: [], source: "notification" });
    expect(notificationThreadTarget(event(6, [["p", me]]))).toBeNull();
  });
});

