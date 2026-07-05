import { api } from "./api";
import { copyTextToClipboard } from "./clipboard";
import type { BrowseItem, StreamResult } from "./types";

/**
 * TorBox-only downloads for friends: resolve a CDN URL via the host API key,
 * then open it in the browser. No file bytes are streamed from the Movie Night PC.
 */

function openTorboxDownloadUrl(url: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function resolveStreamTorboxUrl(stream: StreamResult): Promise<string> {
  const res = await api.torboxDownloadLink({
    url: stream.url,
    magnet: stream.magnet,
    info_hash: stream.info_hash,
    file_idx: stream.file_idx ?? undefined,
    filename: stream.filename,
    name: stream.name,
    description: stream.description,
    cached: stream.cached,
    size_bytes: stream.size_bytes || undefined,
  });
  return res.url;
}

export async function saveStreamToPc(stream: StreamResult): Promise<void> {
  const url = await resolveStreamTorboxUrl(stream);
  openTorboxDownloadUrl(url);
}

export async function saveLibraryItemToPc(itemId: number): Promise<void> {
  const res = await api.torboxLibraryDownloadLink(itemId);
  openTorboxDownloadUrl(res.url);
}

export async function saveBrowseTorboxItemToPc(item: BrowseItem): Promise<void> {
  const res = await api.torboxBrowseDownloadLink({
    stremio_id: item.stremio_id,
    title: item.title,
    type: item.type,
    overview: item.overview,
  });
  openTorboxDownloadUrl(res.url);
}

export async function copyStreamDownloadLink(stream: StreamResult): Promise<string> {
  const url = await resolveStreamTorboxUrl(stream);
  await copyTextToClipboard(url);
  return url;
}

export function canLocalDownload(user: { allow_local_download?: boolean }): boolean {
  return !!user.allow_local_download;
}
