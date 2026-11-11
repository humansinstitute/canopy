import { EventStore, mapEventsToStore } from "applesauce-core";
import { ProfileModel, PublicContactsModel, TimelineModel } from "applesauce-core/models";
import { ThreadModel, type Thread } from "applesauce-common/models";
import { onlyEvents, RelayPool } from "applesauce-relay";
import type { NostrEvent } from "../types";
import type { AddressPointer, EventPointer } from "nostr-tools/nip19";
import { verifyEvent } from "nostr-tools/pure";
import { Observable, Subscription, concat, distinctUntilChanged, lastValueFrom, map, of, switchMap, timer, toArray } from "rxjs";
import { uniqueRelays } from "./relays";

export const eventStore = new EventStore();
export const relayPool = new RelayPool();

const requestedProfiles = new Set<string>();

export type NetworkState = "connecting" | "online" | "degraded";

export interface NostrStreams {
  close(): void;
}

export type FollowingFeedStatus = "loading" | "ready" | "empty";

export interface FollowingFeedState {
  status: FollowingFeedStatus;
  events: NostrEvent[];
  followCount: number;
}

export interface ProfileFeedState {
  status: "loading" | "ready" | "empty";
  events: NostrEvent[];
}

export interface DiscoveryState {
  followedPubkeys: string[];
  events: NostrEvent[];
  truncatedFollows: boolean;
}

export function followedPubkeys(contacts: Array<{ pubkey: string }> | undefined): string[] | undefined {
  if (!contacts) return undefined;
  return [...new Set(contacts.map(({ pubkey }) => pubkey).filter((pubkey) => /^[0-9a-f]{64}$/i.test(pubkey)).map((pubkey) => pubkey.toLowerCase()))].sort();
}

export function newestUnique(events: NostrEvent[], limit = 60): NostrEvent[] {
  const unique = new Map(events.map((event) => [event.id, event]));
  return [...unique.values()].sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id)).slice(0, limit);
}

export function startNostrStreams(
  pubkey: string,
  readRelays: string[],
  onNetwork: (state: NetworkState) => void,
): NostrStreams {
  const subscriptions: Subscription[] = [];
  onNetwork("connecting");
  const degradedTimer = window.setTimeout(() => onNetwork("degraded"), 8_000);

  const contacts = relayPool
    .subscription(readRelays, { kinds: [3], authors: [pubkey], limit: 1 }, { reconnect: Infinity, resubscribe: true })
    .pipe(onlyEvents(), mapEventsToStore(eventStore));

  subscriptions.push(
    contacts.subscribe({
      next: () => {
        window.clearTimeout(degradedTimer);
        onNetwork("online");
      },
      error: () => onNetwork("degraded"),
    }),
  );

  const notifications = relayPool
    .subscription(
      readRelays,
      { kinds: [1, 6, 7, 16], "#p": [pubkey], since: Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 14, limit: 100 },
      { reconnect: Infinity, resubscribe: true },
    )
    .pipe(onlyEvents(), mapEventsToStore(eventStore));

  subscriptions.push(
    notifications.subscribe({
      next: (event) => {
        window.clearTimeout(degradedTimer);
        onNetwork("online");
        ensureProfile(event.pubkey, readRelays);
      },
      error: () => onNetwork("degraded"),
    }),
  );

  return {
    close() {
      window.clearTimeout(degradedTimer);
      subscriptions.forEach((subscription) => subscription.unsubscribe());
    },
  };
}

export function followingFeed$(pubkey: string, readRelays: string[], connectRelays = true): Observable<FollowingFeedState> {
  return eventStore.model(PublicContactsModel, pubkey).pipe(
    map((contacts) => followedPubkeys(contacts)),
    distinctUntilChanged((left, right) => JSON.stringify(left) === JSON.stringify(right)),
    switchMap((authors) => {
      if (!authors) return concat(
        of({ status: "loading", events: [], followCount: 0 } as FollowingFeedState),
        timer(6_000).pipe(map(() => ({ status: "empty", events: [], followCount: 0 } as FollowingFeedState))),
      );
      if (!authors.length) return of({ status: "empty", events: [], followCount: 0 } as FollowingFeedState);

      return new Observable<FollowingFeedState>((subscriber) => {
        authors.forEach((author) => ensureProfile(author, readRelays));
        const timeline = eventStore.model(TimelineModel, { kinds: [1], authors }).subscribe((events) => {
          subscriber.next({ status: "ready", events: newestUnique(events as NostrEvent[]), followCount: authors.length });
        });
        const network = connectRelays
          ? relayPool
              .subscription(readRelays, { kinds: [1], authors, limit: 60 }, { reconnect: Infinity, resubscribe: true })
              .pipe(onlyEvents(), mapEventsToStore(eventStore))
              .subscribe({ next: (event) => ensureProfile(event.pubkey, readRelays), error: () => undefined })
          : undefined;
        return () => {
          timeline.unsubscribe();
          network?.unsubscribe();
        };
      });
    }),
  );
}

