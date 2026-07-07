import { openUrl } from "@tauri-apps/plugin-opener";

/**
 * Open a URL only if it is a safe https:// or http:// link.
 * Plain http:// is intentionally allowed for connector docs links: the catalog
 * originates from our own backend API (localhost), not untrusted external input,
 * and opening a docs page in the system browser over http is not a meaningful
 * attack vector for a local desktop app. If the catalog source ever changes to
 * an untrusted third party, restrict this to ^https:\/\/ only.
 */
export function safeOpenUrl(url: string): void {
  if (/^https?:\/\//i.test(url)) openUrl(url);
}

export function generateSlug(name: string, existingIds: Set<string>): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63) || "custom";

  if (!existingIds.has(base)) return base;
  for (let i = 2; i <= 99; i++) {
    const candidate = `${base}-${i}`.slice(0, 63);
    if (!existingIds.has(candidate)) return candidate;
  }
  return "";
}
