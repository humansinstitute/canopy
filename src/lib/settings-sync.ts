import { nip19, verifyEvent } from "nostr-tools";
import type { NostrProvider } from "../types";
import type { NStackDestination } from "./nstack";
import { loadSavedSettings, parseSettingsInput } from "./settings";
import { loadNwcConnection, parseNwcConnection } from "./nwc";
import { validateZapPreferences } from "./zap-preferences";
import { mergeSettings, readSettingsState, settingNames, writeSettingsState, type SettingsState } from "./settings-state";

// Public release namespace, SHA-256("org.wingman.canopy.app-namespace.v1:1").
// Counter 1 is the first digest that lifts to a secp256k1 point; no secret exists in Canopy.
export const CANOPY_APP_NPUB = nip19.npubEncode("2b6ea3734328c87e8dcdb9c4b51902041ac8a403eb3c3b1710a61c50da68de50");
export const SETTINGS_COLLECTION = "settings-v1";
export class SettingsSyncError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
const fail = () => new SettingsSyncError("invalid_backup", "Backup could not be verified. Local settings are unchanged.");
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw fail();
  return value as Record<string, unknown>;
};

export function validateSettingsState(value: unknown, pubkey: string): SettingsState {
  const source = object(value);
  if (source.schema !== 1 || source.pubkey !== pubkey) throw fail();
  const fields = object(source.fields);
  const state: SettingsState = { schema: 1, pubkey, fields: {} };
  if (Object.keys(fields).some((name) => !settingNames.some((allowed) => allowed === name))) throw fail();
  for (const name of settingNames) {
    if (!(name in fields)) continue;
    const field = object(fields[name]);
    if (!Number.isSafeInteger(field.clock) || Number(field.clock) < 0 || Number(field.clock) > Number.MAX_SAFE_INTEGER - 1000 || typeof field.writer !== "string" || !/^[a-zA-Z0-9-]{1,64}$/.test(field.writer)) throw fail();
    let data = field.value;
    if (data !== null) {
      if (name === "nwc") { if (typeof data !== "string") throw fail(); parseNwcConnection(data); }
      if (name === "network") {
        const network = object(data);
        if (![network.read, network.write, network.blossom].every((item) => Array.isArray(item) && item.length <= 100 && item.every((entry) => typeof entry === "string" && entry.length <= 2048))) throw fail();
        const parsed = parseSettingsInput((network.read as string[]).join("\n"), (network.write as string[]).join("\n"), (network.blossom as string[]).join("\n"));
        data = { read: parsed.relays.read, write: parsed.relays.write, blossom: parsed.blossomServers };
      }
      if (name === "zap") { const zap = object(data); data = validateZapPreferences(zap.amount as number, zap.message as string); }
    }
    state.fields[name] = { clock: field.clock as number, writer: field.writer, value: data };
  }
  if (JSON.stringify(state).length > 24_000) throw fail();
  return state;
}

/** Legacy preferences have the lowest clock: a new device never replaces an existing backup with defaults. */
export function localSettingsSnapshot(pubkey: string): SettingsState {
  const state = validateSettingsState(readSettingsState(pubkey), pubkey);
  const legacy: Partial<Record<"network" | "nwc" | "zap", unknown>> = {};
  const network = loadSavedSettings(pubkey);
  if (network) legacy.network = { read: network.relays.read, write: network.relays.write, blossom: network.blossomServers };
  const nwc = loadNwcConnection(pubkey);
  if (nwc) legacy.nwc = nwc;
  const zap = localStorage.getItem(`canopy.zapPreferences.${pubkey}`);
  if (zap) { try { const parsed = JSON.parse(zap); legacy.zap = validateZapPreferences(parsed.amount, parsed.message); } catch { /* Ignore invalid legacy preferences. */ } }
  for (const name of settingNames) if (!state.fields[name] && legacy[name] !== undefined) state.fields[name] = { clock: 0, writer: "legacy", value: legacy[name] };
  return validateSettingsState(state, pubkey);
}

