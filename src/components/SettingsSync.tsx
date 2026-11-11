import { getAccountProvider, getNostrProvider, requestLogin } from "../lib/session";
import nstackSymbol from "../assets/nstack-symbol-white.svg";
import { createPortal } from "react-dom";
import { Modal } from "./Modal";
import { settingsFingerprint, syncCheckpointKey, syncIsDue } from "../lib/settings-schedule";
import { useEffect, useRef, useState } from "react";
import { clearNStackDestination, getNStackProvider, loadNStackDestination, nstackAvailable, waitForNStackProvider } from "../lib/nstack";
import { mergeSettings, readSettingsState, settingsChanges$, writeSettingsState } from "../lib/settings-state";
import { SettingsSyncError, syncSettings, TowerSettingsStore, validateSettingsState, type SettingsDecryptCache } from "../lib/settings-sync";

export function SettingsSync({ pubkey, onConnect, onRestored, onAccountChanged }: {
  pubkey: string;
  onConnect(): void;
  onRestored(): void;
  onAccountChanged(): void;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("Settings are local · checking NStack…");
  const [connectAvailable, setConnectAvailable] = useState(false);
  const [namespaceRequired, setNamespaceRequired] = useState(false);
  const [busy, setBusy] = useState(false);
  const runRef = useRef<(enable?: boolean) => void>(() => undefined);
  const callbacks = useRef({ onRestored, onAccountChanged });
  callbacks.current = { onRestored, onAccountChanged };

  useEffect(() => {
    let disposed = false;
    let generation = 0;
    const decryptCache: SettingsDecryptCache = new Map();
    let running = false;
    let rerun = false;
    let paused = false;
    let pauseMessage = "Settings are local and unsynced.";
    let provider = getNStackProvider();
    let boundProvider: typeof provider;
    let unsubscribe: (() => void) | undefined;
    let destinationKey = "";
    const currentDestinationKey = () => JSON.stringify(loadNStackDestination(pubkey) ?? null);
    const invalidate = () => {
      generation++;
      decryptCache.clear();
      paused = false;
      clearNStackDestination(pubkey);
      setConnectAvailable(true);
      setNamespaceRequired(false);
      setStatus("NStack connection changed · settings are local and unsynced. Connect your NStack again.");
    };
    const bind = () => {
      const next = getNStackProvider();
      if (next === boundProvider) return;
      if (boundProvider) { generation++; paused = false; }
      unsubscribe?.();
      boundProvider = provider = next;
      if (next) {
        const cleanup = next.on("change", invalidate);
        unsubscribe = typeof cleanup === "function" ? cleanup : () => next.off?.("change", invalidate);
      }
    };
    const run = async (enable = false, force = false) => {
      if (disposed) return;
      bind();
      const selection = currentDestinationKey();
      if (selection !== destinationKey) { generation++; decryptCache.clear(); paused = false; destinationKey = selection; }
      if (running) { rerun = true; return; }
      if (paused && !enable) return;
      running = true;
      const started = generation;
      const signer = window.nostr;
      const active = () => !disposed && started === generation && signer === window.nostr && currentDestinationKey() === selection;
      try {
        const selected = loadNStackDestination(pubkey);
        const checkpointKey = selected ? syncCheckpointKey(pubkey, selected) : undefined;
        if (checkpointKey && !enable && !force && !syncIsDue(checkpointKey, await settingsFingerprint(pubkey))) {
          if (active()) setStatus("Settings backed up · NIP-44 encrypted in your NStack.");
          return;
        }
        const readyPromise = provider?.ready ?? window.NStackReady;
        if (readyPromise) {
          void Promise.resolve(readyPromise).then(() => {
            if (!disposed && paused && pauseMessage.startsWith("NStack bridge is not ready")) { paused = false; void run(); }
          }, () => undefined);
          let timeout: ReturnType<typeof setTimeout> | undefined;
          try {
            await Promise.race([readyPromise, new Promise((_, reject) => { timeout = setTimeout(() => reject(new SettingsSyncError("bridge_not_ready", "NStack bridge is not ready. Settings are local and unsynced.")), 3000); })]);
          } finally { clearTimeout(timeout); }
        }
        if (!active()) return;
        if (!provider || !nstackAvailable(await provider.isAvailable())) {
          if (!disposed) { setStatus("Settings are local and unsynced · NStack bridge unavailable."); setConnectAvailable(false); }
          return;
        }
        if (!active()) return;
        const identity = await signer?.getPublicKey();
        if (!active()) return;
        if (identity && identity.toLowerCase() !== pubkey) { generation++; callbacks.current.onAccountChanged(); return; }
        const destination = loadNStackDestination(pubkey);
        setConnectAvailable(!destination);
        if (!destination) { setStatus("NStacks are available. Connect your NStack to restore and back up settings."); return; }
        // Revalidate consent and canonical destination without opening a discovery prompt.
        const stacks = await provider.listNStacks();
        const stackList = Array.isArray(stacks) ? stacks : (stacks as { stacks?: unknown[] })?.stacks ?? [];
        let approved = false;
        for (const stack of stackList) {
          if (!stack || typeof stack !== "object" || !("id" in stack) || typeof stack.id !== "string") continue;
          const workspaces = await provider.listWorkspaces({ stackId: stack.id });
          const list = Array.isArray(workspaces) ? workspaces : (workspaces as { workspaces?: unknown[] })?.workspaces ?? [];
          approved ||= list.some((item: unknown) => {
            const workspace = item as Record<string, unknown> | null;
            return workspace?.workspaceId === destination.workspaceId && workspace?.directHttpsUrl === destination.serverUrl && workspace.workspaceOwnerNpub === destination.workspaceOwnerNpub && workspace.workspaceServiceNpub === destination.workspaceServiceNpub;
          });
        }
        if (!active()) return;
        if (!approved) { invalidate(); return; }
        setBusy(true);
        setStatus("Syncing encrypted settings…");
        const store = new TowerSettingsStore(destination, pubkey, getAccountProvider(pubkey), active, decryptCache);
        if (enable) await store.enable();
        let syncedState = readSettingsState(pubkey);
        const hasSettings = await syncSettings(store, () => { if (active()) callbacks.current.onRestored(); }, state => { syncedState = state; });
        if (active()) {
          const fingerprint = await settingsFingerprint(pubkey, syncedState);
          if (!active()) return;
          localStorage.setItem(syncCheckpointKey(pubkey, destination), JSON.stringify({ successAt: Date.now(), fingerprint }));
          setNamespaceRequired(false); setStatus(hasSettings ? "Settings backed up · NIP-44 encrypted in your NStack." : "NStack connected · no private settings to back up yet."); }
      } catch (error) {
        if (active()) {
          const code = error instanceof SettingsSyncError ? error.code : "";
          // A cancelled sync may reflect bridge churn, not a different account.
          // Only a successful identity read (above or in accountPoll) ends a session.
          paused = code !== "pending";
          setNamespaceRequired(code === "namespace_required");
          pauseMessage = error instanceof SettingsSyncError ? error.message : "Settings remain local and unsynced. Reconnect your NStack or retry when ready.";
          setStatus(pauseMessage);
        }
      } finally {
        running = false;
        if (!disposed) setBusy(false);
        if (rerun && !disposed) { rerun = false; void run(); }
      }
    };
    runRef.current = (enable = false) => { paused = false; void run(enable, true); };
    let changeTimer: ReturnType<typeof setTimeout> | undefined;
    const scheduleChange = () => { clearTimeout(changeTimer); changeTimer = setTimeout(() => { void run(); }, 400); };
    const changed = settingsChanges$.subscribe((account) => {
      if (account !== pubkey) return;
      setStatus(paused ? `Settings saved locally and unsynced. ${pauseMessage}` : "Settings saved locally · backup pending.");
      scheduleChange();
    });
    const onStorage = (event: StorageEvent) => {
      if (event.key === `canopy.settings.v1.${pubkey}` && event.newValue) {
        try {
          const before = readSettingsState(pubkey);
          let merged = mergeSettings(before, validateSettingsState(JSON.parse(event.newValue), pubkey));
          if (event.oldValue) merged = mergeSettings(merged, validateSettingsState(JSON.parse(event.oldValue), pubkey));
          if (JSON.stringify(before) !== JSON.stringify(merged)) writeSettingsState(merged);
          callbacks.current.onRestored();
        } catch { setStatus("Local settings could not be read · sync paused."); paused = true; }
      }
      if (event.key === `canopy.settings.v1.${pubkey}` || event.key === `canopy.networkSettings.${pubkey}`) scheduleChange();
    };
    const visible = () => { if (document.visibilityState === "visible") void run(); };
    const ready = () => { paused = false; void run(); };
    for (const event of ["nstackready", "nstack:ready", "nstack-ready"]) window.addEventListener(event, ready);
    window.addEventListener("storage", onStorage);
    window.addEventListener("online", visible);
    document.addEventListener("visibilitychange", visible);
    const poll = window.setInterval(() => { if (getNStackProvider() !== boundProvider || !paused && document.visibilityState === "visible") void run(); }, 60_000);
    // Keep checking injection even after the initial readiness window has elapsed.
    let checkingIdentity = false;
    const accountPoll = window.setInterval(async () => {
      if (disposed || checkingIdentity || document.visibilityState !== "visible") return;
      checkingIdentity = true;
      try {
        const signer = getNostrProvider();
        if (!signer) return;
        const identity = await requestLogin(signer);
        if (!disposed && signer === getNostrProvider() && identity !== pubkey) { generation++; callbacks.current.onAccountChanged(); }
      } catch { /* Locked or temporarily missing bridges do not prove account change. */ }
      finally { checkingIdentity = false; }
    }, 5000);
    const injection = window.setInterval(() => { if (getNStackProvider() !== boundProvider) void run(); }, 1_000);
    void waitForNStackProvider().then(() => { if (!disposed) void run(); });
    return () => {
      disposed = true; generation++; clearTimeout(changeTimer); changed.unsubscribe(); unsubscribe?.();
      window.clearInterval(poll); window.clearInterval(injection); window.clearInterval(accountPoll);
      for (const event of ["nstackready", "nstack:ready", "nstack-ready"]) window.removeEventListener(event, ready);
      window.removeEventListener("storage", onStorage); window.removeEventListener("online", visible); document.removeEventListener("visibilitychange", visible);
    };
  }, [pubkey]);

  const state = busy ? "syncing" : namespaceRequired || /unsynced|not approved|could not|must support|paused|unavailable/.test(status) ? "attention" : status.includes("backed up") ? "synced" : "local";
  return <>
    <button type="button" className={`settings-sync-icon settings-sync-icon--${state}`} aria-label={`Settings backup: ${status} · NStack`} title={status} aria-haspopup="dialog" onClick={() => setOpen(true)}>
      <img src={nstackSymbol} alt="" width="640" height="626.56" /><i aria-hidden="true" />
    </button>
    {open && createPortal(<Modal title="Settings backup" onClose={() => setOpen(false)}><div className="settings-sync-controls"><p role="status">{status}</p>{connectAvailable ? <button type="button" onClick={() => { setOpen(false); onConnect(); }}>Connect your NStack</button> : <><button type="button" disabled={busy} onClick={() => runRef.current()}>{busy ? "Syncing…" : "Sync now"}</button><button type="button" onClick={() => { setOpen(false); onConnect(); }}>NStack connection</button></>}{namespaceRequired && <button type="button" disabled={busy} onClick={() => runRef.current(true)}>Enable Canopy backup</button>}</div></Modal>, document.body)}
  </>;
}
