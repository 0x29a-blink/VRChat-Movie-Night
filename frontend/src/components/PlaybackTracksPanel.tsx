import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { LibraryTracksResponse } from "../types";
import { useToast } from "./Toast";

type TrackIndex = number | "";

function TrackSummary({
  audioCount,
  subCount,
  probeError,
}: {
  audioCount: number;
  subCount: number;
  probeError?: string;
}) {
  return (
    <p className="text-[10px] text-slate-500">
      In file: {audioCount} audio, {subCount} subtitle{subCount === 1 ? "" : "s"}
      {probeError ? <span className="block text-amber-400/90">Probe: {probeError}</span> : null}
    </p>
  );
}

function MissingTracksHint({
  audioCount,
  subCount,
  probeError,
}: {
  audioCount: number;
  subCount: number;
  probeError?: string;
}) {
  if (audioCount > 1 || subCount > 0 || probeError) return null;

  return (
    <p className="text-xs text-slate-500">
      Stream results often list release audio (dual, multi-sub), but your downloaded file only has what yt-dlp
      merged. Enable <strong className="font-medium text-slate-400">Keep all torrent tracks</strong> in Settings,
      then re-download this episode.
    </p>
  );
}

function AudioTrackSelect({
  tracks,
  audioIdx,
  audioCount,
  disabled,
  onChange,
}: {
  tracks: LibraryTracksResponse;
  audioIdx: TrackIndex;
  audioCount: number;
  disabled: boolean;
  onChange: (value: TrackIndex) => void;
}) {
  return (
    <label className="block text-xs text-slate-400">
      Audio track
      <select
        className="input mt-1"
        value={audioIdx === "" ? "" : String(audioIdx)}
        disabled={disabled || audioCount === 0}
        onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
      >
        {audioCount === 0 ? (
          <option value="">None detected</option>
        ) : (
          tracks.audio.map((a) => (
            <option key={a.index} value={a.audio_index ?? 0}>
              {a.label}
            </option>
          ))
        )}
      </select>
    </label>
  );
}