async function hash(text: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export type SettingsDecryptCache = Map<string, { ciphertext: string; state: SettingsState }>;

export class TowerSettingsStore {
  readonly rowsUrl: string;
  constructor(readonly destination: NStackDestination, readonly pubkey: string, readonly signer: NostrProvider, readonly active: () => boolean = () => true, readonly cache: SettingsDecryptCache = new Map()) {
    this.rowsUrl = `${destination.serverUrl}/api/v4/flightdeck-pg/workspaces/${encodeURIComponent(destination.workspaceId)}/apps/${CANOPY_APP_NPUB}/db/${SETTINGS_COLLECTION}/rows`;
  }
  async assertActive(): Promise<void> {
    if (!this.active() || (await this.signer.getPublicKey()).toLowerCase() !== this.pubkey || !this.active()) throw new SettingsSyncError("account_changed", "Account or NStack changed. Reconnect to sync settings.");
  }
  async request(method: string, url: string, payload?: unknown): Promise<Record<string, unknown>> {
    await this.assertActive();
    const body = payload === undefined ? undefined : JSON.stringify(payload);
    const tags = [["u", url], ["method", method], ...(body ? [["payload", await hash(body)]] : [])];
    const template = { kind: 27235, created_at: Math.floor(Date.now() / 1000), tags, content: "" };
    const signed = await this.signer.signEvent(template);
    if (signed.pubkey !== this.pubkey || signed.kind !== template.kind || signed.created_at !== template.created_at || signed.content !== "" || JSON.stringify(signed.tags) !== JSON.stringify(tags) || !verifyEvent(signed)) throw new SettingsSyncError("signer_denied", "The signer did not approve settings storage.");
    await this.assertActive();
    let response: Response;
    try {
      response = await fetch(url, { method, body, headers: { Authorization: `Nostr ${btoa(JSON.stringify(signed))}`, ...(body ? { "Content-Type": "application/json" } : {}) }, credentials: "omit", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000) });
    } catch { throw new SettingsSyncError("storage_unavailable", "NStack storage is unavailable. Settings remain local and unsynced."); }
    await this.assertActive();
    const text = await response.text();
    if (text.length > 4_000_000) throw fail();
    let result: Record<string, unknown>;
    try { result = object(JSON.parse(text)); } catch { throw fail(); }
    if (!response.ok) {
      const code = typeof result.error === "object" && result.error ? (result.error as Record<string, unknown>).code : result.code ?? result.error;
      if (code === "app_not_found" || code === "app_disabled") throw new SettingsSyncError("namespace_required", "A workspace manager must enable Canopy settings backup in this NStack.");
      throw new SettingsSyncError("storage_denied", "NStack did not approve settings storage. Settings remain local and unsynced.");
    }
    return result;
  }
  binding(response: Record<string, unknown>): void {
    if (response.workspace_id !== this.destination.workspaceId || response.workspace_owner_npub !== this.destination.workspaceOwnerNpub || response.app_npub !== CANOPY_APP_NPUB || response.collection !== SETTINGS_COLLECTION) throw fail();
  }
  validateRow(value: unknown): Record<string, unknown> {
    const row = object(value);
    if (row.owner_npub !== nip19.npubEncode(this.pubkey) || row.visibility !== "private" || row.app_npub !== CANOPY_APP_NPUB || row.collection !== SETTINGS_COLLECTION || row.workspace_owner_npub !== this.destination.workspaceOwnerNpub || typeof row.row_id !== "string" || !/^snapshot-[a-f0-9-]{36}$/.test(row.row_id)) throw fail();
    const data = object(row.data);
    if (Object.keys(data).some((key) => !["schema", "ciphertext"].includes(key)) || data.schema !== 1 || typeof data.ciphertext !== "string" || data.ciphertext.length > 64_000 || !data.ciphertext) throw fail();
    return row;
  }
  async read(): Promise<SettingsState> {
    if (!this.signer.nip44) throw new SettingsSyncError("crypto_unavailable", "Your signer must support NIP-44 to back up settings. Settings remain local and unsynced.");
    let merged: SettingsState = { schema: 1, pubkey: this.pubkey, fields: {} };
    const seen = new Set<string>();
    for (let offset = 0; offset < 1000; offset += 50) {
      const query = new URLSearchParams({ limit: "50", offset: String(offset), owner_npub: nip19.npubEncode(this.pubkey), visibility: "private" });
      const result = await this.request("GET", `${this.rowsUrl}?${query}`);
      this.binding(result);
      if (!Array.isArray(result.rows) || result.rows.length > 50) throw fail();
      for (const value of result.rows) {
        const row = this.validateRow(value);
        if (seen.has(row.row_id as string)) continue;
        seen.add(row.row_id as string);
        await this.assertActive();
        const ciphertext = object(row.data).ciphertext as string;
        const cached = this.cache.get(row.row_id as string);
        if (cached && cached.ciphertext !== ciphertext) throw fail();
        let state: SettingsState;
        try {
          const plaintext = cached ? undefined : await this.signer.nip44.decrypt(this.pubkey, ciphertext);
          if (plaintext && plaintext.length > 24_000) throw fail();
          state = cached?.state ?? validateSettingsState(JSON.parse(plaintext!), this.pubkey);
        } catch { throw fail(); }
        await this.assertActive();
        this.cache.set(row.row_id as string, { ciphertext, state });
        merged = mergeSettings(merged, state);
      }
      if (result.rows.length < 50) return merged;
    }
    throw new SettingsSyncError("backup_limit", "Canopy backup history needs maintenance. Local settings are safe; sync is paused.");
  }
  async append(state: SettingsState): Promise<void> {
    await this.assertActive();
    if (!this.signer.nip44) throw fail();
    const plaintext = JSON.stringify(validateSettingsState(state, this.pubkey));
    let ciphertext: string;
    try { ciphertext = await this.signer.nip44.encrypt(this.pubkey, plaintext); }
    catch { throw new SettingsSyncError("crypto_denied", "NIP-44 encryption was not approved. Settings remain local and unsynced."); }
    if (!ciphertext || ciphertext === plaintext || ciphertext.includes("nostr+walletconnect:") || ciphertext.length > 64_000) throw fail();
    await this.assertActive();
    const rowId = `snapshot-${crypto.randomUUID()}`;
    const result = await this.request("POST", this.rowsUrl, { row_id: rowId, visibility: "private", data: { schema: 1, ciphertext } });
    this.binding(result);
    const row = this.validateRow(result.row);
    if (row.row_id !== rowId || object(row.data).ciphertext !== ciphertext) throw fail();
    this.cache.set(rowId, { ciphertext, state });
  }
  async enable(): Promise<void> {
    await this.request("POST", `${this.destination.serverUrl}/api/v4/workspaces/${encodeURIComponent(this.destination.workspaceOwnerNpub)}/apps`, { app_npub: CANOPY_APP_NPUB, app_name: "Canopy", enabled: true, capabilities: ["storage.private", "app_rows.private_only"] });
  }
}

