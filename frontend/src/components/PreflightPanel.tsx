import { CheckCircle2, Loader2, RefreshCw, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { PreflightStatus } from "../types";
import { copyHlsUrl } from "../hlsUrl";
import { useToast } from "./Toast";

function StatusRow({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      {ok ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
      ) : (
        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
      )}
      <div>
        <div className={ok ? "text-slate-200" : "text-red-200"}>{label}</div>
        {detail && <div className="text-xs text-slate-500">{detail}</div>}
      </div>
    </div>
  );
}

export function PreflightPanel({ onUpdate }: { onUpdate?: (status: PreflightStatus) => void }) {
  const { push: pushToast } = useToast();
  const [status, setStatus] = useState<PreflightStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api
      .preflight()
      .then((data) => {
        setStatus(data);
        onUpdate?.(data);
      })
      .catch(() => {
        const fallback: PreflightStatus = {
          api: false,
          obs_connected: false,
          obs_streaming: false,
          mediamtx_running: false,
          hls_stream_active: false,
          hls_reachable: false,
          hls_url: "",
          users: 0,
          tools: [],
          issues: ["Could not reach the API"],
          checklist_ok: false,
          ready: false,
        };
        setStatus(fallback);
        onUpdate?.(fallback);
      })
      .finally(() => setLoading(false));
  }, [onUpdate]);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  const copyUrl = async () => {
    try {
      const url = status?.hls_url || (await copyHlsUrl());
      await navigator.clipboard.writeText(url);
      pushToast("HLS URL copied to clipboard", "success");
    } catch {
      pushToast("Could not copy URL", "error");
    }
  };

  const mtxDetail = !status?.mediamtx_running
    ? status?.hls_error || "Run start-movie-night.cmd or start-mediamtx.cmd (port 8888)"
    : status.hls_stream_active
      ? "Relay responding — VRChat can load the stream"
      : status.hls_error || "Normal before Go live — start the stream from Queue & Player";

  return (
    <div className="space-y-3 rounded-xl border border-white/5 bg-white/[0.02] p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold">Movie night checklist</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Verify services and tools before guests arrive. Refreshes every 15 seconds.
          </p>
        </div>
        <button type="button" onClick={load} disabled={loading} className="btn-ghost px-2 py-1 text-xs">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {loading && !status ? (
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Checking…
        </div>
      ) : status ? (
        <>
          <div className="space-y-2">
            <StatusRow ok={status.api} label="Web app API (port 8000)" />
            <StatusRow
              ok={status.obs_connected}
              label="OBS WebSocket (port 4455)"
              detail={
                status.obs_connected
                  ? status.obs_streaming
                    ? "Connected · streaming to MediaMTX"
                    : "Connected · not streaming yet"
                  : "Start OBS and enable WebSocket in Settings → Test connection"
              }
            />
            <StatusRow ok={status.mediamtx_running} label="MediaMTX relay (port 8888)" detail={mtxDetail} />
            {status.mediamtx_running && (
              <StatusRow
                ok={status.hls_stream_active}
                label="HLS stream active"
                detail={
                  status.hls_stream_active
                    ? "Friends can paste the URL into VRChat now"
                    : status.obs_streaming
                      ? status.hls_error ||
                        "OBS is live but HLS not ready — check RTMP server/key or wait a few seconds"
                      : status.hls_error || "Start streaming from Queue & Player when ready"
                }
              />
            )}
            <StatusRow
              ok={status.users > 0}
              label="User accounts"
              detail={`${status.users} account${status.users === 1 ? "" : "s"} configured`}
            />
            {(status.tools ?? []).map((tool) => (
              <StatusRow
                key={tool.name}
                ok={tool.ok}
                label={tool.name}
                detail={tool.ok ? "Available on PATH" : tool.detail || "Not found"}
              />
            ))}
          </div>

          {status.hls_url && (
            <div className="rounded-lg bg-black/30 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-slate-500">
                VRChat stream URL (port 8888, not :8000)
              </div>
              <div className="mt-1 break-all font-mono text-xs text-brand-200">{status.hls_url}</div>
              <button type="button" onClick={copyUrl} className="btn-ghost mt-2 px-2 py-1 text-xs">
                Copy URL
              </button>
            </div>
          )}

          {status.checklist_ok ? (
            <div className="rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
              All checklist items passed. You are ready for movie night.
            </div>
          ) : (
            <div className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
              {(status.issues ?? []).length > 0 ? (
                <ul className="list-inside list-disc space-y-0.5">
                  {status.issues!.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              ) : (
                "Fix the items above before movie night — friends may see a blank screen otherwise."
              )}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
