import { useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { profileShareIdentity } from "../lib/profile-share";
import { Modal } from "./Modal";
import { profileUrl } from "../lib/routes";

export function ProfileShare({ pubkey, name, onClose }: { pubkey: string; name: string; onClose(): void }) {
  const identity = useMemo(() => profileShareIdentity(pubkey), [pubkey]);
  const [message, setMessage] = useState<string>();
  const canopyUrl = useMemo(() => profileUrl(window.location.origin, pubkey), [pubkey]);

  async function copyNpub() {
    try {
      await navigator.clipboard.writeText(identity.npub);
      setMessage("Npub copied.");
    } catch {
      setMessage("Copy was blocked. Press and hold the npub to copy it manually.");
    }
  }

  async function copyCanopyUrl() {
    try {
      await navigator.clipboard.writeText(canopyUrl);
      setMessage("Canopy link copied.");
    } catch {
      setMessage("Copy was blocked. Press and hold the Canopy link to copy it manually.");
    }
  }

  return <Modal title={`Share ${name}`} onClose={onClose}>
    <div className="profile-share">
      <p>Scan this code in a Nostr client to open {name}’s profile and follow them.</p>
      <div className="profile-qr" data-qr-value={identity.nostrUri}>
        <QRCodeSVG value={identity.nostrUri} size={232} level="M" marginSize={4} bgColor="#ffffff" fgColor="#07110b" title={`${name} Nostr profile`} />
      </div>
      <label>Public Nostr identity
        <output aria-label={`${name} npub`}>{identity.npub}</output>
      </label>
      <div className="profile-share-actions">
        <button className="secondary-button" type="button" onClick={copyNpub}>Copy npub</button>
        <a className="primary-button compact" href={identity.nostrUri}>Open in Nostr app</a>
      </div>
      <label>Canopy profile link
        <a className="canopy-share-url" href={canopyUrl}>{canopyUrl}</a>
      </label>
      <div className="profile-share-actions">
        <button className="secondary-button" type="button" onClick={copyCanopyUrl}>Copy Canopy link</button>
        <a className="primary-button compact" href={canopyUrl}>Open in Canopy</a>
      </div>
      {message && <p className="form-message" role="status">{message}</p>}
    </div>
  </Modal>;
}
