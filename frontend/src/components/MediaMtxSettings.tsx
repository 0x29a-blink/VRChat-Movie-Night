import { Loader2, Radio } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { useToast } from "./Toast";

type Preset = { id: string; name: string; description: string };

type MtxStatus = {
  presets: Preset[];
  active_preset_id: string;
  api_reachable?: boolean;
  hls?: Record<string, unknown>;
  error?: string;
};

export function MediaMtxSettings() {
  const { push: pushToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<MtxStatus | null>(null);
  const [applying, setApplying] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setStatus(await api.mediamtxStatus());
    } catch (err: unknown) {
      pushToast(err instanceof Error ? err.message : "Could not load MediaMTX status", "error");
    } finally {
      setLoading(false);
    }
  }, [pushToast]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const apply = async (presetId: string) => {
    setApplying(presetId);
    try {
      const r = await api.applyMediamtxPreset(presetId);
      pushToast(`${r.preset_name} applied (live + saved to mediamtx.yml)`, "success");
      await refresh();
    } catch (err: unknown) {
      pushToast(err instanceof Error ? err.message : "Could not apply preset", "error");
    } finally {
      setApplying(null);
    }
  };

  if (loading && !status) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading MediaMTX…
      </div>
    );
  }

  const presets = status?.presets ?? [];
  const active = status?.active_preset_id;
  const hls = status?.hls;

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        HLS packaging for VRChat viewers. Changes apply immediately via MediaMTX Control API (port 9997) and are
        written to <code className="text-slate-400">MediaMTX/mediamtx.yml</code> so they survive restarts. If a
        friend stutters on slow internet after low-latency tuning, try <strong className="font-medium text-slate-300">Compatibility</strong>.
      </p>
      {status?.api_reachable === false && (
        <p className="text-xs text-amber-300">
          MediaMTX API not reachable{status.error ? `: ${status.error}` : ""}. Start MediaMTX with{" "}
          <code className="text-slate-400">api: true</code> in mediamtx.yml.
        </p>
      )}
      {hls && (
        <p className="text-[11px] text-slate-500">
          Live: segment {String(hls.hlsSegmentDuration ?? "?")}, count {String(hls.hlsSegmentCount ?? "?")},
          remux {String(hls.hlsAlwaysRemux ?? "?")}
        </p>
      )}
      <div className="grid gap-2 sm:grid-cols-3">
        {presets.map((p) => {
          const isActive = p.id === active;
          const busy = applying === p.id;
          return (
            <button
              key={p.id}
              type="button"
              disabled={!!applying}
              onClick={() => apply(p.id)}
              className={`rounded-lg border p-3 text-left text-sm transition-colors ${
                isActive
                  ? "border-brand-500/50 bg-brand-500/10"
                  : "border-white/10 bg-black/20 hover:border-white/20"
              }`}
            >
              <div className="flex items-center gap-2 font-medium text-slate-200">
                {busy ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                ) : (
                  <Radio className={`h-4 w-4 shrink-0 ${isActive ? "text-brand-400" : "text-slate-500"}`} />
                )}
                {p.name}
                {isActive && <span className="chip bg-brand-500/20 text-brand-300 text-[10px]">active</span>}
              </div>
              <p className="mt-1 text-[11px] leading-snug text-slate-500">{p.description}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
