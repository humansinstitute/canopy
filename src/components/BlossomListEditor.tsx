import { useEffect, useRef, useState } from "react";
import type { RelayPool } from "applesauce-relay";
import type { NostrEvent } from "../types";
import { MAX_BLOSSOM_SERVERS, publishBlossomList, readBlossomList, validateProfileServers } from "../lib/blossom-list";
import { getAccountProvider } from "../lib/session";

export function BlossomListEditor({ pubkey, readRelays, writeRelays, pool, onPublished }: {
  pubkey: string; readRelays: string[]; writeRelays: string[]; pool: Pick<RelayPool, "publish">; onPublished(event: NostrEvent): void;
}) {
  const [base, setBase] = useState<NostrEvent>();
  const [servers, setServers] = useState<string[]>([]);
  const [resolved, setResolved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const alive = useRef(false);
  const operation = useRef(0);
  const networkKey = JSON.stringify([pubkey, readRelays, writeRelays]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; operation.current++; }; }, [networkKey]);
  useEffect(() => { setBusy(false); setResolved(false); setServers([]); setBase(undefined); setConfirm(false); setMessage(""); }, [networkKey]);

  async function load() {
    const revision = ++operation.current;
    setBusy(true); setConfirm(false); setError(false); setMessage("Loading the newest list from all configured relays…");
    try {
      const event = await readBlossomList(pubkey, [...readRelays, ...writeRelays]);
      if (!alive.current || revision !== operation.current) return;
      setBase(event); setServers(event?.tags.filter(([name]) => name === "server").map((tag) => tag[1] ?? "") ?? []);
      setResolved(true); setMessage(event ? "Published list loaded. First server is preferred." : "No published list found on your configured relays. Add at least one server.");
    } catch (caught) { if (alive.current && revision === operation.current) { setResolved(false); setError(true); setMessage(caught instanceof Error ? caught.message : "List could not be loaded."); } }
    finally { if (alive.current && revision === operation.current) setBusy(false); }
  }
  function edit(next: string[]) { setServers(next); setConfirm(false); setMessage(""); }
  function move(index: number, offset: number) { const next = [...servers]; [next[index], next[index + offset]] = [next[index + offset]!, next[index]!]; edit(next); }
  function review() {
    try { setServers(validateProfileServers(servers)); setConfirm(true); setError(false); setMessage(""); }
    catch (caught) { setError(true); setMessage((caught as Error).message); }
  }
  async function publish() {
    if (busy || !resolved || !confirm) return;
    const revision = ++operation.current;
    setBusy(true); setError(false); setConfirm(false); setMessage("Checking list and requesting signer approval…");
    const active = () => alive.current && operation.current === revision;
    try {
      const result = await publishBlossomList({ pubkey, base, servers, read: () => readBlossomList(pubkey, [...readRelays, ...writeRelays]), signer: getAccountProvider(pubkey), pool, writeRelays, active });
      if (!active()) return;
      setBase(result.event); onPublished(result.event);
      setMessage(`Published list: ${result.accepted.length} of ${result.total} relays confirmed. Other relays may still be pending. Local overrides are unchanged.`);
    } catch (caught) { if (active()) { setError(true); setMessage(caught instanceof Error ? caught.message : "Publication failed; your edits are retained."); } }
    finally { if (active()) setBusy(false); }
  }
  return <section className="wallet-settings blossom-profile-editor" aria-labelledby="blossom-profile-title">
    <h3 id="blossom-profile-title">Published Blossom server list</h3>
    <p className="settings-copy">Public BUD-03 list for this Nostr account, separate from the local upload override above. HTTPS only; at least one server is required. Publishing asks your signer to approve kind 10063.</p>
    <button type="button" className="secondary-button" disabled={busy} onClick={() => { if (!resolved || window.confirm("Reload the published list and discard these profile-list edits?")) void load(); }}>{resolved ? "Reload published list" : "Load published list"}</button>
    {resolved && <fieldset disabled={busy}>
      <ol>{servers.map((server, index) => <li key={index}>
        <label>Server {index + 1}<input aria-label={`Profile server ${index + 1}`} value={server} maxLength={2048} onChange={(e) => edit(servers.map((s, i) => i === index ? e.target.value : s))} /></label>
        <div className="settings-actions">
          <button type="button" aria-label={`Move server ${index + 1} up`} disabled={index === 0} onClick={() => move(index, -1)}>Up</button>
          <button type="button" aria-label={`Move server ${index + 1} down`} disabled={index === servers.length - 1} onClick={() => move(index, 1)}>Down</button>
          <button type="button" aria-label={`Remove server ${index + 1}`} onClick={() => edit(servers.filter((_, i) => i !== index))}>Remove</button>
        </div>
      </li>)}</ol>
      <button type="button" className="secondary-button" disabled={servers.length >= MAX_BLOSSOM_SERVERS} onClick={() => edit([...servers, ""])}>Add profile server</button>
      <button type="button" className="primary-button compact" onClick={review}>Publish profile list</button>
      {confirm && <div role="group" aria-label="Confirm profile list publication"><p>This replaces your public Blossom list with the {servers.length} servers shown above, in this order. Continue?</p><button type="button" className="primary-button compact" onClick={() => void publish()}>Confirm publish</button><button type="button" onClick={() => setConfirm(false)}>Cancel</button></div>}
    </fieldset>}
    {message && <p className="form-message" role={error ? "alert" : "status"}>{message}</p>}
  </section>;
}
