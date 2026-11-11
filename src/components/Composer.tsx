import { useRef, useState } from "react";
import type { RelayPool } from "applesauce-relay";
import type { NostrEvent } from "../types";
import { PostPublisher, quoteContent, type QuoteTarget } from "../lib/publish";
import { uploadImage } from "../lib/blossom";
import { EnhancedTextarea } from "./EnhancedTextarea";
import { activeMentionPubkeys, type SelectedMention } from "../lib/composer";
import { Avatar, useProfile } from "./Avatar";
import { parseContent } from "../lib/content";

interface ComposerProps {
  writeRelays: string[];
  pool: Pick<RelayPool, "publish">;
  blossomServers: string[];
  readRelays?: string[];
  quote?: QuoteTarget;
  onPublished(event: NostrEvent): void;
  onComplete?(): void;
  onCancel?(): void;
}

function QuotePreview({ quote, onCancel }: { quote: QuoteTarget; onCancel?(): void }) {
  const profile = useProfile(quote.event.pubkey);
  const preview = parseContent(quote.event.content, quote.event.tags).text || "Quoted note";
  return <aside className="quote-preview" aria-label={`Quoting ${profile.name}`}><Avatar pubkey={quote.event.pubkey} size="small" /><span><strong>{profile.name}</strong><span>{preview}</span></span>{onCancel && <button type="button" onClick={onCancel} aria-label="Cancel quote">×</button>}</aside>;
}

export function Composer({ writeRelays, readRelays = [], pool, blossomServers, quote, onPublished, onComplete, onCancel }: ComposerProps) {
  const publisher = useRef(new PostPublisher());
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [uploading, setUploading] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [images, setImages] = useState<{ name: string; url: string }[]>([]);
  const [mentions, setMentions] = useState<SelectedMention[]>([]);
  const draftContent = [content.trim(), ...images.map(({ url }) => url)].filter(Boolean).join("\n");
  const finalContent = quoteContent(draftContent, quote);
  const remaining = 2_800 - finalContent.length;
  const composerId = quote ? `quote-${quote.event.id}` : "quick-post";

  async function addImages(files: FileList | null) {
    if (!files?.length || uploading) return;
    const selected = [...files].slice(0, Math.max(0, 4 - images.length));
    setUploading(true);
    setMessage(undefined);
    try {
      const uploaded: { name: string; url: string }[] = [];
      for (const file of selected) {
        const descriptor = await uploadImage(file, blossomServers);
        uploaded.push({ name: file.name, url: descriptor.url });
      }
      setImages((current) => [...current, ...uploaded]);
      setMessage(`${uploaded.length} image${uploaded.length === 1 ? "" : "s"} uploaded.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The image could not be uploaded.");
    } finally {
      setUploading(false);
    }
  }

  async function submit() {
    if (busy) return;
    setBusy(true);
    setMessage(undefined);
    try {
      const result = await publisher.current.publish(draftContent, writeRelays, pool, { quote, mentionedPubkeys: activeMentionPubkeys(content, mentions) });
      if (result.status === "failed") throw new Error("No relay accepted the post. Your draft is still here.");
      onPublished(result.event);
      setContent("");
      setImages([]);
      setMentions([]);
      const relayWord = result.accepted.length === 1 ? "relay" : "relays";
      setMessage(result.status === "partial" ? `Posted to ${result.accepted.length} ${relayWord}; some relays were unavailable.` : `Posted to ${result.accepted.length} ${relayWord}.`);
      onComplete?.();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The post could not be published.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="composer" aria-labelledby={`${composerId}-title`}>
      <label id={`${composerId}-title`} htmlFor={composerId}>{quote ? "Add your take" : "What’s moving?"}</label>
      {quote && <QuotePreview quote={quote} onCancel={onCancel} />}
      <EnhancedTextarea id={composerId} value={content} mentions={mentions} maxLength={2_800} rows={3} placeholder={quote ? "Add a comment (optional)…" : "Share a note with Nostr…"} onChange={setContent} disabled={busy} blossomServers={blossomServers} relayHints={readRelays} onMentionSelected={(mention) => setMentions((current) => [...current.filter(({ pubkey }) => pubkey !== mention.pubkey), mention])} onUploadingChange={setPasting} />
      <div className="composer-tools">
        <label className="upload-button">{uploading ? "Uploading…" : "Add images"}<input type="file" accept="image/*" multiple disabled={uploading || images.length >= 4} onChange={(event) => { void addImages(event.target.files); event.currentTarget.value = ""; }} /></label>
        <span>{images.length}/4</span>
      </div>
      {images.length > 0 && <div className="upload-list">{images.map((image) => <div key={image.url}><span>{image.name}</span><button type="button" aria-label={`Remove ${image.name}`} onClick={() => setImages((current) => current.filter(({ url }) => url !== image.url))}>×</button></div>)}</div>}
      <div className="composer-footer">
        <span className={remaining < 100 ? "count is-low" : "count"}>{remaining}</span>
        <button className="primary-button compact" onClick={submit} disabled={busy || uploading || pasting || !finalContent || remaining < 0}>{busy ? "Publishing…" : pasting ? "Uploading image…" : quote ? "Publish quote" : "Post note"}</button>
      </div>
      {message && <p className="form-message" role="status">{message}</p>}
    </section>
  );
}

