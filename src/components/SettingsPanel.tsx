import { useEffect, useState } from "react";
import type { NetworkSettings } from "../lib/settings";
import { parseSettingsInput } from "../lib/settings";
import { nwcConnectionSummary, parseNwcConnection } from "../lib/nwc";
import { MAX_ZAP_MESSAGE_LENGTH, validateZapPreferences, type ZapPreferences } from "../lib/zap-preferences";

export function SettingsPanel({ settings, profileDefaults, zapPreferences, onReset, onSaveZapPreferences, nwcConnection, onSaveNwc, onRemoveNwc, onSaveAll }: {
  settings: NetworkSettings;
  profileDefaults: NetworkSettings;
  zapPreferences: ZapPreferences;
  onReset(): void;
  onSaveZapPreferences(preferences: ZapPreferences): void;
  nwcConnection?: string;
  onSaveNwc(connectionUri: string): void;
  onRemoveNwc(): void;
  onSaveAll(settings: NetworkSettings, zap: ZapPreferences, nwc?: string): void;
}) {
  const [read, setRead] = useState(settings.relays.read.join("\n"));
  const [write, setWrite] = useState(settings.relays.write.join("\n"));
  const [blossom, setBlossom] = useState(settings.blossomServers.join("\n"));
  const [zapAmount, setZapAmount] = useState(String(zapPreferences.amount));
  const [zapMessage, setZapMessage] = useState(zapPreferences.message);
  const [message, setMessage] = useState<string>();
  const [nwcInput, setNwcInput] = useState("");

  useEffect(() => {
    setRead(settings.relays.read.join("\n"));
    setWrite(settings.relays.write.join("\n"));
    setBlossom(settings.blossomServers.join("\n"));
  }, [settings.relays, settings.blossomServers]);

  useEffect(() => {
    setZapAmount(String(zapPreferences.amount));
    setZapMessage(zapPreferences.message);
  }, [zapPreferences]);

  function save() {
    try {
      const network = parseSettingsInput(read, write, blossom);
      const zap = validateZapPreferences(Number(zapAmount), zapMessage);
      const nwc = nwcInput.trim() || undefined;
      if (nwc) parseNwcConnection(nwc);
      onSaveAll(network, zap, nwc);
      setNwcInput("");
      setMessage("Settings saved in this browser. Check backup status for cross-device sync.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Settings could not be saved.");
    }
  }

  function reset() {
    try {
      onReset();
      setRead(profileDefaults.relays.read.join("\n"));
      setWrite(profileDefaults.relays.write.join("\n"));
      setBlossom(profileDefaults.blossomServers.join("\n"));
      setMessage("Using your profile defaults.");
    } catch { setMessage("Profile reset could not be saved. Please retry."); }
  }

  function connectWallet() {
    try {
      parseNwcConnection(nwcInput);
      onSaveNwc(nwcInput.trim());
      setNwcInput("");
      setMessage("Nostr Wallet Connect saved in this browser.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The wallet connection could not be saved.");
    }
  }

  function saveZapDefaults() {
    try {
      const next = validateZapPreferences(Number(zapAmount), zapMessage);
      onSaveZapPreferences(next);
      setMessage("Zap defaults saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Zap defaults could not be saved.");
    }
  }

  return (
    <div className="settings-panel">
      <p className="settings-copy">Local overrides: Canopy uses your NIP-65 relay list and Blossom server list by default. Settings save here first; backup status shows whether your NStack has an encrypted copy.</p>
      <label>Read relays<textarea aria-label="Read relays" rows={4} value={read} onChange={(event) => setRead(event.target.value)} /></label>
      <label>Write relays<textarea aria-label="Write relays" rows={4} value={write} onChange={(event) => setWrite(event.target.value)} /></label>
      <label>Blossom upload servers (local override)<textarea aria-label="Blossom upload servers" rows={3} value={blossom} placeholder="https://blossom.example" onChange={(event) => setBlossom(event.target.value)} /></label>
      <div className="settings-actions"><button className="secondary-button" type="button" onClick={reset}>Reset to profile</button><button className="primary-button compact" type="button" onClick={save}>Save settings</button></div>
      <section className="wallet-settings" aria-labelledby="zap-settings-title">
        <div><h3 id="zap-settings-title">One-tap zaps</h3><span className="nip-badge">NIP-57</span></div>
        <p className="settings-copy">A normal Zap tap uses these saved defaults. Long-press, right-click, or press Shift+Enter on a Zap button for a one-off choice.</p>
        <label>Default zap amount<div className="zap-fields"><input aria-label="Default zap amount" inputMode="numeric" type="number" min="1" max="1000000" step="1" value={zapAmount} onChange={(event) => setZapAmount(event.target.value)} /><span>sats</span></div></label>
        <label>Default zap message<input aria-label="Default zap message" value={zapMessage} maxLength={MAX_ZAP_MESSAGE_LENGTH} placeholder="No message" onChange={(event) => setZapMessage(event.target.value)} /></label>
        <button className="secondary-button wallet-connect-button" type="button" onClick={saveZapDefaults}>Save zap defaults</button>
      </section>
      <section className="wallet-settings" aria-labelledby="wallet-settings-title">
        <div><h3 id="wallet-settings-title">Nostr Wallet Connect</h3><span className="nip-badge">NIP-47</span></div>
        <p className="settings-copy">Your NWC URI is a payment capability. Canopy masks it after saving and uses it for encrypted wallet requests. NStack backups encrypt it to your own identity with NIP-44 before upload.</p>
        {nwcConnection ? <div className="wallet-connected"><span aria-hidden="true">⚡</span><div><strong>Wallet connected</strong><small>{nwcConnectionSummary(nwcConnection)}</small></div><button type="button" onClick={() => { try { onRemoveNwc(); setMessage("Wallet removed locally. Its removal will sync when backup is available."); } catch { setMessage("Wallet removal could not be saved. Please retry."); } }}>Remove</button></div>
          : <><label>NWC connection URI<input aria-label="NWC connection URI" type="password" autoComplete="off" spellCheck={false} value={nwcInput} placeholder="nostr+walletconnect://…" onChange={(event) => setNwcInput(event.target.value)} /></label><button className="secondary-button wallet-connect-button" type="button" onClick={connectWallet} disabled={!nwcInput.trim()}>Connect wallet</button></>}
      </section>
      {message && <p className="form-message" role="status">{message}</p>}
    </div>
  );
}
