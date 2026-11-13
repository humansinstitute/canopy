import { normalizeProfileServer } from "./blossom-servers";
import { changeSetting, readSetting } from "./settings-state";
import type { NostrEvent } from "../types";
import { customRelayPlan, relayPlanFromProfile, type RelayPlan } from "./relays";
import { parseStoredNStackDestination } from "./nstack";

export interface NetworkSettings {
  relays: RelayPlan;
  blossomServers: string[];
}

function latest(events: NostrEvent[], kind: number): NostrEvent | undefined {
  return events.filter((event) => event.kind === kind).sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))[0];
}

export function normalizeBlossomServer(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password) return null;
    url.pathname = "/";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function blossomServersFromProfile(event: NostrEvent | undefined): string[] {
  if (!event || event.kind !== 10063) return [];
  return [...new Set(event.tags
    .filter(([name, value]) => name === "server" && Boolean(value))
    .map(([, value]) => { try { return normalizeProfileServer(value); } catch { return null; } })
    .filter((server): server is string => Boolean(server)))];
}

export function profileNetworkSettings(events: NostrEvent[], fallback: RelayPlan): NetworkSettings {
  return {
    relays: relayPlanFromProfile(latest(events, 10002), fallback),
    blossomServers: blossomServersFromProfile(latest(events, 10063)),
  };
}

export function parseSettingsInput(read: string, write: string, blossom: string): NetworkSettings {
  const relays = customRelayPlan(read.split(/\s+/), write.split(/\s+/));
  const requestedServers = blossom.split(/\s+/).filter(Boolean);
  const blossomServers = [...new Set(requestedServers.map(normalizeBlossomServer).filter((server): server is string => Boolean(server)))];
  if (requestedServers.length !== blossomServers.length) throw new Error("Blossom servers must be valid HTTPS URLs, one per line.");
  return { relays, blossomServers };
}

const storageKey = (pubkey: string) => `canopy.networkSettings.${pubkey}`;

export function loadSavedSettings(pubkey: string): NetworkSettings | undefined {
  try {
    const saved = readSetting(pubkey, "network");
    const value = (saved ? saved.value : JSON.parse(localStorage.getItem(storageKey(pubkey)) || "null")) as { read?: unknown; write?: unknown; blossom?: unknown } | null;
    if (!value || !Array.isArray(value.read) || !Array.isArray(value.write) || !Array.isArray(value.blossom)) return undefined;
    return parseSettingsInput(value.read.join("\n"), value.write.join("\n"), value.blossom.join("\n"));
  } catch {
    return undefined;
  }
}

export function saveSettings(pubkey: string, settings: NetworkSettings): void {
  changeSetting(pubkey, "network", { read: settings.relays.read, write: settings.relays.write, blossom: settings.blossomServers });
  let nstack: unknown;
  try {
    const current = JSON.parse(localStorage.getItem(storageKey(pubkey)) || "null") as { nstack?: unknown } | null;
    nstack = parseStoredNStackDestination(current?.nstack);
  } catch {/* Malformed settings are replaced. */}
  localStorage.setItem(storageKey(pubkey), JSON.stringify({ read: settings.relays.read, write: settings.relays.write, blossom: settings.blossomServers, ...(nstack === undefined ? {} : { nstack }) }));
}

export function clearSavedSettings(pubkey: string): void {
  changeSetting(pubkey, "network", null);
  try {
    const current = JSON.parse(localStorage.getItem(storageKey(pubkey)) || "null") as { nstack?: unknown } | null;
    const nstack = parseStoredNStackDestination(current?.nstack);
    if (nstack) {
      localStorage.setItem(storageKey(pubkey), JSON.stringify({ nstack }));
      return;
    }
  } catch {/* Malformed settings are removed. */}
  localStorage.removeItem(storageKey(pubkey));
}
