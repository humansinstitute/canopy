export const MAX_BLOSSOM_SERVERS = 8;

/** Preserve server paths; credentials, query tokens and fragments are not server URLs. */
export function normalizeProfileServer(value: string): string {
  const raw = value.trim();
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("Use a full HTTPS server URL."); }
  if (raw.length > 2048 || !/^https:\/\//i.test(raw) || /\s|\\/.test(raw) || url.protocol !== "https:" || !url.hostname || url.username || url.password || url.port === "0" || url.search || url.hash) {
    throw new Error("Use HTTPS server URLs without credentials, query strings or fragments.");
  }
  return url.toString().replace(/\/+$/, "");
}

export function validateProfileServers(values: string[]): string[] {
  if (!values.length || values.length > MAX_BLOSSOM_SERVERS) throw new Error("BUD-03 requires 1–8 servers. Empty published lists are not supported.");
  const servers = values.map(normalizeProfileServer);
  if (new Set(servers).size !== servers.length) throw new Error("Remove duplicate server URLs.");
  return servers;
}
