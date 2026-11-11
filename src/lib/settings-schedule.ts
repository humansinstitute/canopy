import type { NStackDestination } from "./nstack";
import { localSettingsSnapshot } from "./settings-sync";

export const SETTINGS_SYNC_INTERVAL = 24 * 60 * 60 * 1000;
export function syncCheckpointKey(pubkey: string, destination: NStackDestination): string {
  return `canopy.settingsSync.v1.${pubkey}.${encodeURIComponent(JSON.stringify([new URL(destination.serverUrl).href.replace(/\/+$/, ""), destination.workspaceId, destination.workspaceOwnerNpub, destination.workspaceServiceNpub]))}`;
}
export async function settingsFingerprint(pubkey: string, state = localSettingsSnapshot(pubkey)): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(state)));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}
export function syncIsDue(key: string, fingerprint: string, now = Date.now()): boolean {
  try {
    const checkpoint = JSON.parse(localStorage.getItem(key) || "null");
    return !checkpoint || checkpoint.fingerprint !== fingerprint || !Number.isFinite(checkpoint.successAt) || checkpoint.successAt > now || now - checkpoint.successAt >= SETTINGS_SYNC_INTERVAL;
  } catch { return true; }
}
