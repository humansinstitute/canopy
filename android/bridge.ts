import { getEventHash, verifyEvent, type EventTemplate, type NostrEvent } from 'nostr-tools';
import { decode, neventEncode, npubEncode } from 'nostr-tools/nip19';
import type { NostrProvider } from '../src/types';

type Reply = { id: string; result?: string; error?: string };
export interface AmberTransport { postMessage(message: string): void; onmessage: ((event: { data: string }) => void) | null }

/** The host exposes this transport only to the bundled main-frame HTTPS origin. */
export function amberProvider(transport: AmberTransport): NostrProvider {
  const pending = new Map<string, { resolve(value: string): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  transport.onmessage = ({ data }) => {
    let reply: Reply;
    try { reply = JSON.parse(data); } catch { return; }
    const request = pending.get(reply.id);
    if (!request) return;
    pending.delete(reply.id);
    clearTimeout(request.timer);
    if (reply.error) request.reject(new Error(reply.error));
    else if (typeof reply.result !== 'string') request.reject(new Error('Amber returned an invalid result.'));
    else request.resolve(reply.result);
  };
  const call = (type: string, payload = '', pubkey?: string, current_user?: string): Promise<string> => new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Amber request expired. Try again.')); }, 120_000);
    pending.set(id, { resolve, reject, timer });
    try { transport.postMessage(JSON.stringify({ id, type, payload, pubkey, current_user })); }
    catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
  });
  const getPublicKey = async () => {
    const key = await call('get_public_key');
    if (!/^[0-9a-f]{64}$/.test(key)) throw new Error('Amber returned an invalid account.');
    return key;
  };
  return {
    getPublicKey,
    signEvent: async (template: EventTemplate) => {
      // Snapshot caller input before any asynchronous permission prompt.
      const expected = JSON.parse(JSON.stringify(template)) as EventTemplate;
      const pubkey = await getPublicKey();
      const unsigned = { kind: expected.kind, created_at: expected.created_at, tags: expected.tags, content: expected.content, pubkey };
      const id = getEventHash(unsigned);
      const value = await call('sign_event', JSON.stringify({ ...unsigned, id }), undefined, pubkey);
      let event: NostrEvent;
      try { event = JSON.parse(value); } catch { throw new Error('Amber did not return a signed event.'); }
      if (event.pubkey !== pubkey || event.id !== id || event.kind !== unsigned.kind || event.created_at !== unsigned.created_at || event.content !== unsigned.content || JSON.stringify(event.tags) !== JSON.stringify(unsigned.tags) || !verifyEvent(event)) {
        throw new Error('Amber returned an event that does not match the request and account.');
      }
      return event;
    },
    nip44: {
      encrypt: async (peer, text) => call('nip44_encrypt', text, peer, await getPublicKey()),
      decrypt: async (peer, text) => call('nip44_decrypt', text, peer, await getPublicKey()),
    },
  };
}

export function deepLinkPath(link: string): string | undefined {
  try {
    const url = new URL(link);
    if (url.protocol === 'https:' && url.hostname === 'zinc-pod-arch.rick.runwingman.com' && !url.port && !url.username && !url.password) return url.pathname;
    if (url.protocol !== 'nostr:') return undefined;
    const decoded = decode(link.slice(6));
    if (decoded.type === 'npub') return `/profile/${npubEncode(decoded.data)}`;
    if (decoded.type === 'nprofile') return `/profile/${npubEncode(decoded.data.pubkey)}`;
    if (decoded.type === 'note') return `/event/${neventEncode({ id: decoded.data })}`;
    if (decoded.type === 'nevent') return `/event/${neventEncode(decoded.data)}`;
  } catch { /* Ignore malformed external input. */ }
  return undefined;
}

declare global { interface Window { canopyAmber?: AmberTransport; canopyOpenLink?: (link: string) => void } }
if (typeof window !== 'undefined' && window.location?.origin === 'https://appassets.androidplatform.net' && window.canopyAmber) {
  window.nostr = amberProvider(window.canopyAmber);
  window.canopyOpenLink = (link) => {
    const path = deepLinkPath(link);
    if (path) { history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')); }
  };
  const link = new URL(location.href).searchParams.get('canopyLink');
  if (link) { const path = deepLinkPath(link); if (path) history.replaceState({}, '', path); }
  // Load the same app only after the Android provider has been installed.
  void import('../src/main');
}
