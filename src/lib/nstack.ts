import { settingsChanges$ } from "./settings-state";
import { nip19 } from "nostr-tools";
import type { NStackProvider } from "../types";

export interface NStackSummary {
  id: string;
  name: string;
  status?: string;
  description?: string;
}

export interface NStackDestination {
  serverUrl: string;
  workspaceId: string;
  workspaceName: string;
  workspaceOwnerNpub: string;
  workspaceServiceNpub: string;
  serviceNpub?: string;
}

export interface NStackWorkspaceSummary {
  id: string;
  stackId: string;
  name: string;
  description?: string;
  destination: NStackDestination;
}

export interface NStackInventory {
  stacks: NStackSummary[];
  workspaces: NStackWorkspaceSummary[];
}

type UnknownRecord = Record<string, unknown>;

const PROVIDER_READY_EVENTS = ["nstackready", "nstack:ready", "nstack-ready"] as const;

function record(value: unknown): UnknownRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : undefined;
}

function safeText(value: unknown, max = 160): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text && text.length <= max && !/[\u0000-\u001f\u007f]/.test(text) ? text : undefined;
}

function identifier(source: UnknownRecord, names: string[]): string | undefined {
  for (const name of names) {
    const value = safeText(source[name], 256);
    if (value) return value;
  }
  return undefined;
}

function collection(value: unknown, names: string[]): unknown[] {
  if (Array.isArray(value)) return value;
  const source = record(value);
  if (!source) return [];
  for (const name of names) if (Array.isArray(source[name])) return source[name] as unknown[];
  return [];
}

