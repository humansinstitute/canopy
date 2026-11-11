import * as nip19 from "nostr-tools/nip19";

const HEX_PUBKEY = /^[0-9a-f]{64}$/i;

export interface ProfileShareIdentity {
  npub: string;
  nostrUri: string;
}

export function profileShareIdentity(pubkey: string): ProfileShareIdentity {
  if (!HEX_PUBKEY.test(pubkey)) throw new Error("Cannot share an invalid Nostr public key.");
  const npub = nip19.npubEncode(pubkey.toLowerCase());
  return { npub, nostrUri: `nostr:${npub}` };
}
