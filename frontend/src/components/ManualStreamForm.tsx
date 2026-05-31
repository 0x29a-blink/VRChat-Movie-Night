import { Check, Download, Link2, Loader2 } from "lucide-react";
import { useState } from "react";
import { api } from "../api";
import type { DownloadLinkMeta } from "../types";

export function ManualStreamForm({
  title,
  link,
  onError,
  onQueued,
}: {
  title: string;
  link?: DownloadLinkMeta;
  onError?: (msg: string) => void;
  onQueued?: () => void;
}) {
  const [url, setUrl] = useState("");
  const [referer, setReferer] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setDone(false);
    try {
      await api.m3u8Download(trimmed, title, referer.trim(), link);
      setDone(true);
      onQueued?.();
    } catch (err: unknown) {
      onError?.(err instanceof Error ? err.message : "Download failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-white">
        <Link2 className="h-4 w-4 text-brand-400" />
        Manual M3U8 / stream URL
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Paste a direct stream link if it is not in the list above. TMDB metadata links when the download finishes.
      </p>
      <form onSubmit={submit} className="mt-3 space-y-2">
        <input
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setDone(false);
          }}
          placeholder="https://…/index.m3u8"
          className="input text-sm"
        />
        <input
          value={referer}
          onChange={(e) => setReferer(e.target.value)}
          placeholder="Referer (optional)"
          className="input text-sm"
        />
        <button
          type="submit"
          disabled={busy || !url.trim()}
          className={`w-full ${done ? "btn-ghost text-emerald-300" : "btn-primary"}`}
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : done ? (
            <Check className="h-4 w-4" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          {done ? "Queued — will link to this title" : "Download stream"}
        </button>
      </form>
    </div>
  );
}
