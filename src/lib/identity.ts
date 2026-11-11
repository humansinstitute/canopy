import { publishUntilAccepted } from "./relay-publish";
import type { RelayPool } from "applesauce-relay";
import type { EventTemplate } from "nostr-tools";
import type { NostrEvent, NostrProvider } from "../types";

export const CONTACT_LIST_KIND = 3;
export const PROFILE_KIND = 0;

const HEX_64 = /^[0-9a-f]{64}$/i;
const MANAGED_PROFILE_FIELDS = ["display_name", "name", "about", "picture", "banner", "website", "nip05", "lud16"] as const;

export type ManagedProfileField = typeof MANAGED_PROFILE_FIELDS[number];
export type ProfileDraft = Record<ManagedProfileField, string>;

const FIELD_LIMITS: Record<ManagedProfileField, number> = {
  display_name: 80,
  name: 50,
  about: 5_000,
  picture: 2_048,
  banner: 2_048,
  website: 2_048,
  nip05: 320,
  lud16: 320,
};

export function isFollowing(event: NostrEvent | undefined, pubkey: string): boolean {
  return Boolean(event?.kind === CONTACT_LIST_KIND && event.tags.some((tag) => tag[0] === "p" && tag[1] === pubkey));
}

export function updateContactListTemplate(
  current: NostrEvent | undefined,
  targetPubkey: string,
  following: boolean,
  now = Math.floor(Date.now() / 1000),
): EventTemplate {
  if (!HEX_64.test(targetPubkey)) throw new Error("This profile has an invalid public key.");
  const tags = (current?.tags ?? []).map((tag) => [...tag]);
  const alreadyFollowing = tags.some((tag) => tag[0] === "p" && tag[1] === targetPubkey);
  const nextTags = following
    ? alreadyFollowing ? tags : [...tags, ["p", targetPubkey]]
    : tags.filter((tag) => !(tag[0] === "p" && tag[1] === targetPubkey));
  return {
    kind: CONTACT_LIST_KIND,
    created_at: Math.max(now, (current?.created_at ?? 0) + 1),
    tags: nextTags,
    content: current?.content ?? "",
  };
}

export interface ContactMutationResult {
  following: boolean;
  status: "published" | "partial";
  accepted: number;
  rejected: number;
  event: NostrEvent;
}

export class ContactListController {
  private current?: NostrEvent;
  private resolved = false;
  private queue = Promise.resolve();

  constructor(
    private readonly sign: NostrProvider["signEvent"],
    private readonly publish: Pick<RelayPool, "publish">,
    private readonly writeRelays: string[],
    private readonly loadLatest: () => Promise<NostrEvent | undefined>,
    private readonly onPublished: (event: NostrEvent) => void,
  ) {}

  setRemote(event: NostrEvent | undefined): void {
    if (!event) return;
    if (!this.current || event.created_at > this.current.created_at || (event.created_at === this.current.created_at && event.id < this.current.id)) this.current = event;
  }

  setFollowing(targetPubkey: string, following: boolean): Promise<ContactMutationResult> {
    const operation = this.queue.then(async () => {
      if (!this.resolved) {
        this.setRemote(await this.loadLatest());
        this.resolved = true;
      }
      const template = updateContactListTemplate(this.current, targetPubkey, following);
      const signed = await this.sign(template);
      const results = await publishUntilAccepted(this.publish, this.writeRelays, signed);
      const accepted = results.filter(({ ok }) => ok).length;
      if (!accepted) throw new Error(following ? "Follow could not be published." : "Unfollow could not be published.");
      this.current = signed;
      this.onPublished(signed);
      return {
        following,
        status: accepted === results.length ? "published" as const : "partial" as const,
        accepted,
        rejected: results.length - accepted,
        event: signed,
      };
    });
    this.queue = operation.then(() => undefined, () => undefined);
    return operation;
  }
}

export function parseProfileMetadata(event: NostrEvent | undefined): Record<string, unknown> {
  if (!event || event.kind !== PROFILE_KIND) return {};
  try {
    const parsed: unknown = JSON.parse(event.content);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function profileDraft(event: NostrEvent | undefined): ProfileDraft {
  const metadata = parseProfileMetadata(event);
  return Object.fromEntries(MANAGED_PROFILE_FIELDS.map((field) => [field, typeof metadata[field] === "string" ? metadata[field] : ""])) as ProfileDraft;
}

function validateHttpsUrl(label: string, value: string): void {
  if (!value) return;
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`${label} must be a valid HTTPS URL.`); }
  if (url.protocol !== "https:") throw new Error(`${label} must use HTTPS.`);
}

export function mergeProfileMetadata(previous: NostrEvent | undefined, draft: ProfileDraft): Record<string, unknown> {
  const merged = { ...parseProfileMetadata(previous) };
  for (const field of MANAGED_PROFILE_FIELDS) {
    const value = draft[field].trim();
    if (value.length > FIELD_LIMITS[field]) throw new Error(`${field.replace("_", " ")} is too long.`);
    if (value) merged[field] = value;
    else delete merged[field];
  }
  validateHttpsUrl("Picture", String(merged.picture ?? ""));
  validateHttpsUrl("Banner", String(merged.banner ?? ""));
  validateHttpsUrl("Website", String(merged.website ?? ""));
  for (const [field, label] of [["nip05", "NIP-05 address"], ["lud16", "Lightning address"]] as const) {
    const value = String(merged[field] ?? "");
    if (value && (!/^[^@\s]+@[^@\s]+$/.test(value) || value.includes("/"))) throw new Error(`${label} must look like name@example.com.`);
  }
  return merged;
}

export function profileEventTemplate(previous: NostrEvent | undefined, draft: ProfileDraft, now = Math.floor(Date.now() / 1000)): EventTemplate {
  return {
    kind: PROFILE_KIND,
    created_at: Math.max(now, (previous?.created_at ?? 0) + 1),
    tags: [],
    content: JSON.stringify(mergeProfileMetadata(previous, draft)),
  };
}

export interface ProfilePublishResult {
  status: "published" | "partial";
  accepted: number;
  rejected: number;
  event: NostrEvent;
}

export class ProfilePublisher {
  private saving = false;

  constructor(
    private readonly sign: NostrProvider["signEvent"],
    private readonly publish: Pick<RelayPool, "publish">,
    private readonly writeRelays: string[],
    private readonly onPublished: (event: NostrEvent) => void,
  ) {}

  async save(previous: NostrEvent | undefined, draft: ProfileDraft): Promise<ProfilePublishResult> {
    if (this.saving) throw new Error("Your profile is already being saved.");
    this.saving = true;
    try {
      const signed = await this.sign(profileEventTemplate(previous, draft));
      const results = await publishUntilAccepted(this.publish, this.writeRelays, signed);
      const accepted = results.filter(({ ok }) => ok).length;
      if (!accepted) throw new Error("No relay accepted your profile. Your edits are still here.");
      this.onPublished(signed);
      return { status: accepted === results.length ? "published" : "partial", accepted, rejected: results.length - accepted, event: signed };
    } finally {
      this.saving = false;
    }
  }
}
