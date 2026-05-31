import { api } from "./api";

/** VRChat HLS URL for the OBS → MediaMTX stream (port 8888, not the web app on 8000). */
export function buildHlsUrl(host?: string): string {
  const h = host ?? (typeof window !== "undefined" ? window.location.hostname : "localhost");
  if (h === "localhost" || h === "127.0.0.1") {
    return `http://${h}:8888/live/vrstream/index.m3u8`;
  }
  return `http://${h}:8888/live/vrstream/index.m3u8`;
}

/** Prefer server-resolved URL (LAN/public IP override or Host header). */
export async function resolveHlsUrl(): Promise<string> {
  try {
    const r = await api.hlsUrl();
    if (r.url) return r.url;
  } catch {
    /* fall back */
  }
  return buildHlsUrl();
}

export async function copyHlsUrl(): Promise<string> {
  const url = await resolveHlsUrl();
  await navigator.clipboard.writeText(url);
  return url;
}