export function subscribeFollowingFeed(
  pubkey: string,
  readRelays: string[],
  onState: (state: FollowingFeedState) => void,
  connectRelays = true,
): Subscription {
  return followingFeed$(pubkey, readRelays, connectRelays).subscribe(onState);
}

export function profileFeed$(pubkey: string, readRelays: string[], connectRelays = true): Observable<ProfileFeedState> {
  return new Observable<ProfileFeedState>((subscriber) => {
    let hasEvents = false;
    subscriber.next({ status: "loading", events: [] });
    ensureProfile(pubkey, readRelays);
    const emptyTimer = window.setTimeout(() => {
      if (!hasEvents) subscriber.next({ status: "empty", events: [] });
    }, connectRelays ? 6_000 : 0);
    const timeline = eventStore.model(TimelineModel, { kinds: [1], authors: [pubkey] }).subscribe((events) => {
      const ordered = newestUnique(events as NostrEvent[]);
      if (!ordered.length) return;
      hasEvents = true;
      window.clearTimeout(emptyTimer);
      subscriber.next({ status: "ready", events: ordered });
    });
    const network = connectRelays
      ? relayPool
          .subscription(readRelays, { kinds: [1], authors: [pubkey], limit: 60 }, { reconnect: Infinity, resubscribe: true })
          .pipe(onlyEvents(), mapEventsToStore(eventStore))
          .subscribe({ error: () => undefined })
      : undefined;
    return () => {
      window.clearTimeout(emptyTimer);
      timeline.unsubscribe();
      network?.unsubscribe();
    };
  });
}

export function subscribeProfileFeed(
  pubkey: string,
  readRelays: string[],
  onState: (state: ProfileFeedState) => void,
  connectRelays = true,
): Subscription {
  return profileFeed$(pubkey, readRelays, connectRelays).subscribe(onState);
}

export function subscribeTimeline(kinds: number[], onEvents: (events: NostrEvent[]) => void): Subscription {
  return eventStore.model(TimelineModel, { kinds }).subscribe((events) => onEvents(events as NostrEvent[]));
}

export function subscribeBookmarkList(
  pubkey: string,
  readRelays: string[],
  onEvent: (event: NostrEvent | undefined) => void,
  connectRelays = true,
): Subscription {
  const subscription = new Subscription();
  let freshest = eventStore.getReplaceable(10003, pubkey) as NostrEvent | undefined;
  onEvent(freshest);
  if (connectRelays) {
    subscription.add(relayPool
      .subscription(readRelays, { kinds: [10003], authors: [pubkey], limit: 1 }, { reconnect: Infinity, resubscribe: true })
      .pipe(onlyEvents(), mapEventsToStore(eventStore))
      .subscribe({
        next: (event) => {
          if (!freshest || event.created_at > freshest.created_at || (event.created_at === freshest.created_at && event.id < freshest.id)) {
            freshest = event as NostrEvent;
            onEvent(freshest);
          }
        },
        error: () => undefined,
      }));
  }
  return subscription;
}

export function subscribeDiscovery(
  pubkey: string,
  readRelays: string[],
  onState: (state: DiscoveryState) => void,
  connectRelays = true,
): Subscription {
  const MAX_FOLLOWS = 256;
  const MAX_EVENTS = 240;
  return eventStore.model(PublicContactsModel, pubkey).pipe(
    map((contacts) => followedPubkeys(contacts) ?? []),
    distinctUntilChanged((left, right) => JSON.stringify(left) === JSON.stringify(right)),
    switchMap((allAuthors) => new Observable<DiscoveryState>((subscriber) => {
      const authors = allAuthors.slice(0, MAX_FOLLOWS);
      const emit = (events: NostrEvent[]) => subscriber.next({
        followedPubkeys: authors,
        events: newestUnique(events.filter((event) => authors.includes(event.pubkey)), MAX_EVENTS),
        truncatedFollows: allAuthors.length > authors.length,
      });
      if (!authors.length) {
        emit([]);
        return undefined;
      }
      const timeline = eventStore.model(TimelineModel, { kinds: [1, 7, 9802], authors }).subscribe((events) => emit(events as NostrEvent[]));
      const network = connectRelays
        ? relayPool.subscription(readRelays, {
            kinds: [1, 7, 9802],
            authors,
            since: Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 30,
            limit: MAX_EVENTS,
          }, { reconnect: Infinity, resubscribe: true })
            .pipe(onlyEvents(), mapEventsToStore(eventStore))
            .subscribe({ next: (event) => ensureProfile(event.pubkey, readRelays), error: () => undefined })
        : undefined;
      return () => {
        timeline.unsubscribe();
        network?.unsubscribe();
      };
    })),
  ).subscribe(onState);
}

