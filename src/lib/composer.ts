import * as nip19 from "nostr-tools/nip19";
import type { LocalPerson } from "./local-search";

export interface EmojiEntry {
  emoji: string;
  shortcode: string;
  keywords: string[];
}

export const EMOJI_LIBRARY: EmojiEntry[] = [
  ["😀", "grinning", ["happy", "smile"]], ["😃", "smiley", ["happy", "smile"]],
  ["😄", "smile", ["happy", "joy"]], ["😁", "grin", ["happy", "teeth"]],
  ["😂", "joy", ["laugh", "tears"]], ["🤣", "rofl", ["laugh", "floor"]],
  ["😊", "blush", ["happy", "smile"]], ["😍", "heart_eyes", ["love", "crush"]],
  ["🥰", "smiling_hearts", ["love", "affection"]], ["😘", "kissing_heart", ["kiss", "love"]],
  ["😎", "sunglasses", ["cool", "summer"]], ["🤩", "star_struck", ["wow", "excited"]],
  ["🤔", "thinking", ["hmm", "consider"]], ["🫡", "salute", ["respect", "yes"]],
  ["🫠", "melting", ["hot", "awkward"]], ["🥳", "partying", ["celebrate", "birthday"]],
  ["😢", "cry", ["sad", "tear"]], ["😭", "sob", ["sad", "cry"]],
  ["😡", "angry", ["mad", "rage"]], ["🤯", "mind_blown", ["wow", "shocked"]],
  ["👍", "thumbsup", ["like", "yes", "+1"]], ["👎", "thumbsdown", ["dislike", "no", "-1"]],
  ["👏", "clap", ["applause", "bravo"]], ["🙌", "raised_hands", ["hooray", "celebrate"]],
  ["🤝", "handshake", ["deal", "agreement"]], ["🙏", "pray", ["please", "thanks"]],
  ["💪", "muscle", ["strong", "flex"]], ["👀", "eyes", ["look", "watch"]],
  ["🧠", "brain", ["think", "smart"]], ["🫶", "heart_hands", ["love", "care"]],
  ["❤️", "heart", ["love", "red"]], ["🧡", "orange_heart", ["love"]],
  ["💛", "yellow_heart", ["love"]], ["💚", "green_heart", ["love"]],
  ["💙", "blue_heart", ["love"]], ["💜", "purple_heart", ["love"]],
  ["🖤", "black_heart", ["love"]], ["💔", "broken_heart", ["sad", "love"]],
  ["🔥", "fire", ["hot", "lit"]], ["✨", "sparkles", ["shine", "new"]],
  ["⭐", "star", ["favorite"]], ["💯", "hundred", ["perfect", "score"]],
  ["✅", "white_check_mark", ["done", "yes"]], ["❌", "x", ["no", "wrong"]],
  ["⚡", "zap", ["lightning", "fast"]], ["💡", "bulb", ["idea", "light"]],
  ["🎉", "tada", ["party", "celebrate"]], ["🎂", "birthday", ["cake", "party"]],
  ["🎵", "musical_note", ["music", "song"]], ["🎬", "clapper", ["film", "video"]],
  ["📸", "camera", ["photo", "picture"]], ["📣", "loudspeaker", ["announce", "news"]],
  ["🚀", "rocket", ["launch", "fast"]], ["🌱", "seedling", ["grow", "plant"]],
  ["🌍", "earth", ["world", "globe"]], ["☀️", "sunny", ["weather", "bright"]],
  ["🌙", "moon", ["night"]], ["🌈", "rainbow", ["color", "weather"]],
  ["₿", "bitcoin", ["btc", "money"]], ["🧡", "bitcoin_heart", ["bitcoin", "btc"]],
  ["☕", "coffee", ["drink", "morning"]], ["🍻", "beers", ["drink", "cheers"]],
  ["🍕", "pizza", ["food"]], ["🌮", "taco", ["food"]],
  ["🐶", "dog", ["pet", "puppy"]], ["🐱", "cat", ["pet", "kitten"]],
  ["🦆", "duck", ["bird"]], ["🐝", "bee", ["insect", "honey"]],
].map(([emoji, shortcode, keywords]) => ({ emoji: emoji as string, shortcode: shortcode as string, keywords: keywords as string[] }));

export interface EmojiQuery {
  start: number;
  end: number;
  query: string;
}

export function findEmojiQuery(value: string, cursor: number): EmojiQuery | undefined {
  const prefix = value.slice(0, cursor);
  const match = prefix.match(/(?:^|\s):([a-z0-9_+\-]{1,32})$/i);
  if (!match) return undefined;
  const typed = `:${match[1]}`;
  return { start: cursor - typed.length, end: cursor, query: match[1].toLowerCase() };
}

