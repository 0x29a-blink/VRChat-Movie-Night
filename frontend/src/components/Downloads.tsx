import { ChevronDown, ChevronRight, LayoutGrid, Link2, Loader2, Search as SearchIcon, Sparkles, Youtube } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import type { Job, UserInfo } from "../types";
import { canLocalDownload } from "../localDownload";
import type { StreamLaunch } from "../streamOpenUrl";
import { readNavFromLocation, writeNavToLocation, type AddSource } from "../appNav";
import { ConfirmModal } from "./ConfirmModal";
import { DownloadJobCard } from "./DownloadJobCard";
import { Search } from "./Search";

// Plan 026 (Add Media flatten): a single flat, URL-addressable source picker
// replaces the old 4-level nesting (tab -> TABS -> Search mode -> Browse
// source). Downloads.tsx is now the coordinator: it renders the picker and
// routes to the right child, keeping Search.tsx/Browse.tsx internals intact.
const SOURCES: { id: AddSource; label: string; icon: typeof Youtube }[] = [
  { id: "search", label: "Search", icon: SearchIcon },
  { id: "browse", label: "Browse", icon: LayoutGrid },
  { id: "anime", label: "Anime", icon: Sparkles },
  { id: "youtube", label: "YouTube / URL", icon: Youtube },
  { id: "m3u8", label: "M3U8", icon: Link2 },
];

const ACTIVE_STATUSES = new Set<Job["status"]>(["queued", "caching", "downloading"]);

export function Downloads({
  jobs,
  onChanged,
  onJobRemoved,
  initialStreamLaunch,
  onInitialStreamOpenHandled,
  user,
}: {
  jobs: Job[];
  onChanged: () => void;
  onJobRemoved?: (id: string) => void;
  initialStreamLaunch?: StreamLaunch | null;
  onInitialStreamOpenHandled?: () => void;
  user: UserInfo;
}) {
  const [source, setSource] = useState<AddSource>(
    () => (initialStreamLaunch ? "search" : readNavFromLocation().addSource ?? "youtube")
  );
  const [historyOpen, setHistoryOpen] = useState(false);
  const [clearing, setClearing] = useState<"completed" | "failed" | null>(null);
  const [clearBusy, setClearBusy] = useState(false);

  useEffect(() => {
    if (initialStreamLaunch) setSource("search");
  }, [initialStreamLaunch]);

  const selectSource = (next: AddSource) => {
    setSource(next);
    writeNavToLocation({ tab: "add", addSource: next });
  };

  const active = jobs.filter((j) => ACTIVE_STATUSES.has(j.status));
  const finished = jobs.filter((j) => !ACTIVE_STATUSES.has(j.status));
  const hasCompleted = finished.some((j) => j.status === "completed");
  const hasFailed = finished.some((j) => j.status === "failed");

  const doClear = async (statuses: string[]) => {
    setClearBusy(true);
    try {
      const res = await api.clearDownloads(statuses);
      for (const id of res.removed) onJobRemoved?.(id);
      onChanged();
    } finally {
      setClearBusy(false);
      setClearing(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Add Media</h1>
        <p className="mt-1 text-sm text-slate-400">
          Grab videos at maximum quality. Everything lands in your Library.
        </p>
      </div>

      <div className="card overflow-x-auto overflow-y-visible">
        <div className="flex flex-wrap border-b border-white/5">
          {SOURCES.map((s) => {
            const Icon = s.icon;
            const active = source === s.id;
            return (
              <button
                key={s.id}
                onClick={() => selectSource(s.id)}
                aria-current={active ? "page" : undefined}
                className={`flex grow basis-[30%] items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors sm:basis-0 sm:flex-1 ${
                  active ? "bg-white/5 text-white" : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <Icon className="h-4 w-4" />
                {s.label}
              </button>
            );
          })}
        </div>
        <div className="p-5">
          {source === "youtube" && <SimpleForm kind="youtube" onDone={onChanged} />}
          {source === "m3u8" && <SimpleForm kind="m3u8" onDone={onChanged} />}
          {source === "search" && (
            <Search
              key="search"
              initialMode="search"
              initialStreamLaunch={initialStreamLaunch}
              onInitialStreamOpenHandled={onInitialStreamOpenHandled}
              allowLocalDownload={canLocalDownload(user)}
            />
          )}
          {source === "browse" && (
            <Search
              key="browse"
              initialMode="browse"
              hideSourceToggle
              browseSource="collections"
              allowLocalDownload={canLocalDownload(user)}
            />
          )}
          {source === "anime" && (
            <Search
              key="anime"
              initialMode="browse"
              hideSourceToggle
              browseSource="aiostreams"
              autoOpenAnime
              allowLocalDownload={canLocalDownload(user)}
            />
          )}
        </div>
      </div>

      {active.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Active</h2>
          {active.map((j) => (
            <DownloadJobCard key={j.id} job={j} onRemoved={onJobRemoved} />
          ))}
        </section>
      )}

      {finished.length > 0 && (
        <section className="space-y-3">
          <button
            type="button"
            onClick={() => setHistoryOpen((v) => !v)}
            className="flex w-full items-center justify-between gap-2 text-left"
            aria-expanded={historyOpen}
          >
            <span className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-slate-400">
              {historyOpen ? (
                <ChevronDown className="h-3.5 w-3.5 shrink-0" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 shrink-0" />
              )}
              History ({finished.length})
            </span>
          </button>
          {historyOpen && (
            <>
              <div className="flex justify-end gap-2">
                {hasCompleted && (
                  <button
                    onClick={() => setClearing("completed")}
                    className="btn-ghost px-2 py-1 text-xs"
                  >
                    Clear completed
                  </button>
                )}
                {hasFailed && (
                  <button
                    onClick={() => setClearing("failed")}
                    className="btn-ghost px-2 py-1 text-xs"
                  >
                    Clear failed
                  </button>
                )}
              </div>
              {finished.map((j) => (
                <DownloadJobCard key={j.id} job={j} onRemoved={onJobRemoved} />
              ))}
            </>
          )}
        </section>
      )}

      <ConfirmModal
        open={clearing !== null}
        title={clearing === "completed" ? "Clear completed downloads?" : "Clear failed downloads?"}
        message={
          clearing === "completed"
            ? "This removes all completed downloads from history. Files already saved to your library are not affected."
            : "This removes all failed downloads from history."
        }
        confirmLabel="Clear"
        danger
        busy={clearBusy}
        onConfirm={() => clearing && doClear([clearing])}
        onCancel={() => setClearing(null)}
      />
    </div>
  );
}

function SimpleForm({ kind, onDone }: { kind: "youtube" | "m3u8"; onDone: () => void }) {
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [referer, setReferer] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    setMsg("");
    try {
      if (kind === "youtube") await api.ytDownload(url.trim());
      else await api.m3u8Download(url.trim(), name.trim(), referer.trim());
      setUrl("");
      setName("");
      setReferer("");
      setMsg("Added to download queue.");
      onDone();
    } catch (err: any) {
      setMsg(err.message || "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder={kind === "youtube" ? "https://youtube.com/watch?v=…" : "https://…/index.m3u8"}
        className="input"
      />
      {kind === "m3u8" && (
        <>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Movie name (recommended — becomes the file name)"
            className="input"
          />
          <input
            value={referer}
            onChange={(e) => setReferer(e.target.value)}
            placeholder="Referer (optional, some sites require it)"
            className="input"
          />
        </>
      )}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy || !url.trim()} className="btn-primary">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Download max quality"}
        </button>
        {msg && <span className="text-xs text-slate-400">{msg}</span>}
      </div>
    </form>
  );
}
