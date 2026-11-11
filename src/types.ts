import type { EventTemplate, NostrEvent } from "nostr-tools";

export type { NostrEvent };

export interface RelayPermission {
  read?: boolean;
  write?: boolean;
}

export interface NostrProvider {
  getPublicKey(): Promise<string>;
  signEvent(event: EventTemplate): Promise<NostrEvent>;
  nip44?: { encrypt(pubkey: string, plaintext: string): Promise<string>; decrypt(pubkey: string, ciphertext: string): Promise<string> };
  getRelays?(): Promise<Record<string, RelayPermission>>;
}

export interface WebLNProvider {
  enable(): Promise<void>;
  sendPayment(invoice: string): Promise<unknown>;
}

export interface NStackProvider {
  version?: unknown;
  ready?: Promise<unknown>;
  isAvailable(): unknown | Promise<unknown>;
  requestDiscovery(options: { workspaces: boolean }): Promise<unknown>;
  listNStacks(): Promise<unknown>;
  listWorkspaces(options: { stackId: string }): Promise<unknown>;
  getConnection(options: { stackId: string; workspaceId: string }): Promise<unknown>;
  on(event: "change", handler: () => void): void | (() => void);
  off?(event: "change", handler: () => void): void;
}

declare global {
  interface Window {
    nostr?: NostrProvider;
    __CANOPY_MOCK__?: boolean;
    __CANOPY_EVENTS__?: NostrEvent[];
    __CANOPY_MOCK_PUBLISH_DELAY__?: number;
    __CANOPY_MOCK_PUBLISH_FAILURE__?: boolean;
    __CANOPY_MOCK_CACHE_DELAY__?: number;
    webln?: WebLNProvider;
    NStack?: NStackProvider;
    NStackReady?: Promise<NStackProvider>;
  }
}

