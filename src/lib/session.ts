import { verifyEvent } from "nostr-tools";
import type { NostrProvider } from "../types";

const REMEMBER_LOGIN_KEY = "canopy.rememberLogin";

export function getNostrProvider(target: Window = window): NostrProvider | null {
  const provider = target.nostr;
  return provider && typeof provider.getPublicKey === "function" && typeof provider.signEvent === "function" ? provider : null;
}

export async function requestLogin(provider: NostrProvider): Promise<string> {
  const pubkey = await provider.getPublicKey();
  if (!/^[0-9a-f]{64}$/i.test(pubkey)) throw new Error("The signer returned an invalid public key.");
  return pubkey.toLowerCase();
}

export function hasRememberedLogin(storage: Pick<Storage, "getItem"> = localStorage): boolean {
  try {
    return storage.getItem(REMEMBER_LOGIN_KEY) === "1";
  } catch {
    return false;
  }
}

export function rememberLogin(storage: Pick<Storage, "setItem"> = localStorage): void {
  try {
    storage.setItem(REMEMBER_LOGIN_KEY, "1");
  } catch {
    // A blocked localStorage should not prevent a signer-backed login.
  }
}

export function forgetLogin(storage: Pick<Storage, "removeItem"> = localStorage): void {
  try { storage.removeItem(REMEMBER_LOGIN_KEY); } catch { /* Still sign out for this document. */ }
}

/** Passive discovery: NBrowser injects after page load without a signer-ready event.
 * Keep watching while mounted, including after the missing-signer guidance appears.
 * Never probe availability by calling a permission-bearing signer method.
 */
export function watchNostrProvider(onChange: (provider: NostrProvider | null) => void, target: Window = window): () => void {
  let previous: NostrProvider | null | undefined;
  const check = () => {
    const provider = getNostrProvider(target);
    if (provider !== previous) { previous = provider; onChange(provider); }
  };
  const timer = target.setInterval(check, 300);
  target.addEventListener("focus", check);
  target.addEventListener("pageshow", check);
  target.addEventListener("nostr#initialized", check);
  const initial = target.setTimeout(check, 0);
  return () => {
    target.clearTimeout(initial);
    target.clearInterval(timer);
    target.removeEventListener("focus", check);
    target.removeEventListener("pageshow", check);
    target.removeEventListener("nostr#initialized", check);
  };
}

// A session lease survives bridge reinjection, but never logout/account change.
let accountLease: { pubkey: string } | undefined;
export function setSessionAccount(pubkey?: string): void {
  accountLease = pubkey ? { pubkey } : undefined;
}

export function getAccountProvider(pubkey = accountLease?.pubkey): NostrProvider {
  const lease = accountLease;
  const current = () => {
    if (!lease || accountLease !== lease || lease.pubkey !== pubkey) throw new Error("Your account changed. Reconnect before continuing.");
    const provider = getNostrProvider();
    if (!provider) throw new Error("Your Nostr signer is temporarily unavailable. Try again.");
    return provider;
  };
  const checked = async () => {
    const provider = current();
    const identity = await requestLogin(provider);
    if (current() !== provider || identity !== pubkey) throw new Error("Your signer account changed. Reconnect before continuing.");
    return provider;
  };
  const assertCurrent = async (provider: NostrProvider) => {
    if (current() !== provider || await requestLogin(provider) !== pubkey || current() !== provider) throw new Error("Your signer account changed. The operation was cancelled.");
  };
  return {
    getPublicKey: async () => { await checked(); return pubkey!; },
    signEvent: async (template) => {
      const provider = await checked();
      const event = await provider.signEvent(template);
      await assertCurrent(provider);
      if (event.pubkey !== pubkey) throw new Error("The signer returned an event for a different account.");
      if (!verifyEvent(event)) throw new Error("The signer returned an invalid event.");
      return event;
    },
    get nip44(): NostrProvider["nip44"] {
      if (!getNostrProvider()?.nip44) return undefined;
      return {
        encrypt: async (peer, text) => {
          const provider = await checked();
          if (!provider.nip44) throw new Error("NIP-44 is unavailable.");
          const result = await provider.nip44.encrypt(peer, text);
          await assertCurrent(provider);
          return result;
        },
        decrypt: async (peer, text) => {
          const provider = await checked();
          if (!provider.nip44) throw new Error("NIP-44 is unavailable.");
          const result = await provider.nip44.decrypt(peer, text);
          await assertCurrent(provider);
          return result;
        },
      };
    },
  };
}
