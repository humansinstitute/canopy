import * as nip19 from "nostr-tools/nip19";
import type { NostrEvent } from "../types";
import { compactPubkey } from "./content";

export const LOCAL_POST_LIMIT = 21_256;
export const MAX_INDEXED_POST_CHARS = 10_000;

export interface LocalPerson {
  pubkey: string;
  npub: string;
  name: string;
  username: string;
  searchText: string;
  lastSeen: number;
}

export interface LocalPost {
  id: string;
  pubkey: string;
  createdAt: number;
  content: string;
  searchText: string;
}

type StoredPost = Omit<LocalPost, "searchText">;

export interface LocalSearchResults {
  people: LocalPerson[];
  posts: LocalPost[];
}

export interface LocalIndexStats {
  people: number;
  posts: number;
  estimatedIndexBytes: number;
  siteUsageBytes?: number;
  siteQuotaBytes?: number;
}

const DB_NAME = "canopy-local-search";
const DB_VERSION = 1;
const HEX_PUBKEY = /^[0-9a-f]{64}$/i;
const PROFILE_REFERENCE = /\b(?:nostr:)?(?:npub1|nprofile1)[023456789acdefghjklmnpqrstuvwxyz]+/gi;
const listeners = new Set<() => void>();
const pendingEvents = new Map<string, NostrEvent>();
let flushTimer: number | undefined;
let writeChain = Promise.resolve();
let databasePromise: Promise<IDBDatabase> | undefined;
let cachesPromise: Promise<{ people: Map<string, LocalPerson>; posts: Map<string, LocalPost> }> | undefined;

export function normalizeSearchText(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

function validPubkeys(event: NostrEvent): string[] {
  const references: string[] = [];
  for (const match of event.content.slice(0, MAX_INDEXED_POST_CHARS).matchAll(PROFILE_REFERENCE)) {
    try {
      const decoded = nip19.decode(match[0].replace(/^nostr:/i, "").toLowerCase());
      if (decoded.type === "npub") references.push(decoded.data);
      if (decoded.type === "nprofile") references.push(decoded.data.pubkey);
    } catch {
      // Invalid identifiers stay ordinary post text.
    }
    if (references.length >= 128) break;
  }
  const pubkeys = [event.pubkey, ...event.tags.filter(([name]) => name === "p").map(([, value]) => value), ...references]
    .filter((value): value is string => typeof value === "string" && HEX_PUBKEY.test(value))
    .map((value) => value.toLowerCase());
  return [...new Set(pubkeys)];
}

function profileNames(event: NostrEvent): { name: string; username: string } | undefined {
  if (event.kind !== 0) return undefined;
  try {
    const profile = JSON.parse(event.content) as Record<string, unknown>;
    const name = [profile.display_name, profile.displayName, profile.name].find((value) => typeof value === "string" && value.trim());
    const username = typeof profile.name === "string" ? profile.name.trim().slice(0, 80) : "";
    return { name: typeof name === "string" ? name.trim().slice(0, 80) : "", username };
  } catch {
    return undefined;
  }
}

export function recordsFromEvent(event: NostrEvent, existing = new Map<string, LocalPerson>()): { people: LocalPerson[]; post?: LocalPost } {
  const metadata = profileNames(event);
  const people = validPubkeys(event).map((pubkey) => {
    const previous = existing.get(pubkey);
    const npub = previous?.npub ?? nip19.npubEncode(pubkey);
    const ownMetadata = pubkey === event.pubkey ? metadata : undefined;
    const name = ownMetadata?.name || previous?.name || "";
    const username = ownMetadata?.username || previous?.username || "";
    return {
      pubkey,
      npub,
      name,
      username,
      searchText: normalizeSearchText(`${name} ${username} ${npub} ${pubkey}`),
      lastSeen: Math.max(previous?.lastSeen ?? 0, event.created_at),
    };
  });
  const content = event.kind === 1 ? event.content.slice(0, MAX_INDEXED_POST_CHARS) : undefined;
  return {
    people,
    post: content === undefined ? undefined : { id: event.id, pubkey: event.pubkey, createdAt: event.created_at, content, searchText: normalizeSearchText(content) },
  };
}

export function mergeLocalIdentity(pubkey: string, previous?: LocalPerson, seenAt = Math.floor(Date.now() / 1000)): LocalPerson {
  if (!HEX_PUBKEY.test(pubkey)) throw new Error("Cannot cache an invalid Nostr public key.");
  const normalized = pubkey.toLowerCase();
  const npub = previous?.npub ?? nip19.npubEncode(normalized);
  const name = previous?.name || compactPubkey(normalized);
  const username = previous?.username ?? "";
  return {
    pubkey: normalized,
    npub,
    name,
    username,
    searchText: normalizeSearchText(`${name} ${username} ${npub} ${normalized}`),
    lastSeen: Math.max(previous?.lastSeen ?? 0, seenAt),
  };
}

export function searchRecords(people: Iterable<LocalPerson>, posts: Iterable<LocalPost>, rawQuery: string, peopleLimit = 12, postLimit = 24): LocalSearchResults {
  const query = normalizeSearchText(rawQuery);
  const terms = query.split(" ").filter(Boolean);
  const matches = (value: string) => terms.every((term) => value.includes(term));
  const peopleResults = [...people]
    .filter((person) => !query || matches(person.searchText))
    .sort((left, right) => {
      const leftName = normalizeSearchText(left.name || left.username);
      const rightName = normalizeSearchText(right.name || right.username);
      const leftScore = query && leftName.startsWith(query) ? 1 : 0;
      const rightScore = query && rightName.startsWith(query) ? 1 : 0;
      return rightScore - leftScore || right.lastSeen - left.lastSeen || left.npub.localeCompare(right.npub);
    })
    .slice(0, peopleLimit);
  const postResults = query
    ? [...posts].filter((post) => matches(post.searchText)).sort((left, right) => right.createdAt - left.createdAt).slice(0, postLimit)
    : [];
  return { people: peopleResults, posts: postResults };
}

export function estimateIndexBytes(people: Iterable<LocalPerson>, posts: Iterable<LocalPost>): number {
  let bytes = 0;
  for (const person of people) bytes += 320 + 2 * (person.name.length + person.username.length + person.searchText.length);
  for (const post of posts) bytes += 360 + 2 * post.content.length;
  return bytes;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction was aborted."));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  if (!databasePromise) databasePromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("Local search is unavailable in this browser.")); return; }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("people")) database.createObjectStore("people", { keyPath: "pubkey" });
      if (!database.objectStoreNames.contains("posts")) {
        const posts = database.createObjectStore("posts", { keyPath: "id" });
        posts.createIndex("createdAt", "createdAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Local search could not open its browser database."));
  });
  return databasePromise;
}

