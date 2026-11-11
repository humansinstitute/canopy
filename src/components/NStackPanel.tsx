import { useCallback, useEffect, useMemo, useState } from "react";
import {
  clearNStackDestination,
  discoverNStackInventory,
  loadNStackDestination,
  nstackAvailable,
  resolveNStackDestination,
  saveNStackDestination,
  waitForNStackProvider,
  type NStackDestination,
  type NStackInventory,
} from "../lib/nstack";
import type { NStackProvider } from "../types";

export function NStackPanel({ pubkey }: { pubkey: string }) {
  const [provider, setProvider] = useState<NStackProvider>();
  const [available, setAvailable] = useState<boolean>();
  const [inventory, setInventory] = useState<NStackInventory>({ stacks: [], workspaces: [] });
  const [stackId, setStackId] = useState<string>();
  const [workspaceAlias, setWorkspaceAlias] = useState<string>();
  const [destination, setDestination] = useState<NStackDestination | undefined>(() => loadNStackDestination(pubkey));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    let active = true;
    void waitForNStackProvider().then(async (next) => {
      if (!active || !next) { if (active) setAvailable(false); return; }
      setProvider(next);
      try {
        const supported = nstackAvailable(await next.isAvailable());
        if (active) setAvailable(supported);
      } catch {
        if (active) setAvailable(false);
      }
    });
    return () => { active = false; };
  }, []);

  const revokeImportedDestination = useCallback(() => {
    clearNStackDestination(pubkey);
    setDestination(undefined);
    setInventory({ stacks: [], workspaces: [] });
    setStackId(undefined);
    setWorkspaceAlias(undefined);
    setMessage("Your disclosed NStack connection changed or was revoked. Approve discovery again to re-import it.");
  }, [pubkey]);

  useEffect(() => {
    if (!provider?.on) return;
    const unsubscribe = provider.on("change", revokeImportedDestination);
    return () => {
      if (typeof unsubscribe === "function") unsubscribe();
      else provider.off?.("change", revokeImportedDestination);
    };
  }, [provider, revokeImportedDestination]);

  const visibleWorkspaces = useMemo(() => inventory.workspaces.filter((workspace) => workspace.stackId === stackId), [inventory.workspaces, stackId]);
  const selectedWorkspace = inventory.workspaces.find((workspace) => workspace.id === workspaceAlias && workspace.stackId === stackId);

  async function discover() {
    if (!provider) return;
    setBusy(true);
    setMessage(undefined);
    setStackId(undefined);
    setWorkspaceAlias(undefined);
    try {
      const next = await discoverNStackInventory(provider);
      setInventory(next);
      if (!next.stacks.length) setMessage("NBrowser disclosed no NStacks for Canopy.");
      else if (!next.workspaces.length) setMessage("No disclosed workspace contained a safe, complete connection descriptor.");
      else setMessage("Choose the NStack and workspace to import into Canopy.");
    } catch (error) {
      setInventory({ stacks: [], workspaces: [] });
      setMessage(error instanceof Error ? error.message : "NStack discovery was not approved.");
    } finally {
      setBusy(false);
    }
  }

  function chooseStack(nextStackId: string) {
    setStackId(nextStackId);
    setWorkspaceAlias(undefined);
    const count = inventory.workspaces.filter(({ stackId: owner }) => owner === nextStackId).length;
    setMessage(count ? "Choose a disclosed workspace." : "This NStack did not disclose a usable workspace connection.");
  }

  async function importDestination() {
    if (!provider || !selectedWorkspace) return;
    setBusy(true);
    setMessage(undefined);
    try {
      const nextDestination = await resolveNStackDestination(provider, selectedWorkspace);
      saveNStackDestination(pubkey, nextDestination);
      setDestination(nextDestination);
      setMessage(`Imported ${selectedWorkspace.name}. Canopy will use this destination only for NStack/Tower features.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The selected NStack connection could not be imported.");
    } finally {
      setBusy(false);
    }
  }

  function forget() {
    clearNStackDestination(pubkey);
    setDestination(undefined);
    setMessage("Canopy forgot the imported destination. NBrowser controls disclosure and revocation separately.");
  }

  if (available === undefined) return <div className="nstack-panel"><p className="settings-copy">Checking NBrowser for NStack support…</p></div>;
  if (!available) return <div className="nstack-panel"><div className="nstack-empty"><strong>NStack bridge unavailable</strong><p>Open Canopy in an updated NBrowser to import a saved NStack workspace. Ordinary NIP-07 browsing, signing, relays, and uploads still work without it.</p></div>{destination && <ImportedDestination destination={destination} onForget={forget} stale />}</div>;

  return (
    <div className="nstack-panel">
      <div className="nstack-status"><span className={destination ? "is-imported" : ""} /> <strong>{destination ? "NStack destination imported" : "NStack available"}</strong></div>
      <p className="settings-copy">NBrowser shares only the saved NStack and workspace details you approve. Canopy continues to use your configured public Nostr relays and Blossom servers independently.</p>
      {destination && <ImportedDestination destination={destination} onForget={forget} />}
      <button className="secondary-button" type="button" onClick={discover} disabled={busy}>{busy ? "Waiting for NBrowser…" : destination ? "Change imported workspace" : "Discover my NStacks"}</button>
      {inventory.stacks.length > 0 && <section className="nstack-choices" aria-label="Disclosed NStacks"><h3>Disclosed NStacks</h3>{inventory.stacks.map((stack) => <button type="button" className={stackId === stack.id ? "selected" : ""} onClick={() => chooseStack(stack.id)} disabled={busy} key={stack.id}><span><strong>{stack.name}</strong>{(stack.description || stack.status) && <small>{stack.description || stack.status}</small>}</span><b>{stackId === stack.id ? "✓" : "○"}</b></button>)}</section>}
      {stackId && visibleWorkspaces.length > 0 && <section className="nstack-choices" aria-label="Disclosed workspaces"><h3>Disclosed workspaces</h3>{visibleWorkspaces.map((workspace) => <button type="button" className={workspaceAlias === workspace.id ? "selected" : ""} onClick={() => { setWorkspaceAlias(workspace.id); setMessage("Workspace selected. Import its connection when you are ready."); }} key={workspace.id}><span><strong>{workspace.name}</strong>{workspace.description && <small>{workspace.description}</small>}</span><b>{workspaceAlias === workspace.id ? "✓" : "○"}</b></button>)}</section>}
      {selectedWorkspace && <div className="nstack-actions"><button className="primary-button compact" type="button" onClick={() => void importDestination()} disabled={busy}>{busy ? "Importing…" : "Import connection"}</button></div>}
      {message && <p className="form-message" role="status">{message}</p>}
      <p className="nstack-footnote">Canopy stores the canonical server and real workspace metadata, never browser aliases, keys, tokens, signatures, or credentials. Signing remains normal <code>window.nostr</code>.</p>
    </div>
  );
}

function ImportedDestination({ destination, onForget, stale = false }: { destination: NStackDestination; onForget(): void; stale?: boolean }) {
  return <section className="nstack-imported" aria-label="Imported NStack destination"><strong>{destination.workspaceName}</strong><span>{destination.serverUrl}</span><small>{stale ? "Saved locally; reopen in NBrowser to verify or change it." : "Available to Canopy’s NStack/Tower features."}</small><button className="secondary-button" type="button" onClick={onForget}>Forget imported destination</button></section>;
}