/** Read before write; immutable rows avoid the app-row PATCH API's lack of compare-and-swap. */
export async function syncSettings(store: TowerSettingsStore, restored: () => void, completed: (state: SettingsState) => void = () => undefined): Promise<boolean> {
  const remote = await store.read();
  await store.assertActive();
  const local = localSettingsSnapshot(store.pubkey); // Include changes made while requests were pending.
  // A pre-sync legacy preference has no edit history; existing remote data takes precedence.
  const candidate = { ...local, fields: { ...local.fields } };
  for (const name of settingNames) if (candidate.fields[name]?.clock === 0 && remote.fields[name]) delete candidate.fields[name];
  const merged = mergeSettings(candidate, remote);
  if (JSON.stringify(local) !== JSON.stringify(merged)) {
    writeSettingsState(merged);
    // Clear obsolete wallet copies after a restored removal; the atomic record stays authoritative.
    if (merged.fields.nwc?.value === null) localStorage.removeItem(`canopy.nwc.${store.pubkey}`);
    restored();
  }
  if (JSON.stringify(merged) !== JSON.stringify(remote) && Object.keys(merged.fields).length) await store.append(merged);
  await store.assertActive();
  // An edit during encryption/upload is deliberately left pending for the next pass.
  if (JSON.stringify(localSettingsSnapshot(store.pubkey)) !== JSON.stringify(merged)) throw new SettingsSyncError("pending", "New settings are waiting to sync.");
  completed(merged);
  return Object.keys(merged.fields).length > 0;
}
