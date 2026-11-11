import type { NostrEvent, NostrProvider, RelayPermission } from "../types";

export const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.primal.net",
] as const;

export interface RelayPlan {
  read: string[];
  write: string[];
  source: "profile" | "custom" | "signer+defaults" | "defaults";
}

export function normalizeRelayUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "wss:" && url.protocol !== "ws:") return null;
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function uniqueRelays(values: string[]): string[] {
  return [...new Set(values.map(normalizeRelayUrl).filter((url): url is string => Boolean(url)))];
}

export function buildRelayPlan(relays: Record<string, RelayPermission> = {}): RelayPlan {
  const entries = Object.entries(relays);
  const read = entries.filter(([, p]) => p.read !== false).map(([url]) => url);
  const write = entries.filter(([, p]) => p.write !== false).map(([url]) => url);
  const hasHints = entries.length > 0;

  return {
    read: uniqueRelays([...read, ...DEFAULT_RELAYS]),
    write: uniqueRelays([...write, ...DEFAULT_RELAYS]),
    source: hasHints ? "signer+defaults" : "defaults",
  };
}

export function relayPlanFromProfile(event: NostrEvent | undefined, fallback: RelayPlan): RelayPlan {
  if (!event || event.kind !== 10002) return fallback;
  const read: string[] = [];
  const write: string[] = [];
  for (const [name, value, marker] of event.tags) {
    if (name !== "r" || !value) continue;
    if (marker !== "write") read.push(value);
    if (marker !== "read") write.push(value);
  }
  const normalizedRead = uniqueRelays(read);
  const normalizedWrite = uniqueRelays(write);
  if (!normalizedRead.length && !normalizedWrite.length) return fallback;
  return {
    read: normalizedRead.length ? normalizedRead : fallback.read,
    write: normalizedWrite.length ? normalizedWrite : fallback.write,
    source: "profile",
  };
}

export function customRelayPlan(read: string[], write: string[]): RelayPlan {
  const normalizedRead = uniqueRelays(read);
  const normalizedWrite = uniqueRelays(write);
  if (!normalizedRead.length || !normalizedWrite.length) throw new Error("Add at least one valid read relay and one valid write relay.");
  return { read: normalizedRead, write: normalizedWrite, source: "custom" };
}

export async function getRelayPlan(provider: NostrProvider): Promise<RelayPlan> {
  if (!provider.getRelays) return buildRelayPlan();
  try {
    return buildRelayPlan(await provider.getRelays());
  } catch {
    return buildRelayPlan();
  }
}

