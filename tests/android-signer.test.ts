import { describe, expect, it, vi } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';
import { amberProvider, deepLinkPath, type AmberTransport } from '../android/bridge';
function harness(handle: (request: Record<string, string>) => { result?: string; error?: string; id?: string }) {
  const requests: Record<string, string>[] = [];
  const transport: AmberTransport = { onmessage: null, postMessage: (raw) => { const request = JSON.parse(raw); requests.push(request); const reply = handle(request); queueMicrotask(() => transport.onmessage?.({ data: JSON.stringify({ id: request.id, ...reply }) })); } };
  return { provider: amberProvider(transport), requests, transport };
}
const secret = generateSecretKey(); const key = getPublicKey(secret);
const template = { kind: 1, created_at: 1700000000, content: 'hello', tags: [['t', 'canopy']] };
describe('Android Amber adapter', () => {
  it('correlates and cryptographically validates the requested event', async () => {
    const { provider, requests } = harness(r => ({ result: r.type === 'get_public_key' ? key : JSON.stringify(finalizeEvent(JSON.parse(r.payload), secret)) }));
    expect((await provider.signEvent(template)).pubkey).toBe(key);
    expect(requests[1].current_user).toBe(key);
  });
  it.each(['content', 'kind', 'tags', 'pubkey', 'sig'])('rejects signed response with changed %s', async (field) => {
    const { provider } = harness(r => {
      if (r.type === 'get_public_key') return { result: key };
      const changed = { ...JSON.parse(r.payload), ...(field === 'content' ? { content: 'substituted' } : field === 'kind' ? { kind: 7 } : field === 'tags' ? { tags: [] } : {}) };
      const event = finalizeEvent(changed, field === 'pubkey' ? generateSecretKey() : secret);
      return { result: JSON.stringify(field === 'sig' ? { ...event, sig: '0'.repeat(128) } : event) };
    });
    await expect(provider.signEvent(template)).rejects.toThrow('does not match');
  });
  it('forwards NIP-44 operations bound to account and peer', async () => {
    const { provider, requests } = harness(r => ({ result: r.type === 'get_public_key' ? key : r.type === 'nip44_encrypt' ? 'encrypted' : 'plaintext' }));
    expect(await provider.nip44!.encrypt(key, 'plaintext')).toBe('encrypted');
    expect(await provider.nip44!.decrypt(key, 'encrypted')).toBe('plaintext');
    expect(requests[1]).toMatchObject({ type: 'nip44_encrypt', pubkey: key, current_user: key, payload: 'plaintext' });
  });
  it('reports rejection/missing signer errors', async () => {
    const { provider } = harness(() => ({ error: 'Install Amber' }));
    await expect(provider.getPublicKey()).rejects.toThrow('Install Amber');
  });
  it('ignores uncorrelated replies and expires abandoned requests', async () => {
    vi.useFakeTimers();
    const { provider } = harness(() => ({ id: 'wrong', result: key }));
    const assertion = expect(provider.getPublicKey()).rejects.toThrow('expired');
    await vi.advanceTimersByTimeAsync(120_000); await assertion; vi.useRealTimers();
  });
  it('rejects invalid account and malformed signed events', async () => {
    await expect(harness(() => ({ result: 'nsec1secret' })).provider.getPublicKey()).rejects.toThrow('invalid account');
    const { provider } = harness(r => ({ result: r.type === 'get_public_key' ? key : 'not json' }));
    await expect(provider.signEvent(template)).rejects.toThrow('signed event');
  });
  it('accepts only public Canopy or recognized Nostr deep links', () => {
    expect(deepLinkPath('https://zinc-pod-arch.rick.runwingman.com/search')).toBe('/search');
    expect(deepLinkPath('https://evil.test/search')).toBeUndefined();
    expect(deepLinkPath('javascript:alert(1)')).toBeUndefined();
    expect(deepLinkPath('nostr:bad')).toBeUndefined();
  });
});
