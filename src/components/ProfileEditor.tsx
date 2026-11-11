import { useEffect, useMemo, useState } from "react";
import type { RelayPool } from "applesauce-relay";
import type { NostrEvent, NostrProvider } from "../types";
import { fetchLatestProfile } from "../lib/nostr";
import { ProfilePublisher, profileDraft, type ManagedProfileField, type ProfileDraft } from "../lib/identity";

const FIELDS: Array<{ key: ManagedProfileField; label: string; placeholder?: string; multiline?: boolean; maxLength: number }> = [
  { key: "display_name", label: "Display name", maxLength: 80 },
  { key: "name", label: "Username", maxLength: 50 },
  { key: "about", label: "Bio", multiline: true, maxLength: 5_000 },
  { key: "picture", label: "Picture URL", placeholder: "https://…", maxLength: 2_048 },
  { key: "banner", label: "Banner URL", placeholder: "https://…", maxLength: 2_048 },
  { key: "website", label: "Website", placeholder: "https://…", maxLength: 2_048 },
  { key: "nip05", label: "NIP-05 address", placeholder: "name@example.com", maxLength: 320 },
  { key: "lud16", label: "Lightning address", placeholder: "name@example.com", maxLength: 320 },
];

export function ProfileEditor({ pubkey, sign, pool, readRelays, writeRelays, connectRelays = true, onPublished }: {
  pubkey: string;
  sign: NostrProvider["signEvent"];
  pool: Pick<RelayPool, "publish">;
  readRelays: string[];
  writeRelays: string[];
  connectRelays?: boolean;
  onPublished(event: NostrEvent): void;
}) {
  const [baseEvent, setBaseEvent] = useState<NostrEvent>();
  const [draft, setDraft] = useState<ProfileDraft>(() => profileDraft(undefined));
  const [resolved, setResolved] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [loadRevision, setLoadRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState(false);
  const publisher = useMemo(() => new ProfilePublisher(sign, pool, writeRelays, onPublished), [sign, pool, writeRelays, onPublished]);

  useEffect(() => {
    let active = true;
    setResolved(false);
    setLoadError(false);
    setMessage(undefined);
    setError(false);
    fetchLatestProfile(pubkey, readRelays, connectRelays).then((event) => {
      if (!active) return;
      setBaseEvent(event);
      setDraft(profileDraft(event));
      setResolved(true);
    }).catch(() => {
      if (!active) return;
      setLoadError(true);
      setError(true);
      setMessage("Your latest profile could not be loaded. Retry before saving.");
    });
    return () => { active = false; };
  }, [pubkey, readRelays, connectRelays, loadRevision]);

  function update(field: ManagedProfileField, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving || !resolved) return;
    setSaving(true);
    setMessage(undefined);
    setError(false);
    try {
      const result = await publisher.save(baseEvent, draft);
      setBaseEvent(result.event);
      const relayWord = result.accepted === 1 ? "relay" : "relays";
      setMessage(result.status === "partial"
        ? `Profile saved to ${result.accepted} ${relayWord}; some relays were unavailable.`
        : `Profile saved to ${result.accepted} ${relayWord}.`);
    } catch (caught) {
      setError(true);
      setMessage(caught instanceof Error ? caught.message : "Your profile could not be saved. Your edits are still here.");
    } finally {
      setSaving(false);
    }
  }

  return <form className="profile-editor" onSubmit={submit}>
    <p className="settings-copy">This publishes your public Nostr profile through your browser signer. Canopy never receives your private key.</p>
    {!resolved && !loadError && <p className="form-message" role="status">Loading your latest profile…</p>}
    <fieldset disabled={!resolved}>
      {FIELDS.map((field) => <label key={field.key}>{field.label}
        {field.multiline
          ? <textarea rows={5} maxLength={field.maxLength} value={draft[field.key]} onChange={(event) => update(field.key, event.target.value)} />
          : <input type={field.key === "picture" || field.key === "banner" || field.key === "website" ? "url" : "text"} inputMode={field.key === "picture" || field.key === "banner" || field.key === "website" ? "url" : undefined} placeholder={field.placeholder} maxLength={field.maxLength} value={draft[field.key]} onChange={(event) => update(field.key, event.target.value)} />}
      </label>)}
      <div className="profile-editor-actions"><span>Blank fields are removed.</span><button className="primary-button compact" type="submit" disabled={saving || !resolved}>{saving ? "Saving…" : "Save profile"}</button></div>
    </fieldset>
    {loadError && <button className="secondary-button compact" type="button" onClick={() => setLoadRevision((revision) => revision + 1)}>Retry loading profile</button>}
    {message && <p className={`form-message ${error ? "is-error" : ""}`} role={error ? "alert" : "status"}>{message}</p>}
  </form>;
}
