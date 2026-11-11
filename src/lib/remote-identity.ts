import * as nip19 from "nostr-tools/nip19";
import type { NostrEvent } from "../types";
import { fetchLatestProfile, getProfileEvent } from "./nostr";
import { upsertLocalIdentity } from "./local-search";
import { uniqueRelays } from "./relays";

export type ExactIdentity = { pubkey: string; npub: string; relayHints: string[] };
export type IdentityInput = { kind: "none" } | { kind: "invalid"; message: string } | { kind: "identity"; identity: ExactIdentity };

export function parseExactIdentity(raw: string): IdentityInput {
  const value = raw.trim().replace(/^nostr:/i, "");
  const looksLikeIdentity = /^(?:npub|nprofile)1/i.test(value);
  if (!looksLikeIdentity) return { kind: "none" };
  try {
    const decoded = nip19.decode(value.toLowerCase());
    if (decoded.type === "npub") return { kind: "identity", identity: { pubkey: decoded.data, npub: nip19.npubEncode(decoded.data), relayHints: [] } };
    if (decoded.type === "nprofile") return {
      kind: "identity",
      identity: { pubkey: decoded.data.pubkey, npub: nip19.npubEncode(decoded.data.pubkey), relayHints: uniqueRelays(decoded.data.relays ?? []) },
    };
    return { kind: "invalid", message: "Enter a complete npub or nprofile identity." };
  } catch {
    return { kind: "invalid", message: "That Nostr identity is incomplete or malformed." };
  }
}

export interface IdentityResolution {
  identity: ExactIdentity;
  metadataFound: boolean;
  relays: string[];
}

export interface IdentityResolverDependencies {
  fetchProfile(pubkey: string, relays: string[], connectRelays: boolean): Promise<NostrEvent | undefined>;
  persistIdentity(pubkey: string, seenAt?: number): Promise<void>;
}

const defaultDependencies: IdentityResolverDependencies = {
  fetchProfile: fetchLatestProfile,
  persistIdentity: upsertLocalIdentity,
};

export async function resolveRemoteIdentity(
  identity: ExactIdentity,
  readRelays: string[],
  mock = false,
  dependencies: IdentityResolverDependencies = defaultDependencies,
): Promise<IdentityResolution> {
  const relays = uniqueRelays([...identity.relayHints, ...readRelays]);
  await dependencies.persistIdentity(identity.pubkey);
  const profile = mock ? getProfileEvent(identity.pubkey) : await dependencies.fetchProfile(identity.pubkey, relays, true);
  return { identity, metadataFound: Boolean(profile), relays };
}
