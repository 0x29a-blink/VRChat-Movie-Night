import { Gauge, Loader2, Radio, Wifi } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { useToast } from "./Toast";

type EncoderPreset = {
  id: string;
  name: string;
  description: string;
  settings: Record<string, unknown>;
};

type VideoPreset = {
  id: string;
  name: string;
  description: string;
  video: Record<string, unknown>;
};

type SpeedResult = {
  ok: boolean;
  upload_mbps?: number;
  upload_kbps?: number;
  preset_id?: string;
  preset_name?: string;
  recommended_video_kbps?: number;
  note?: string;
  error?: string;
  method?: string;
};

export function StreamQualitySettings() {
  const { push: pushToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [streaming, setStreaming] = useState(false);
  const [encoderPresets, setEncoderPresets] = useState<EncoderPreset[]>([]);
  const [videoPresets, setVideoPresets] = useState<VideoPreset[]>([]);
  const [currentBitrate, setCurrentBitrate] = useState<number | null>(null);
  const [applying, setApplying] = useState<string | null>(null);
  const [speedBusy, setSpeedBusy] = useState<"host" | "browser" | null>(null);
  const [speedResult, setSpeedResult] = useState<SpeedResult | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const presets = await api.streamPresets();
      setEncoderPresets(presets.encoder_presets);
      setVideoPresets(presets.video_presets);
      setStreaming(presets.streaming);
      try {
        const enc = await api.streamEncoderSettings();
        setStreaming(enc.streaming);
        const s = enc.settings as Record<string, unknown>;
        const encNested = s.encoder as Record<string, unknown> | undefined;
        const br = s.bitrate ?? encNested?.bitrate;
        if (typeof br === "number") setCurrentBitrate(br);
        else if (typeof br === "string") setCurrentBitrate(parseInt(br, 10) || null);
      } catch {
        setCurrentBitrate(null);
      }
    } catch (err: unknown) {
      pushToast(err instanceof Error ? err.message : "Could not load stream presets", "error");
    } finally {
      setLoading(false);
    }
  }, [pushToast]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const applyEncoder = async (presetId: string) => {
    setApplying(presetId);
    try {
      await api.applyEncoderPreset(presetId);
      pushToast("Encoder preset applied (live)", "success");
      await refresh();
    } catch (err: unknown) {
      pushToast(err instanceof Error ? err.message : "Could not apply preset", "error");
    } finally {
      setApplying(null);
    }
  };

  const applyVideo = async (presetId: string) => {
    setApplying(`video-${presetId}`);
    try {
      await api.applyVideoPreset(presetId);
      pushToast("Video preset applied — restart stream if needed", "success");
      await refresh();
    } catch (err: unknown) {
      pushToast(err instanceof Error ? err.message : "Could not apply video preset", "error");
    } finally {
      setApplying(null);
    }
  };

  const hostSpeedtest = async () => {
    setSpeedBusy("host");
    setSpeedResult(null);
    try {
      const r = await api.hostSpeedtest();
      setSpeedResult(r);
      if (!r.ok) pushToast(r.error || "Speed test failed", "error");
    } catch (err: unknown) {
      pushToast(err instanceof Error ? err.message : "Speed test failed", "error");
    } finally {
      setSpeedBusy(null);
    }
  };

  const browserSpeedtest = async () => {
    setSpeedBusy("browser");
    setSpeedResult(null);
    try {
      const size = 2 * 1024 * 1024;
      const blob = new Blob([new Uint8Array(size)]);
      const r = await api.browserUploadSpeedtest(blob);
      setSpeedResult(r);
      pushToast("Upload sample measured", "success");
    } catch (err: unknown) {
      pushToast(err instanceof Error ? err.message : "Upload test failed", "error");
    } finally {
      setSpeedBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading stream settings…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-xs text-slate-500">
        Encoder presets apply while <strong className="font-normal text-slate-400">live</strong> (bitrate,
        preset, tune, etc.). Video / downscale presets require the stream to be{" "}
        <strong className="font-normal text-slate-400">stopped</strong>.
      </p>
      <p className="text-xs text-slate-500">
        HLS delay: MediaMTX uses <strong className="font-normal text-slate-400">1s</strong> segments (
        <code className="text-slate-400">MediaMTX/LATENCY.md</code>). Set OBS{" "}
        <strong className="font-normal text-slate-400">keyframe interval ~2s</strong>. VRChat on PC may still
        buffer more than Quest.
      </p>

      {streaming && (
        <div className="rounded-lg bg-brand-500/10 px-3 py-2 text-xs text-brand-200">
          <Radio className="mr-1 inline h-3.5 w-3.5" />
          Stream is live — encoder presets OK; stop stream before changing resolution downscale.
        </div>
      )}

      {currentBitrate != null && (
        <p className="text-xs text-slate-400">
          Current encoder bitrate from OBS: <span className="tabular-nums text-slate-300">{currentBitrate}</span>{" "}
          Kbps
        </p>
      )}

      <div>
        <h3 className="text-sm font-medium text-slate-300">Encoder presets (live)</h3>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {encoderPresets.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={!!applying}
              onClick={() => applyEncoder(p.id)}
              className="card p-3 text-left transition-colors hover:bg-white/5 disabled:opacity-50"
            >
              <div className="text-sm font-medium">{p.name}</div>
              <div className="mt-1 text-[11px] text-slate-500">{p.description}</div>
              {applying === p.id && (
                <Loader2 className="mt-2 h-4 w-4 animate-spin text-brand-400" />
              )}
            </button>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium text-slate-300">Video / downscale (stream stopped)</h3>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {videoPresets.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={!!applying || streaming}
              onClick={() => applyVideo(p.id)}
              title={streaming ? "Stop stream first" : undefined}
              className="card p-3 text-left transition-colors hover:bg-white/5 disabled:opacity-50"
            >
              <div className="text-sm font-medium">{p.name}</div>
              <div className="mt-1 text-[11px] text-slate-500">{p.description}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="card space-y-3 p-4">
        <h3 className="flex items-center gap-2 text-sm font-medium text-slate-300">
          <Gauge className="h-4 w-4" /> Upload test & recommendation
        </h3>
        <p className="text-xs text-slate-500">
          Run on the <strong className="font-normal text-slate-400">PC that runs OBS</strong> before Go live.
          Host test uses speedtest CLI on the server machine. Browser test only reflects upload to this web
          app (misleading on localhost).
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-ghost text-sm" disabled={!!speedBusy} onClick={hostSpeedtest}>
            {speedBusy === "host" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wifi className="h-4 w-4" />}
            Host speed test
          </button>
          <button
            type="button"
            className="btn-ghost text-sm"
            disabled={!!speedBusy}
            onClick={browserSpeedtest}
          >
            {speedBusy === "browser" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Gauge className="h-4 w-4" />
            )}
            Browser upload sample
          </button>
        </div>
        {speedResult?.ok && (
          <div className="rounded-lg bg-black/30 px-3 py-2 text-xs text-slate-300">
            <div>
              Upload ≈ {speedResult.upload_mbps} Mbps ({speedResult.upload_kbps} Kbps)
            </div>
            {speedResult.recommended_video_kbps != null && (
              <div className="mt-1">Suggested video bitrate ≈ {speedResult.recommended_video_kbps} Kbps</div>
            )}
            {speedResult.preset_name && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span>Try preset: {speedResult.preset_name}</span>
                {speedResult.preset_id && (
                  <button
                    type="button"
                    className="btn-primary py-1 text-xs"
                    onClick={() => applyEncoder(speedResult.preset_id!)}
                  >
                    Apply
                  </button>
                )}
              </div>
            )}
            {speedResult.note && <p className="mt-2 text-slate-500">{speedResult.note}</p>}
          </div>
        )}
        {speedResult && !speedResult.ok && speedResult.error && (
          <p className="text-xs text-red-300">{speedResult.error}</p>
        )}
      </div>
    </div>
  );
}