export function subscribeProfile(pubkey: string, onProfile: (profile: Record<string, unknown> | undefined) => void): Subscription {
  return eventStore.model(ProfileModel, pubkey).subscribe((profile) => onProfile(profile as Record<string, unknown> | undefined));
}

export function getProfileEvent(pubkey: string): NostrEvent | undefined {
  return eventStore.getReplaceable(0, pubkey) as NostrEvent | undefined;
}

export async function fetchLatestProfile(pubkey: string, readRelays: string[], connectRelays = true): Promise<NostrEvent | undefined> {
  if (connectRelays) {
    const events = await lastValueFrom(
      relayPool.request(readRelays, { kinds: [0], authors: [pubkey], limit: 1 }, { timeout: 5_000, reconnect: 1 }).pipe(toArray()),
      { defaultValue: [] },
    );
    events.forEach((event) => eventStore.add(event));
  }
  return getProfileEvent(pubkey);
}

export function getContactListEvent(pubkey: string): NostrEvent | undefined {
  return eventStore.getReplaceable(3, pubkey) as NostrEvent | undefined;
}

export function subscribeContactList(pubkey: string, onEvent: (event: NostrEvent | undefined) => void): Subscription {
  return eventStore.replaceable(3, pubkey).subscribe((event) => onEvent(event as NostrEvent | undefined));
}

export async function fetchLatestContactList(pubkey: string, readRelays: string[], connectRelays = true): Promise<NostrEvent | undefined> {
  if (connectRelays) {
    const events = await lastValueFrom(
      relayPool.request(readRelays, { kinds: [3], authors: [pubkey], limit: 1 }, { timeout: 5_000, reconnect: 1 }).pipe(toArray()),
      { defaultValue: [] },
    );
    events.forEach((event) => eventStore.add(event));
  }
  return getContactListEvent(pubkey);
}

export interface ProfileBatchProgress {
  completed: number;
  total: number;
  profiles: number;
}

export interface ProfileBatchResult extends ProfileBatchProgress {
  failed: number;
}

export const PROFILE_BATCH_SIZE = 100;

function latestReplaceable(events: NostrEvent[]): NostrEvent | undefined {
  return events.sort((left, right) => right.created_at - left.created_at || left.id.localeCompare(right.id))[0];
}

function isValidRelayEvent(event: NostrEvent, kind: number, authors: string[]): boolean {
  return event.kind === kind && authors.includes(event.pubkey.toLowerCase()) && verifyEvent(event);
}

export async function fetchFollowingSnapshot(
  pubkey: string,
  readRelays: string[],
  mockEvents?: NostrEvent[],
): Promise<{ event: NostrEvent; followedPubkeys: string[] }> {
  const normalized = pubkey.toLowerCase();
  const relays = uniqueRelays(readRelays);
  const events = mockEvents
    ? mockEvents.filter((event) => event.kind === 3 && event.pubkey.toLowerCase() === normalized)
    : await lastValueFrom(
        relayPool.request(relays, { kinds: [3], authors: [normalized], limit: 1 }, { timeout: 5_000, reconnect: 1 }).pipe(toArray()),
        { defaultValue: [] },
      ) as NostrEvent[];
  const valid = events.filter((candidate) => isValidRelayEvent(candidate, 3, [normalized]));
  const event = latestReplaceable(valid);
  if (!event) throw new Error("No valid following list was returned by the read relays.");
  valid.forEach((candidate) => eventStore.add(candidate));
  return { event, followedPubkeys: followedPubkeys(event.tags.filter(([name]) => name === "p").map(([, value]) => ({ pubkey: value }))) ?? [] };
}

