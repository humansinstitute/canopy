import { useEffect, useState } from "react";
import { subscribeProfile } from "../lib/nostr";
import { compactPubkey, safeHttpUrl } from "../lib/content";

export interface ProfileView {
  name: string;
  picture: string | null;
}

export function profileDisplayName(profile: Record<string, unknown> | undefined, pubkey: string): string {
  for (const value of [profile?.display_name, profile?.displayName, profile?.name]) {
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 80);
  }
  return compactPubkey(pubkey);
}

export function useProfile(pubkey: string): ProfileView {
  const [profile, setProfile] = useState<Record<string, unknown>>();
  useEffect(() => {
    const sub = subscribeProfile(pubkey, setProfile);
    return () => sub.unsubscribe();
  }, [pubkey]);

  const rawPicture = profile?.picture;
  return {
    name: profileDisplayName(profile, pubkey),
    picture: typeof rawPicture === "string" ? safeHttpUrl(rawPicture) : null,
  };
}

export function Avatar({ pubkey, size = "normal" }: { pubkey: string; size?: "normal" | "small" }) {
  const profile = useProfile(pubkey);
  const [failed, setFailed] = useState(false);
  const initials = profile.name.slice(0, 2).toUpperCase();
  return (
    <div className={`avatar avatar--${size}`} aria-hidden="true">
      {profile.picture && !failed ? <img src={profile.picture} alt="" onError={() => setFailed(true)} loading="lazy" /> : initials}
    </div>
  );
}

