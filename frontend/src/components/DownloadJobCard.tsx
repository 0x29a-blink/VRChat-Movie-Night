import { CheckCircle2, ChevronDown, Loader2, RotateCw, Trash2, X, XCircle, Youtube } from "lucide-react";
import { Film, Link2 } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { api } from "../api";
import { fmtBytes } from "../format";
import type { Job } from "../types";

const RETRY_MODES: { mode: "auto" | "direct" | "hls" | "ytdlp"; label: string }[] = [
  { mode: "auto", label: "Restart" },
  { mode: "direct", label: "Retry as direct" },
  { mode: "hls", label: "Retry as HLS" },
  { mode: "ytdlp", label: "Retry as yt-dlp" },
];

const TYPE_ICON = { youtube: Youtube, m3u8: Link2, torrent: Film };

const STATUS_STYLE: Record<string, string> = {
  downloading: "text-brand-300",
  caching: "text-amber-300",
  queued: "text-slate-400",
  completed: "text-emerald-300",
  failed: "text-red-300",
  cancelled: "text-amber-300",
};

const STATUS_ICON: Partial<Record<Job["status"], ReactNode>> = {
  downloading: <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />,
  caching: <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />,
  completed: <CheckCircle2 className="mr-1 inline h-3 w-3" />,
  failed: <XCircle className="mr-1 inline h-3 w-3" />,
};

const PROGRESS_COPY: Partial<Record<Job["status"], (job: Job) => string>> = {
  queued: () => "Waiting…",
  caching: (job) => `Caching on TorBox… ${job.percent > 0 ? `${job.percent.toFixed(1)}%` : ""}`,
};

function isActive(job: Job) {
  return job.status === "downloading" || job.status === "queued" || job.status === "caching";
}

function progressText(job: Job, indeterminate: boolean) {
  return PROGRESS_COPY[job.status]?.(job) ?? (indeterminate ? "Downloading…" : `${job.percent.toFixed(1)}%`);
}

function JobProgress({ job }: { job: Job }) {
  const indeterminate = job.status === "downloading" && job.percent <= 0;
  return (
    <div className="mt-3">
      <div className="h-2 w-full overflow-hidden rounded-full bg-white/5">
        {indeterminate ? (
          <div className="h-full w-1/3 animate-pulse rounded-full bg-gradient-to-r from-brand-500 to-accent-500" />
        ) : (
          <div
            className="h-full rounded-full bg-gradient-to-r from-brand-500 to-accent-500 transition-all duration-300"
            style={{ width: `${job.status === "queued" ? 0 : job.percent}%` }}
          />
        )}
      </div>
      <div className="mt-1 text-right text-[11px] text-slate-500">
        {progressText(job, indeterminate)}
      </div>
    </div>
  );
}

function FailedNotice({ job }: { job: Job }) {
  if (job.status !== "failed" || !job.error) return null;
  return (
    <div className="mt-2 max-h-24 overflow-y-auto rounded-lg bg-red-500/5 px-3 py-2 text-[11px] text-red-300/80">
      {job.error}
    </div>
  );
}

function LinkFailedNotice({ job }: { job: Job }) {
  if (job.status !== "completed" || job.link_status !== "failed") return null;
  return (
    <div className="mt-2 rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
      Download completed, but metadata linking failed: {job.link_error || "Unknown link error"}
    </div>
  );
}

function LinkSuccessNotice({ job }: { job: Job }) {
  if (job.status !== "completed" || job.link_status !== "linked") return null;
  return (
    <div className="mt-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-300">
      Linked to library metadata.
    </div>
  );
}

function RetryMenu({ jobId }: { jobId: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <div className="flex items-center">
        <button
          onClick={() => api.restartDownload(jobId)}
          className="rounded-l-lg p-2 text-slate-400 hover:bg-white/10 hover:text-brand-300"
          title="Restart"
        >
          <RotateCw className="h-4 w-4" />
        </button>
        <button
          onClick={() => setOpen((v) => !v)}
          className="rounded-r-lg p-1 text-slate-400 hover:bg-white/10 hover:text-brand-300"
          title="Retry as…"
        >
          <ChevronDown className="h-3 w-3" />
        </button>
      </div>
      {open && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-[100]"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 z-[110] mt-1 w-40 overflow-hidden rounded-lg border border-white/10 bg-slate-900 shadow-xl">
            {RETRY_MODES.map((r) => (
              <button
                key={r.mode}
                onClick={() => {
                  setOpen(false);
                  api.restartDownload(jobId, r.mode);
                }}
                className="block w-full px-3 py-2 text-left text-xs text-slate-300 hover:bg-white/10"
              >
                {r.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function DownloadJobCard({
  job,
  onRemoved,
}: {
  job: Job;
  onRemoved?: (id: string) => void;
}) {
  const Icon = TYPE_ICON[job.type] || Link2;
  const active = isActive(job);

  return (
    <div className="card p-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/5">
          <Icon className="h-[18px] w-[18px] text-slate-300" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium text-slate-100" title={job.title}>
              {job.title}
            </p>
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs">
            <span className={`font-semibold capitalize ${STATUS_STYLE[job.status]}`}>
              {STATUS_ICON[job.status]}
              {job.status}
            </span>
            {active && job.total > 0 && (
              <span className="text-slate-500">
                {fmtBytes(job.downloaded)} / {fmtBytes(job.total)}
              </span>
            )}
            {job.speed && <span className="text-slate-400">{job.speed}</span>}
            {job.eta && <span className="text-slate-500">ETA {job.eta}</span>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {active ? (
            <button
              onClick={() => api.cancelDownload(job.id)}
              className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-red-300"
              title="Cancel"
            >
              <X className="h-4 w-4" />
            </button>
          ) : (
            <>
              {job.status === "failed" ? (
                <RetryMenu jobId={job.id} />
              ) : (
                <button
                  onClick={() => api.restartDownload(job.id)}
                  className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-brand-300"
                  title="Restart"
                >
                  <RotateCw className="h-4 w-4" />
                </button>
              )}
              <button
                onClick={async () => {
                  onRemoved?.(job.id);
                  try {
                    await api.removeDownload(job.id);
                  } catch {
                    /* WS download_removed reconciles; refresh if remove failed */
                  }
                }}
                className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-red-300"
                title="Remove"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
      </div>

      {active && <JobProgress job={job} />}
      <FailedNotice job={job} />
      <LinkFailedNotice job={job} />
      <LinkSuccessNotice job={job} />
    </div>
  );
}