export async function fetchProfilesInBatches(
  pubkeys: string[],
  readRelays: string[],
  onProgress: (progress: ProfileBatchProgress) => void = () => undefined,
  mockEvents?: NostrEvent[],
  batchSize = PROFILE_BATCH_SIZE,
): Promise<ProfileBatchResult> {
  const authors = [...new Set(pubkeys.filter((pubkey) => /^[0-9a-f]{64}$/i.test(pubkey)).map((pubkey) => pubkey.toLowerCase()))];
  const batches = Array.from({ length: Math.ceil(authors.length / batchSize) }, (_, index) => authors.slice(index * batchSize, (index + 1) * batchSize));
  const relays = uniqueRelays(readRelays);
  let completed = 0;
  let failed = 0;
  let profiles = 0;
  onProgress({ completed, total: batches.length, profiles });
  for (const batch of batches) {
    try {
      const events = mockEvents
        ? mockEvents.filter((event) => event.kind === 0 && batch.includes(event.pubkey.toLowerCase()))
        : await lastValueFrom(
            relayPool.request(relays, { kinds: [0], authors: batch, limit: batch.length }, { timeout: 5_000, reconnect: 1 }).pipe(toArray()),
            { defaultValue: [] },
          ) as NostrEvent[];
      const valid = events.filter((event) => isValidRelayEvent(event, 0, batch));
      valid.forEach((event) => eventStore.add(event));
      profiles += new Set(valid.map((event) => event.pubkey.toLowerCase())).size;
    } catch {
      failed += 1;
    }
    completed += 1;
    onProgress({ completed, total: batches.length, profiles });
  }
  return { completed, total: batches.length, profiles, failed };
}

export function addLocalEvent(event: NostrEvent): void {
  eventStore.add(event);
}

export async function fetchProfileServiceEvents(pubkey: string, readRelays: string[]): Promise<NostrEvent[]> {
  const events = await lastValueFrom(
    relayPool.request(readRelays, [
      { kinds: [0], authors: [pubkey], limit: 1 },
      { kinds: [10002], authors: [pubkey], limit: 1 },
      { kinds: [10063], authors: [pubkey], limit: 1 },
    ], { timeout: 5_000, reconnect: 1 }).pipe(toArray()),
    { defaultValue: [] },
  );
  events.forEach((event) => eventStore.add(event));
  return events as NostrEvent[];
}

export function ensureProfile(pubkey: string, readRelays: string[]): void {
  if (typeof window !== "undefined" && window.__CANOPY_MOCK__) return;
  const relays = uniqueRelays(readRelays);
  if (!relays.length) return;
  if (requestedProfiles.has(pubkey)) return;
  requestedProfiles.add(pubkey);
  relayPool
    .request(relays, { kinds: [0], authors: [pubkey], limit: 1 }, { timeout: 5_000, reconnect: 1 })
    .pipe(mapEventsToStore(eventStore))
    .subscribe({ error: () => undefined });
}

export function getReferencedEvent(pointer: EventPointer | AddressPointer): NostrEvent | undefined {
  return eventStore.getEvent(pointer) as NostrEvent | undefined;
}

export function subscribeReferencedEvent(
  pointer: EventPointer | AddressPointer,
  readRelays: string[],
  onEvent: (event: NostrEvent | undefined) => void,
  connectRelays = true,
): Subscription {
  const subscription = new Subscription();
  const model = eventStore.event(pointer).subscribe((event) => onEvent(event as NostrEvent | undefined));
  subscription.add(model);
  const relays = uniqueRelays([...(pointer.relays ?? []), ...readRelays]);
  if (connectRelays && relays.length) {
    const filter = "id" in pointer
      ? { ids: [pointer.id], limit: 1 }
      : { kinds: [pointer.kind], authors: [pointer.pubkey], "#d": [pointer.identifier], limit: 1 };
    const network = relayPool.request(relays, filter, { timeout: 5_000, reconnect: 1 })
      .pipe(onlyEvents(), mapEventsToStore(eventStore))
      .subscribe({ next: (event) => ensureProfile(event.pubkey, relays), error: () => undefined });
    subscription.add(network);
  }
  return subscription;
}

export function subscribeThread(rootId: string, readRelays: string[], onEvents: (events: NostrEvent[]) => void, connectRelays = true): Subscription {
  const subscription = new Subscription();
  const model = eventStore.model(ThreadModel, rootId).subscribe((thread: Thread) => {
    onEvents(newestUnique([...thread.all.values()].map(({ event }) => event as NostrEvent), 100).reverse());
  });
  const network = connectRelays
    ? relayPool
        .subscription(readRelays, [{ ids: [rootId] }, { kinds: [1], "#e": [rootId], limit: 100 }], { reconnect: Infinity, resubscribe: true })
        .pipe(onlyEvents(), mapEventsToStore(eventStore))
        .subscribe({ next: (event) => ensureProfile(event.pubkey, readRelays), error: () => undefined })
    : undefined;
  subscription.add(model);
  if (network) subscription.add(network);
  return subscription;
}

export function seedDemoEvents(events: NostrEvent[]): void {
  events.forEach((event) => eventStore.add(event));
}

