import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { RelayPool } from "applesauce-relay";
import type { NostrEvent } from "../types";
import { BookmarkController, type BookmarkSnapshot } from "../lib/bookmarks";
import { addLocalEvent, subscribeBookmarkList } from "../lib/nostr";
import { getAccountProvider } from "../lib/session";

interface BookmarkContextValue extends BookmarkSnapshot {
  toggle(eventId: string, relayHint?: string): void;
}

const EMPTY: BookmarkSnapshot = { saved: new Set(), pending: new Set(), errors: new Map() };
const BookmarkContext = createContext<BookmarkContextValue>({ ...EMPTY, toggle: () => undefined });

export function BookmarkProvider({
  pubkey,
  readRelays,
  writeRelays,
  pool,
  mock,
  children,
}: {
  pubkey: string;
  readRelays: string[];
  writeRelays: string[];
  pool: Pick<RelayPool, "publish">;
  mock: boolean;
  children: ReactNode;
}) {
  const [snapshot, setSnapshot] = useState<BookmarkSnapshot>(EMPTY);
  const controller = useMemo(() => {
    const provider = getAccountProvider(pubkey);
    if (!provider) return undefined;
    return new BookmarkController(provider.signEvent.bind(provider), pool, writeRelays);
  }, [pubkey, pool, writeRelays]);

  useEffect(() => {
    if (!controller) return;
    return controller.subscribe((next) => {
      setSnapshot(next);
      if (next.event) addLocalEvent(next.event);
    });
  }, [controller]);

  useEffect(() => {
    if (!controller) return;
    const subscription = subscribeBookmarkList(pubkey, readRelays, (event) => controller.setRemote(event), !mock);
    return () => subscription.unsubscribe();
  }, [controller, pubkey, readRelays, mock]);

  const value = useMemo<BookmarkContextValue>(() => ({
    ...snapshot,
    toggle: (eventId, relayHint) => { void controller?.toggle(eventId, relayHint); },
  }), [snapshot, controller]);
  return <BookmarkContext.Provider value={value}>{children}</BookmarkContext.Provider>;
}

export function useBookmarks(): BookmarkContextValue {
  return useContext(BookmarkContext);
}
