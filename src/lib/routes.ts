import * as nip19 from "nostr-tools/nip19";
import { uniqueRelays } from "./relays";
import type { ThreadNavigationTarget } from "./threading";

export type SavedView = "bookmarks" | "highlights" | "lookmarks";

export type CanopyRoute =
  | { kind: "root" }
  | { kind: "feed" }
  | { kind: "search" }
  | { kind: "activity" }
  | { kind: "saved"; view: SavedView }
  | { kind: "profile"; pubkey: string; npub: string }
  | { kind: "event"; eventId: string; nevent: string; target: ThreadNavigationTarget }
  | { kind: "not-found"; pathname: string; reason: string };

const STATIC_ROUTES = new Map<string, CanopyRoute>([
  ["/", { kind: "root" }],
  ["/feed", { kind: "feed" }],
  ["/search", { kind: "search" }],
  ["/activity", { kind: "activity" }],
  ["/saved/bookmarks", { kind: "saved", view: "bookmarks" }],
  ["/saved/highlights", { kind: "saved", view: "highlights" }],
  ["/saved/lookmarks", { kind: "saved", view: "lookmarks" }],
]);

function invalid(pathname: string, reason: string): CanopyRoute {
  return { kind: "not-found", pathname, reason };
}

export function profileRoute(pubkey: string): CanopyRoute {
  if (!/^[0-9a-f]{64}$/i.test(pubkey)) return invalid("", "The profile public key is malformed.");
  const normalized = pubkey.toLowerCase();
  return { kind: "profile", pubkey: normalized, npub: nip19.npubEncode(normalized) };
}

export function eventRoute(
  eventId: string,
  relayHints: string[] = [],
  details: { author?: string; kind?: number; target?: ThreadNavigationTarget } = {},
): CanopyRoute {
  if (!/^[0-9a-f]{64}$/i.test(eventId)) return invalid("", "The event identifier is malformed.");
  const id = eventId.toLowerCase();
  const relays = uniqueRelays(relayHints).slice(0, 4);
  const author = details.author && /^[0-9a-f]{64}$/i.test(details.author) ? details.author.toLowerCase() : undefined;
  const nevent = nip19.neventEncode({ id, relays, author, kind: details.kind });
  return {
    kind: "event",
    eventId: id,
    nevent,
    target: details.target ?? { rootId: id, focusId: id, relayHints: relays },
  };
}

export function parseRoute(pathname: string): CanopyRoute {
  const path = pathname || "/";
  const staticRoute = STATIC_ROUTES.get(path);
  if (staticRoute) return staticRoute;

  const segments = path.split("/").filter(Boolean);
  if (segments.length === 2 && segments[0] === "profile") {
    try {
      const decoded = nip19.decode(decodeURIComponent(segments[1]));
      if (decoded.type !== "npub") return invalid(path, "Profile links must contain a canonical npub.");
      const route = profileRoute(decoded.data);
      if (route.kind !== "profile" || route.npub !== segments[1].toLowerCase()) return invalid(path, "The profile npub is not canonical.");
      return route;
    } catch {
      return invalid(path, "The profile npub is malformed.");
    }
  }

  if (segments.length === 2 && segments[0] === "event") {
    try {
      const decoded = nip19.decode(decodeURIComponent(segments[1]));
      if (decoded.type !== "nevent") return invalid(path, "Event links must contain a canonical nevent.");
      const route = eventRoute(decoded.data.id, decoded.data.relays, { author: decoded.data.author, kind: decoded.data.kind });
      if (route.kind !== "event" || route.nevent !== segments[1].toLowerCase()) return invalid(path, "The event nevent is not canonical.");
      return route;
    } catch {
      return invalid(path, "The event nevent is malformed.");
    }
  }

  return invalid(path, "Canopy does not recognise this address.");
}

export function formatRoute(route: CanopyRoute): string {
  switch (route.kind) {
    case "root": return "/";
    case "feed": return "/feed";
    case "search": return "/search";
    case "activity": return "/activity";
    case "saved": return `/saved/${route.view}`;
    case "profile": return `/profile/${route.npub}`;
    case "event": return `/event/${route.nevent}`;
    case "not-found": return route.pathname || "/not-found";
  }
}

export function canonicalRoute(route: CanopyRoute): CanopyRoute {
  return route.kind === "root" ? { kind: "feed" } : route;
}

export function routeUrl(origin: string, route: CanopyRoute): string {
  return new URL(formatRoute(route), origin).href;
}

export function profileUrl(origin: string, pubkey: string): string {
  return routeUrl(origin, profileRoute(pubkey));
}

export function eventUrl(origin: string, eventId: string, relayHints: string[] = [], details: { author?: string; kind?: number } = {}): string {
  return routeUrl(origin, eventRoute(eventId, relayHints, details));
}