function canonicalHttpsUrl(value: unknown): string | undefined {
  const text = safeText(value, 2_048);
  if (!text) return undefined;
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return undefined;
    url.pathname = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
    return url.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

function safeNpub(value: unknown): string | undefined {
  const text = safeText(value, 96);
  if (!text) return undefined;
  try {
    return nip19.decode(text).type === "npub" ? text : undefined;
  } catch {
    return undefined;
  }
}

function parseDestination(value: unknown, workspaceName: string): NStackDestination | undefined {
  const source = record(value);
  if (!source) return undefined;
  const serverUrl = canonicalHttpsUrl(source.directHttpsUrl);
  const workspaceId = safeText(source.workspaceId, 128);
  const workspaceOwnerNpub = safeNpub(source.workspaceOwnerNpub);
  const workspaceServiceNpub = safeNpub(source.workspaceServiceNpub);
  const serviceNpub = source.serviceNpub === undefined ? undefined : safeNpub(source.serviceNpub);
  if (!serverUrl || !workspaceId || !workspaceOwnerNpub || !workspaceServiceNpub || (source.serviceNpub !== undefined && !serviceNpub)) return undefined;
  return {
    serverUrl,
    workspaceId,
    workspaceName,
    workspaceOwnerNpub,
    workspaceServiceNpub,
    ...(serviceNpub ? { serviceNpub } : {}),
  };
}

export function parseStoredNStackDestination(value: unknown): NStackDestination | undefined {
  const source = record(value);
  if (!source) return undefined;
  return parseDestination({
    directHttpsUrl: source.serverUrl,
    workspaceId: source.workspaceId,
    workspaceOwnerNpub: source.workspaceOwnerNpub,
    workspaceServiceNpub: source.workspaceServiceNpub,
    ...(source.serviceNpub === undefined ? {} : { serviceNpub: source.serviceNpub }),
  }, safeText(source.workspaceName, 120) || "Workspace");
}

export function nstackAvailable(value: unknown): boolean {
  if (value === true) return true;
  const source = record(value);
  return source?.available === true || Boolean(safeText(source?.version, 40));
}

export function parseNStacks(value: unknown): NStackSummary[] {
  const seen = new Set<string>();
  return collection(value, ["stacks", "nstacks", "items"]).flatMap((item) => {
    const source = record(item);
    if (!source) return [];
    const id = identifier(source, ["id"]);
    if (!id || seen.has(id)) return [];
    seen.add(id);
    return [{
      id,
      name: safeText(source.name, 120) || "NStack",
      status: safeText(source.status, 60),
      description: safeText(source.description, 240),
    }];
  });
}

export function parseNStackWorkspaces(value: unknown, stackId: string): NStackWorkspaceSummary[] {
  const seen = new Set<string>();
  return collection(value, ["workspaces", "items"]).flatMap((item) => {
    const source = record(item);
    if (!source) return [];
    const id = identifier(source, ["id"]);
    const name = safeText(source.name, 120) || "Workspace";
    const destination = parseDestination(source, name);
    if (!id || !destination || seen.has(id)) return [];
    seen.add(id);
    return [{ id, stackId, name, description: safeText(source.description, 240), destination }];
  });
}

export function getNStackProvider(): NStackProvider | undefined {
  const provider = window.NStack;
  if (!provider || typeof provider.isAvailable !== "function" || typeof provider.requestDiscovery !== "function" || typeof provider.listNStacks !== "function" || typeof provider.listWorkspaces !== "function" || typeof provider.getConnection !== "function" || typeof provider.on !== "function") return undefined;
  return provider;
}

export function waitForNStackProvider({ timeoutMs = 3_000, intervalMs = 100 }: { timeoutMs?: number; intervalMs?: number } = {}): Promise<NStackProvider | undefined> {
  const ready = getNStackProvider();
  if ((ready && !ready.ready) || timeoutMs <= 0) return Promise.resolve(ready);
  return new Promise((resolve) => {
    let settled = false;
    let observedReady: Promise<unknown> | undefined;
    const finish = (provider?: NStackProvider) => {
      if (settled) return;
      settled = true;
      clearInterval(interval);
      clearTimeout(timeout);
      for (const name of PROVIDER_READY_EVENTS) window.removeEventListener?.(name, check);
      resolve(provider);
    };
    const check = () => {
      const provider = getNStackProvider();
      const providerReady = provider?.ready ?? window.NStackReady;
      if (provider && !providerReady) { finish(provider); return; }
      if (!providerReady || providerReady === observedReady) return;
      observedReady = providerReady;
      void Promise.resolve(providerReady).then(() => finish(getNStackProvider()), () => undefined);
    };
    const interval = window.setInterval(check, intervalMs);
    const timeout = window.setTimeout(() => finish(), timeoutMs);
    for (const name of PROVIDER_READY_EVENTS) window.addEventListener?.(name, check);
  });
}

export async function discoverNStackInventory(provider: NStackProvider): Promise<NStackInventory> {
  await provider.requestDiscovery({ workspaces: true });
  const stacks = parseNStacks(await provider.listNStacks());
  const workspaces = (await Promise.all(stacks.map(async (stack) =>
    parseNStackWorkspaces(await provider.listWorkspaces({ stackId: stack.id }), stack.id)
  ))).flat();
  return { stacks, workspaces };
}

export async function resolveNStackDestination(provider: NStackProvider, workspace: NStackWorkspaceSummary): Promise<NStackDestination> {
  const value = await provider.getConnection({ stackId: workspace.stackId, workspaceId: workspace.id });
  const parsed = parseNStackWorkspaces([value], workspace.stackId).find(({ id }) => id === workspace.id);
  if (!parsed) throw new Error("NBrowser returned an unsafe or changed NStack workspace descriptor.");
  return parsed.destination;
}

const networkSettingsKey = (pubkey: string) => `canopy.networkSettings.${pubkey}`;
const legacySelectionKey = (pubkey: string) => `canopy.nstackSelection.${pubkey}`;

function storedNetworkSettings(pubkey: string): UnknownRecord {
  try {
    return record(JSON.parse(localStorage.getItem(networkSettingsKey(pubkey)) || "null")) ?? {};
  } catch {
    return {};
  }
}

export function loadNStackDestination(pubkey: string): NStackDestination | undefined {
  try {
    localStorage.removeItem(legacySelectionKey(pubkey));
    return parseStoredNStackDestination(storedNetworkSettings(pubkey).nstack);
  } catch {
    return undefined;
  }
}

export function saveNStackDestination(pubkey: string, destination: NStackDestination): void {
  const validated = parseStoredNStackDestination(destination);
  if (!validated) throw new Error("NBrowser returned an unsafe or incomplete NStack workspace descriptor.");
  localStorage.setItem(networkSettingsKey(pubkey), JSON.stringify({ ...storedNetworkSettings(pubkey), nstack: validated }));
  localStorage.removeItem(legacySelectionKey(pubkey));
  settingsChanges$.next(pubkey);
}

export function clearNStackDestination(pubkey: string): void {
  const value = storedNetworkSettings(pubkey);
  delete value.nstack;
  localStorage.removeItem(legacySelectionKey(pubkey));
  if (Object.keys(value).length) localStorage.setItem(networkSettingsKey(pubkey), JSON.stringify(value));
  else localStorage.removeItem(networkSettingsKey(pubkey));
  settingsChanges$.next(pubkey);
}