function SubtitleTrackSelect({
  tracks,
  subIdx,
  subCount,
  disabled,
  onChange,
}: {
  tracks: LibraryTracksResponse;
  subIdx: TrackIndex;
  subCount: number;
  disabled: boolean;
  onChange: (value: TrackIndex) => void;
}) {
  return (
    <label className="block text-xs text-slate-400">
      Subtitles
      <select
        className="input mt-1"
        value={subIdx === "" ? "" : String(subIdx)}
        disabled={disabled || subCount === 0}
        onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
      >
        <option value="">Off</option>
        {tracks.subtitles.map((s) => (
          <option key={s.index} value={s.subtitle_index ?? 0}>
            {s.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function BurnSubtitlesToggle({
  subIdx,
  subCount,
  checked,
  disabled,
  onChange,
}: {
  subIdx: TrackIndex;
  subCount: number;
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  if (subIdx === "" || subCount === 0) return null;

  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-300">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="h-4 w-4 rounded accent-brand-500"
      />
      Burn subtitles into video (VRChat)
    </label>
  );
}

function savingLabel(isNowPlaying: boolean, burningOnSave: boolean): string {
  if (!isNowPlaying) return "Saving…";
  return burningOnSave ? "Remuxing subtitles…" : "Applying…";
}

function saveLabel(isNowPlaying: boolean, burningOnSave: boolean): string {
  if (!isNowPlaying) return "Save track settings";
  return burningOnSave ? "Apply tracks & remux subs" : "Apply tracks & restart playback";
}

function SaveTracksButton({
  applying,
  isNowPlaying,
  burningOnSave,
  compact,
  disabled,
  onSave,
}: {
  applying: boolean;
  isNowPlaying: boolean;
  burningOnSave: boolean;
  compact: boolean;
  disabled: boolean;
  onSave: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSave}
      disabled={disabled}
      className={`btn-primary w-full ${compact ? "text-xs !py-1.5" : "text-xs"}`}
    >
      {applying ? (
        <span className="inline-flex items-center justify-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {savingLabel(isNowPlaying, burningOnSave)}
        </span>
      ) : (
        saveLabel(isNowPlaying, burningOnSave)
      )}
    </button>
  );
}

function ApplyingHint({
  applying,
  isNowPlaying,
  burningOnSave,
}: {
  applying: boolean;
  isNowPlaying: boolean;
  burningOnSave: boolean;
}) {
  if (!applying || !isNowPlaying || !burningOnSave) return null;

  return (
    <p className="text-[10px] leading-snug text-amber-300/90">
      Burning subtitles re-encodes the video — large files can take several minutes. Please wait.
    </p>
  );
}

export function PlaybackTracksPanel({
  libraryId,
  libraryPath,
  isNowPlaying = false,
  disabled,
  compact = false,
}: {
  libraryId?: number;
  libraryPath?: string;
  isNowPlaying?: boolean;
  disabled?: boolean;
  compact?: boolean;
}) {
  const { push: pushToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [tracks, setTracks] = useState<LibraryTracksResponse | null>(null);
  const [audioIdx, setAudioIdx] = useState<number | "">("");
  const [subIdx, setSubIdx] = useState<number | "">("");
  const [burnSubs, setBurnSubs] = useState(true);

  const load = useCallback(async () => {
    if (!libraryId && !libraryPath) {
      setTracks(null);
      return;
    }
    setLoading(true);
    try {
      let itemId = libraryId;
      if (!itemId && libraryPath) {
        const byPath = await api.libraryByPath(libraryPath);
        const item = byPath.item;
        if (!item) {
          setTracks(null);
          return;
        }
        itemId = item.id;
      }
      const data = await api.libraryTracks(itemId!);
      setTracks(data);
      setAudioIdx(data.playback_audio_index ?? data.audio[0]?.audio_index ?? 0);
      setSubIdx(
        data.playback_subtitle_index != null && data.playback_subtitle_index >= 0
          ? data.playback_subtitle_index
          : ""
      );
      setBurnSubs(data.playback_burn_subtitles ?? true);
    } catch (err: unknown) {
      setTracks(null);
      pushToast(err instanceof Error ? err.message : "Could not load tracks", "error");
    } finally {
      setLoading(false);
    }
  }, [libraryId, libraryPath, pushToast]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    if (!tracks) return;
    setApplying(true);
    try {
      const audio = audioIdx === "" ? null : Number(audioIdx);
      const sub = subIdx === "" ? -1 : Number(subIdx);
      const burning = sub >= 0 && burnSubs;
      await api.setLibraryPlayback(tracks.item_id, {
        playback_audio_index: audio,
        playback_subtitle_index: sub,
        playback_burn_subtitles: burning,
      });
      if (isNowPlaying) {
        await api.applyLibraryPlayback(tracks.item_id);
        pushToast(
          burning
            ? "Tracks applied — remuxed with burned subs and restarted in OBS"
            : "Tracks applied — OBS restarted",
          "success"
        );
      } else {
        pushToast(
          burning
            ? "Track settings saved — remux runs when you play (can take several minutes)"
            : "Track settings saved — used when this title plays",
          "success"
        );
      }
      await load();
    } catch (err: unknown) {
      pushToast(err instanceof Error ? err.message : "Could not save tracks", "error");
    } finally {
      setApplying(false);
    }
  };

  if (!libraryId && !libraryPath) return null;

  const audioCount = tracks?.audio.length ?? 0;
  const subCount = tracks?.subtitles.length ?? 0;
  const probeError = tracks?.error?.trim();
  const controlsDisabled = applying;
  const saveDisabled = applying || (isNowPlaying && !!disabled);
  const burningOnSave = subIdx !== "" && burnSubs && subCount > 0;

  const pad = compact ? "p-2" : "p-3";

  return (
    <div className={`space-y-3 rounded-lg border border-white/5 bg-black/20 ${pad}`}>
      {!compact && (
        <>
          <div className="text-xs font-medium text-slate-300">Audio &amp; subtitles (for OBS)</div>
          <p className="text-[10px] leading-snug text-slate-500">
            {isNowPlaying
              ? "Chooses tracks then remuxes for OBS. Burn-in subtitles for VRChat."
              : "Set tracks before play — saved on this library file and used when queued or played."}
          </p>
        </>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Probing file…
        </div>
      ) : tracks ? (
        <>
          <TrackSummary audioCount={audioCount} subCount={subCount} probeError={probeError} />
          <MissingTracksHint audioCount={audioCount} subCount={subCount} probeError={probeError} />
          <AudioTrackSelect
            tracks={tracks}
            audioIdx={audioIdx}
            audioCount={audioCount}
            disabled={controlsDisabled}
            onChange={setAudioIdx}
          />
          <SubtitleTrackSelect
            tracks={tracks}
            subIdx={subIdx}
            subCount={subCount}
            disabled={controlsDisabled}
            onChange={setSubIdx}
          />
          <BurnSubtitlesToggle
            subIdx={subIdx}
            subCount={subCount}
            checked={burnSubs}
            disabled={controlsDisabled}
            onChange={setBurnSubs}
          />
          <SaveTracksButton
            applying={applying}
            isNowPlaying={isNowPlaying}
            burningOnSave={burningOnSave}
            compact={compact}
            disabled={saveDisabled || audioCount === 0}
            onSave={save}
          />
          <ApplyingHint applying={applying} isNowPlaying={isNowPlaying} burningOnSave={burningOnSave} />
        </>
      ) : (
        <p className="text-xs text-slate-500">Could not load tracks for this file.</p>
      )}
    </div>
  );
}
