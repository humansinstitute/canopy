import type { NostrEvent } from "../types";

const HEX_64 = /^[0-9a-f]{64}$/i;

export type HighlightSource = { type: "e" | "a" | "i" | "r"; value: string; relay?: string };

export interface NetworkHighlight {
  event: NostrEvent;
  excerpt: string;
  context?: string;
  comment?: string;
  source?: HighlightSource;
}

export function networkHighlights(events: NostrEvent[], followedPubkeys: string[], limit = 60): NetworkHighlight[] {
  const follows = new Set(followedPubkeys);
  return events
    .filter((event) => event.kind === 9802 && follows.has(event.pubkey))
    .sort((left, right) => right.created_at - left.created_at || left.id.localeCompare(right.id))
    .slice(0, limit)
    .map((event) => {
      const tag = event.tags.find((candidate) => ["e", "a", "i", "r"].includes(candidate[0]) && Boolean(candidate[1]));
      return {
        event,
        excerpt: event.content.trim() || "Media or non-text highlight",
        context: event.tags.find(([name]) => name === "context")?.[1],
        comment: event.tags.find(([name]) => name === "comment")?.[1],
        source: tag ? { type: tag[0] as HighlightSource["type"], value: tag[1], relay: tag[2] } : undefined,
      };
    });
}

export type LookmarkType = "reaction" | "reply" | "quote";

export interface LookmarkSignal {
  event: NostrEvent;
  targetId: string;
  targetRelay?: string;
  type: LookmarkType;
}

export interface LookmarkTarget {
  targetId: string;
  targetRelay?: string;
  latestAt: number;
  signals: LookmarkSignal[];
}

function eventTag(event: NostrEvent): string[] | undefined {
  const tags = event.tags.filter((tag) => tag[0] === "e" && HEX_64.test(tag[1] ?? ""));
  return tags.find((tag) => tag[3] === "reply") ?? (tags.length === 1 ? tags[0] : tags.at(-1));
}

export function classifyLookmark(event: NostrEvent): LookmarkSignal | undefined {
  if (event.kind === 7 && event.content.trim() === "👀") {
    const target = eventTag(event);
    return target ? { event, targetId: target[1], targetRelay: target[2], type: "reaction" } : undefined;
  }
  if (event.kind !== 1 || !event.content.includes("👀")) return undefined;
  const quote = event.tags.find((tag) => tag[0] === "q" && HEX_64.test(tag[1] ?? ""));
  if (quote) return { event, targetId: quote[1], targetRelay: quote[2], type: "quote" };
  const reply = eventTag(event);
  return reply ? { event, targetId: reply[1], targetRelay: reply[2], type: "reply" } : undefined;
}

export function dedupeLookmarks(events: NostrEvent[], followedPubkeys: string[], limit = 40): LookmarkTarget[] {
  const follows = new Set(followedPubkeys);
  const targets = new Map<string, LookmarkTarget>();
  for (const event of [...events].sort((left, right) => right.created_at - left.created_at || left.id.localeCompare(right.id))) {
    if (!follows.has(event.pubkey)) continue;
    const signal = classifyLookmark(event);
    if (!signal) continue;
    const existing = targets.get(signal.targetId);
    if (!existing) {
      targets.set(signal.targetId, { targetId: signal.targetId, targetRelay: signal.targetRelay, latestAt: event.created_at, signals: [signal] });
    } else if (existing.signals.length < 4 && !existing.signals.some(({ event: seen }) => seen.id === event.id)) {
      existing.signals.push(signal);
    }
  }
  return [...targets.values()].sort((left, right) => right.latestAt - left.latestAt || left.targetId.localeCompare(right.targetId)).slice(0, limit);
}