async function loadCaches(): Promise<{ people: Map<string, LocalPerson>; posts: Map<string, LocalPost> }> {
  if (!cachesPromise) cachesPromise = (async () => {
    const database = await openDatabase();
    const transaction = database.transaction(["people", "posts"], "readonly");
    const [people, posts] = await Promise.all([
      requestResult(transaction.objectStore("people").getAll() as IDBRequest<LocalPerson[]>),
      requestResult(transaction.objectStore("posts").getAll() as IDBRequest<StoredPost[]>),
    ]);
    await transactionDone(transaction);
    return {
      people: new Map(people.map((person) => [person.pubkey, person])),
      posts: new Map(posts.map((post) => [post.id, { ...post, searchText: normalizeSearchText(post.content) }])),
    };
  })();
  return cachesPromise;
}

async function writeEvents(events: NostrEvent[]): Promise<void> {
  const caches = await loadCaches();
  const database = await openDatabase();
  const transaction = database.transaction(["people", "posts"], "readwrite");
  const peopleStore = transaction.objectStore("people");
  const postStore = transaction.objectStore("posts");
  for (const event of events) {
    const records = recordsFromEvent(event, caches.people);
    for (const person of records.people) { caches.people.set(person.pubkey, person); peopleStore.put(person); }
    if (records.post) {
      caches.posts.set(records.post.id, records.post);
      const storedPost: StoredPost = {
        id: records.post.id,
        pubkey: records.post.pubkey,
        createdAt: records.post.createdAt,
        content: records.post.content,
      };
      postStore.put(storedPost);
    }
  }
  if (caches.posts.size > LOCAL_POST_LIMIT) {
    const excess = [...caches.posts.values()].sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id)).slice(0, caches.posts.size - LOCAL_POST_LIMIT);
    for (const post of excess) { caches.posts.delete(post.id); postStore.delete(post.id); }
  }
  await transactionDone(transaction);
  listeners.forEach((listener) => listener());
}

export function indexSeenEvent(event: NostrEvent): void {
  pendingEvents.set(event.id, event);
  if (flushTimer !== undefined) return;
  flushTimer = window.setTimeout(() => {
    flushTimer = undefined;
    const events = [...pendingEvents.values()];
    pendingEvents.clear();
    writeChain = writeChain.then(() => writeEvents(events)).catch(() => undefined);
  }, 80);
}

export async function flushLocalIndex(): Promise<void> {
  if (flushTimer !== undefined) {
    window.clearTimeout(flushTimer);
    flushTimer = undefined;
    const events = [...pendingEvents.values()];
    pendingEvents.clear();
    writeChain = writeChain.then(() => writeEvents(events)).catch(() => undefined);
  }
  await writeChain;
}

export async function searchLocalIndex(query: string): Promise<LocalSearchResults> {
  await flushLocalIndex();
  const caches = await loadCaches();
  return searchRecords(caches.people.values(), caches.posts.values(), query);
}

export async function upsertLocalIdentity(pubkey: string, seenAt = Math.floor(Date.now() / 1000)): Promise<void> {
  await upsertLocalIdentities([pubkey], seenAt);
}

export async function upsertLocalIdentities(pubkeys: string[], seenAt = Math.floor(Date.now() / 1000)): Promise<void> {
  const caches = await loadCaches();
  const database = await openDatabase();
  const transaction = database.transaction("people", "readwrite");
  const store = transaction.objectStore("people");
  const people = [...new Set(pubkeys.map((pubkey) => pubkey.toLowerCase()))].map((pubkey) =>
    mergeLocalIdentity(pubkey, caches.people.get(pubkey), seenAt),
  );
  people.forEach((person) => store.put(person));
  await transactionDone(transaction);
  people.forEach((person) => caches.people.set(person.pubkey, person));
  listeners.forEach((listener) => listener());
}

export async function localIndexStats(): Promise<LocalIndexStats> {
  await flushLocalIndex();
  const caches = await loadCaches();
  const estimate = await navigator.storage?.estimate?.().catch(() => undefined);
  return {
    people: caches.people.size,
    posts: caches.posts.size,
    estimatedIndexBytes: estimateIndexBytes(caches.people.values(), caches.posts.values()),
    siteUsageBytes: estimate?.usage,
    siteQuotaBytes: estimate?.quota,
  };
}

export function onLocalIndexChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
