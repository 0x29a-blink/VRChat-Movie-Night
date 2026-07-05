import { Film, Link2, Loader2, Youtube } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import type { Job, UserInfo } from "../types";
import { canLocalDownload } from "../localDownload";
import type { StreamLaunch } from "../streamOpenUrl";
import { ConfirmModal } from "./ConfirmModal";
import { DownloadJobCard } from "./DownloadJobCard";
import { Search } from "./Search";

type Tab = "youtube" | "m3u8" | "search";

const TABS: { id: Tab; label: string; icon: typeof Youtube }[] = [
  { id: "youtube", label: "YouTube", icon: Youtube },
  { id: "m3u8", label: "M3U8 / Stream", icon: Link2 },
  { id: "search", label: "Movies & Shows", icon: Film },
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
  const [tab, setTab] = useState<Tab>(() => (initialStreamLaunch ? "search" : "youtube"));
  const [clearing, setClearing] = useState<"completed" | "failed" | null>(null);
  const [clearBusy, setClearBusy] = useState(false);

  useEffect(() => {
    if (initialStreamLaunch) setTab("search");
  }, [initialStreamLaunch]);

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
        <h1 className="text-2xl font-semibold">Downloads</h1>
        <p className="mt-1 text-sm text-slate-400">
          Grab videos at maximum quality. Everything lands in your Library.
        </p>
      </div>

      <div className="card overflow-x-auto overflow-y-visible">
        <div className="flex border-b border-white/5">
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex flex-1 items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
                  tab === t.id ? "bg-white/5 text-white" : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <Icon className="h-4 w-4" />
                {t.label}
              </button>
            );
          })}
        </div>
        <div className="p-5">
          {tab === "youtube" && <SimpleForm kind="youtube" onDone={onChanged} />}
          {tab === "m3u8" && <SimpleForm kind="m3u8" onDone={onChanged} />}
          {tab === "search" && (
            <Search
              initialStreamLaunch={initialStreamLaunch}
              onInitialStreamOpenHandled={onInitialStreamOpenHandled}
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
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">History</h2>
            <div className="flex gap-2">
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
          </div>
          {finished.map((j) => (
            <DownloadJobCard key={j.id} job={j} onRemoved={onJobRemoved} />
          ))}
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