export function searchEmoji(query: string, limit = 12): EmojiEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return EMOJI_LIBRARY.slice(0, limit);
  return EMOJI_LIBRARY.filter(({ shortcode, keywords }) => shortcode.includes(needle) || keywords.some((word) => word.includes(needle))).slice(0, limit);
}

export function insertText(value: string, start: number, end: number, insertion: string): { value: string; cursor: number } {
  const next = value.slice(0, start) + insertion + value.slice(end);
  return { value: next, cursor: start + insertion.length };
}

export function insertMediaUrl(value: string, start: number, end: number, url: string): { value: string; cursor: number } {
  const before = value.slice(0, start);
  const after = value.slice(end);
  const lead = before && !before.endsWith("\n") ? "\n" : "";
  const trail = after && !after.startsWith("\n") ? "\n" : "";
  return insertText(value, start, end, `${lead}${url}${trail}`);
}

export interface MentionQuery {
  start: number;
  end: number;
  query: string;
}

export interface SelectedMention {
  pubkey: string;
  reference: string;
  label?: string;
}

export function findMentionQuery(value: string, cursor: number): MentionQuery | undefined {
  if (cursor < 0) return undefined;
  const prefix = value.slice(0, cursor);
  const match = prefix.match(/(?:^|\s)@([^\s@]{0,96})$/u);
  if (!match) return undefined;
  const typed = `@${match[1]}`;
  return { start: cursor - typed.length, end: cursor, query: match[1] };
}

export function mentionReference(person: Pick<LocalPerson, "pubkey">, relayHints: string[] = []): string {
  return `nostr:${nip19.nprofileEncode({ pubkey: person.pubkey, relays: [...new Set(relayHints)].slice(0, 4) })}`;
}

export function insertMention(value: string, query: MentionQuery, person: Pick<LocalPerson, "pubkey"> & Partial<Pick<LocalPerson, "name" | "username" | "npub">>, relayHints: string[] = []): { value: string; cursor: number; mention: SelectedMention } {
  const reference = mentionReference(person, relayHints);
  const trailingSpace = value.slice(query.end).startsWith(" ") ? "" : " ";
  const next = insertText(value, query.start, query.end, `${reference}${trailingSpace}`);
  return { ...next, mention: { pubkey: person.pubkey, reference, label: person.name || person.username || person.npub?.slice(0, 16) } };
}

export function activeMentionPubkeys(content: string, mentions: Iterable<SelectedMention>): string[] {
  return [...new Set([...mentions].filter(({ reference }) => content.includes(reference)).map(({ pubkey }) => pubkey.toLowerCase()))];
}

export interface CommonsGif {
  title: string;
  url: string;
  sourceUrl: string;
  width: number;
  height: number;
  size: number;
}

export function commonsGifSearchUrl(query: string): string {
  const params = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: `${query.trim()} filemime:image/gif`,
    gsrnamespace: "6",
    gsrlimit: "24",
    prop: "imageinfo",
    iiprop: "url|mime|size",
    format: "json",
    formatversion: "2",
    origin: "*",
  });
  return `https://commons.wikimedia.org/w/api.php?${params}`;
}

export function parseCommonsGifs(payload: unknown): CommonsGif[] {
  const pages = (payload as { query?: { pages?: unknown[] } })?.query?.pages;
  if (!Array.isArray(pages)) return [];
  return pages.flatMap((page) => {
    const record = page as { title?: unknown; imageinfo?: unknown[] };
    const info = Array.isArray(record.imageinfo) ? record.imageinfo[0] as Record<string, unknown> | undefined : undefined;
    if (!info || info.mime !== "image/gif" || typeof info.url !== "string" || typeof info.descriptionurl !== "string") return [];
    try {
      const url = new URL(info.url);
      const sourceUrl = new URL(info.descriptionurl);
      if (url.protocol !== "https:" || sourceUrl.protocol !== "https:") return [];
    } catch { return []; }
    return [{
      title: typeof record.title === "string" ? record.title.replace(/^File:/, "") : "GIF",
      url: info.url,
      sourceUrl: info.descriptionurl,
      width: typeof info.width === "number" ? info.width : 0,
      height: typeof info.height === "number" ? info.height : 0,
      size: typeof info.size === "number" ? info.size : 0,
    }];
  }).filter(({ size }) => !size || size <= 20_000_000);
}
