import { publishUntilAccepted } from "./relay-publish";
import type { RelayPool } from "applesauce-relay";
import type { EventTemplate } from "nostr-tools";
import type { NostrEvent, NostrProvider } from "../types";

export const BOOKMARK_LIST_KIND = 10003;
const HEX_64 = /^[0-9a-f]{64}$/i;

export interface NoteBookmark {
  id: string;
  relay?: string;
}

export interface BookmarkList {
  event?: NostrEvent;
  notes: NoteBookmark[];
  articles: string[];
}

export function parseBookmarkList(event?: NostrEvent): BookmarkList {
  if (!event || event.kind !== BOOKMARK_LIST_KIND) return { event, notes: [], articles: [] };
  const notes: NoteBookmark[] = [];
  const seenNotes = new Set<string>();
  const articles: string[] = [];
  const seenArticles = new Set<string>();
  for (const tag of event.tags) {
    if (tag[0] === "e" && HEX_64.test(tag[1] ?? "") && !seenNotes.has(tag[1])) {
      seenNotes.add(tag[1]);
      notes.push({ id: tag[1], relay: /^wss?:\/\//i.test(tag[2] ?? "") ? tag[2] : undefined });
    } else if (tag[0] === "a" && tag[1] && !seenArticles.has(tag[1])) {
      seenArticles.add(tag[1]);
      articles.push(tag[1]);
    }
  }
  return { event, notes, articles };
}

export function hasBookmark(event: NostrEvent | undefined, eventId: string): boolean {
  return parseBookmarkList(event).notes.some(({ id }) => id === eventId);
}

export function updateBookmarkTemplate(
  current: NostrEvent | undefined,
  eventId: string,
  saved: boolean,
  relayHint?: string,
  now = Math.floor(Date.now() / 1000),
): EventTemplate {
  if (!HEX_64.test(eventId)) throw new Error("The note has an invalid event ID.");
  const tags = (current?.tags ?? []).map((tag) => [...tag]);
  const existing = tags.some((tag) => tag[0] === "e" && tag[1] === eventId);
  const nextTags = saved
    ? existing ? tags : [...tags, relayHint ? ["e", eventId, relayHint] : ["e", eventId]]
    : tags.filter((tag) => !(tag[0] === "e" && tag[1] === eventId));
  return {
    kind: BOOKMARK_LIST_KIND,
    created_at: Math.max(now, (current?.created_at ?? 0) + 1),
    tags: nextTags,
    content: current?.content ?? "",
  };
}

export function freshestBookmarkList(events: NostrEvent[], pubkey: string): NostrEvent | undefined {
  return events
    .filter((event) => event.kind === BOOKMARK_LIST_KIND && event.pubkey === pubkey)
    .sort((left, right) => right.created_at - left.created_at || left.id.localeCompare(right.id))[0];
}

export interface BookmarkSnapshot {
  event?: NostrEvent;
  saved: ReadonlySet<string>;
  pending: ReadonlySet<string>;
  errors: ReadonlyMap<string, string>;
}

type BookmarkListener = (snapshot: BookmarkSnapshot) => void;

export class BookmarkController {
  private current?: NostrEvent;
  private desired = new Map<string, boolean>();
  private pending = new Set<string>();
  private errors = new Map<string, string>();
  private queue = Promise.resolve();
  private listeners = new Set<BookmarkListener>();

  constructor(
    private readonly sign: NostrProvider["signEvent"],
    private readonly publish: Pick<RelayPool, "publish">,
    private readonly writeRelays: string[],
  ) {}

  subscribe(listener: BookmarkListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  setRemote(event: NostrEvent | undefined): void {
    if (!event) return;
    if (!this.current || event.created_at > this.current.created_at || (event.created_at === this.current.created_at && event.id < this.current.id)) {
      this.current = event;
      this.emit();
    }
  }

  snapshot(): BookmarkSnapshot {
    const saved = new Set(parseBookmarkList(this.current).notes.map(({ id }) => id));
    for (const [id, value] of this.desired) value ? saved.add(id) : saved.delete(id);
    return { event: this.current, saved, pending: new Set(this.pending), errors: new Map(this.errors) };
  }

  toggle(eventId: string, relayHint?: string): Promise<boolean> {
    if (this.pending.has(eventId)) return Promise.resolve(this.snapshot().saved.has(eventId));
    const target = !this.snapshot().saved.has(eventId);
    this.desired.set(eventId, target);
    this.pending.add(eventId);
    this.errors.delete(eventId);
    this.emit();

    const operation = this.queue.then(async () => {
      try {
        const template = updateBookmarkTemplate(this.current, eventId, target, relayHint);
        const signed = await this.sign(template);
        const results = await publishUntilAccepted(this.publish, this.writeRelays, signed);
        if (!results.some((result) => result.ok)) throw new Error(target ? "Bookmark could not be saved." : "Bookmark could not be removed.");
        this.current = signed;
        return target;
      } catch (error) {
        this.errors.set(eventId, error instanceof Error ? error.message : "The bookmark update failed.");
        return !target;
      } finally {
        this.desired.delete(eventId);
        this.pending.delete(eventId);
        this.emit();
      }
    });
    this.queue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private emit(): void {
    const snapshot = this.snapshot();
    this.listeners.forEach((listener) => listener(snapshot));
  }
}
