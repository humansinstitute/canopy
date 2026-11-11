const URL_RE = /https?:\/\/[^\s<>"']+/gi;
const IMAGE_EXT_RE = /\.(?:avif|gif|jpe?g|png|webp)(?:$|[?#])/i;
const VIDEO_EXT_RE = /\.(?:m4v|mov|mp4|ogv|webm)(?:$|[?#])/i;
const MAX_CONTENT = 12_000;
const MAX_MEDIA = 6;
const LONG_POST_CHARACTER_THRESHOLD = 480;
const LONG_POST_LINE_THRESHOLD = 8;

export interface ParsedContent {
  text: string;
  links: string[];
  images: string[];
  videos: string[];
}

export function safeHttpUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function parseContent(content: string, tags: string[][] = []): ParsedContent {
  const bounded = content.slice(0, MAX_CONTENT);
  const candidates = bounded.match(URL_RE) ?? [];
  const safe = candidates.map(safeHttpUrl).filter((url): url is string => Boolean(url));
  const taggedMedia = tags.flatMap((tag) => {
    if (tag[0] !== "imeta") return [];
    const mime = tag.find((value) => /^m\s+/i.test(value))?.replace(/^m\s+/i, "").toLowerCase();
    const raw = tag.find((value) => /^url\s+/i.test(value))?.replace(/^url\s+/i, "");
    const url = raw && safeHttpUrl(raw);
    if (!url || (!mime?.startsWith("image/") && !mime?.startsWith("video/"))) return [];
    return [{ kind: mime.startsWith("image/") ? "image" as const : "video" as const, url }];
  });
  const taggedImages = taggedMedia.filter(({ kind }) => kind === "image").map(({ url }) => url);
  const taggedVideos = taggedMedia.filter(({ kind }) => kind === "video").map(({ url }) => url);
  const images = [...new Set([...safe.filter((url) => IMAGE_EXT_RE.test(url)), ...taggedImages])].filter((url) => !taggedVideos.includes(url)).slice(0, MAX_MEDIA);
  const videos = [...new Set([...safe.filter((url) => VIDEO_EXT_RE.test(url)), ...taggedVideos])].filter((url) => !taggedImages.includes(url)).slice(0, MAX_MEDIA);
  const media = new Set([...images, ...videos]);
  const links = [...new Set(safe.filter((url) => !media.has(url)))].slice(0, 12);
  const text = bounded.replace(URL_RE, (url) => (media.has(safeHttpUrl(url) ?? "") ? "" : url)).replace(/\n{3,}/g, "\n\n").trim();
  return { text, links, images, videos };
}

export function shouldCollapsePost(text: string): boolean {
  return text.length > LONG_POST_CHARACTER_THRESHOLD || text.split("\n").length > LONG_POST_LINE_THRESHOLD;
}

export function compactPubkey(pubkey: string): string {
  return pubkey.length > 16 ? `${pubkey.slice(0, 8)}…${pubkey.slice(-6)}` : pubkey;
}

