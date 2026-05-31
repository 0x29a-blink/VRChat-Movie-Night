import { Loader2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import type { WatchlistItem, WatchlistWheelCandidate, WatchlistWheelResult, WheelPreset } from "../types";
import { streamTargetFromPartial, type StreamTarget } from "./streamTarget";
import { TitleMediaActions } from "./TitleMediaActions";

const WHEEL_COLORS = [
  "#6366f1",
  "#8b5cf6",
  "#a855f7",
  "#d946ef",
  "#ec4899",
  "#f43f5e",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#0ea5e9",
  "#3b82f6",
];

const SPIN_MS = 4800;

type WheelMode = "group" | "custom";
type Phase = "setup" | "loading" | "spinning" | "done" | "error";

function segmentPath(index: number, total: number, radius: number) {
  const a0 = (index / total) * Math.PI * 2 - Math.PI / 2;
  const a1 = ((index + 1) / total) * Math.PI * 2 - Math.PI / 2;
  const x1 = Math.cos(a0) * radius;
  const y1 = Math.sin(a0) * radius;
  const x2 = Math.cos(a1) * radius;
  const y2 = Math.sin(a1) * radius;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M 0 0 L ${x1} ${y1} A ${radius} ${radius} 0 ${large} 1 ${x2} ${y2} Z`;
}

function segmentCenterFromTop(index: number, total: number) {
  return ((index + 0.5) / total) * 360;
}

function spinTargetRotation(winnerIndex: number, total: number, fromRotation: number) {
  const center = segmentCenterFromTop(winnerIndex, total);
  let delta = (360 - center) % 360;
  if (delta === 0) delta = 360;
  const base = fromRotation - (fromRotation % 360);
  return base + 6 * 360 + delta;
}

function wheelLabelLines(title: string, total: number): string[] {
  const clean = (title || "Untitled").trim() || "Untitled";
  const maxLines = total <= 3 ? 3 : 2;
  const maxLen = total <= 3 ? 28 : total <= 5 ? 22 : 16;

  if (clean.length <= maxLen) return [clean];

  const words = clean.split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const w = word.length > maxLen ? `${word.slice(0, maxLen - 1)}…` : word;
    const next = current ? `${current} ${w}` : w;
    if (next.length <= maxLen) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    current = w;
    if (lines.length >= maxLines) break;
  }
  if (lines.length < maxLines && current) lines.push(current);
  if (lines.length === 0) return [clean.slice(0, maxLen - 1) + "…"];

  if (words.join(" ").length > lines.join(" ").length && lines.length > 0) {
    const last = lines[lines.length - 1];
    if (!last.endsWith("…") && last.length >= maxLen - 2) {
      lines[lines.length - 1] = `${last.slice(0, maxLen - 2)}…`;
    }
  }

  return lines.slice(0, maxLines);
}

function WheelLabel({ index, total, title }: { index: number; total: number; title: string }) {
  const degFromEast = segmentCenterFromTop(index, total) - 90;
  const rad = (degFromEast * Math.PI) / 180;
  const dist = 38;
  const left = 50 + Math.cos(rad) * dist;
  const top = 50 + Math.sin(rad) * dist;
  const lines = wheelLabelLines(title, total);
  const fontSize = total <= 3 ? 11 : total <= 5 ? 10 : 9;
  const width = total <= 3 ? "34%" : total <= 5 ? "30%" : "26%";

  return (
    <div
      className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 text-center font-semibold leading-tight text-white"
      style={{
        left: `${left}%`,
        top: `${top}%`,
        width,
        fontSize: `${fontSize}px`,
        textShadow: "0 1px 3px rgba(0,0,0,0.95), 0 0 1px #000",
      }}
    >
      {lines.map((line, i) => (
        <div key={i} className="break-words hyphens-auto">
          {line}
        </div>
      ))}
    </div>
  );
}

function resolveWinnerIndex(candidates: WatchlistWheelCandidate[], winnerIndex: number, winnerId?: number) {
  if (winnerIndex >= 0 && winnerIndex < candidates.length) {
    if (winnerId == null || candidates[winnerIndex]?.id === winnerId) return winnerIndex;
  }
  if (winnerId != null) {
    const byId = candidates.findIndex((c) => c.id === winnerId);
    if (byId >= 0) return byId;
  }
  return winnerIndex;
}

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

function parseLabels(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of text.split(/\n/)) {
    const label = line.trim();
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}

export function WheelSpinModal({
  open,
  groupId,
  groupName,
  onClose,
  onFindStreams,
}: {
  open: boolean;
  groupId: number;
  groupName: string;
  onClose: () => void;
  onFindStreams?: (target: StreamTarget) => void;
}) {
  const [mode, setMode] = useState<WheelMode>("group");
  const [phase, setPhase] = useState<Phase>("setup");
  const [rotation, setRotation] = useState(0);
  const [winner, setWinner] = useState<WatchlistItem | null>(null);
  const [candidates, setCandidates] = useState<WatchlistWheelCandidate[]>([]);
  const [winnerIndex, setWinnerIndex] = useState<number | null>(null);
  const [isCustomResult, setIsCustomResult] = useState(false);
  const [error, setError] = useState("");

  const [poolLoading, setPoolLoading] = useState(false);
  const [poolItems, setPoolItems] = useState<WatchlistItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [includeWatched, setIncludeWatched] = useState(false);
  const [includeUnwatched, setIncludeUnwatched] = useState(true);

  const [presets, setPresets] = useState<WheelPreset[]>([]);
  const [presetsLoading, setPresetsLoading] = useState(false);
  const [customText, setCustomText] = useState("");
  const [presetName, setPresetName] = useState("");
  const [saveBusy, setSaveBusy] = useState(false);

  const wheelRef = useRef<HTMLDivElement>(null);
  const rotationRef = useRef(0);
  const spinTokenRef = useRef(0);
  const spinPlanRef = useRef<{ target: number; index: number } | null>(null);
  const animFrameRef = useRef(0);
  const activeSpinRef = useRef(0);

  const customLabels = useMemo(() => parseLabels(customText), [customText]);

  const runSpinAnimation = useCallback((from: number, to: number, token: number) => {
    window.cancelAnimationFrame(animFrameRef.current);
    const start = performance.now();

    const tick = (now: number) => {
      if (token !== spinTokenRef.current) return;
      const elapsed = now - start;
      const t = Math.min(1, elapsed / SPIN_MS);
      const current = from + (to - from) * easeOutCubic(t);
      rotationRef.current = current;
      setRotation(current);

      if (t < 1) {
        animFrameRef.current = window.requestAnimationFrame(tick);
      } else {
        rotationRef.current = to;
        setRotation(to);
        setPhase("done");
      }
    };

    animFrameRef.current = window.requestAnimationFrame(tick);
  }, []);

  const applySpinResult = useCallback((token: number, r: WatchlistWheelResult) => {
    if (token !== spinTokenRef.current) return;
    const resolved = resolveWinnerIndex(r.candidates, r.winner_index, r.winner_id);
    const target = spinTargetRotation(resolved, r.candidates.length, rotationRef.current);
    spinPlanRef.current = { target, index: resolved };
    setCandidates(r.candidates);
    setWinner(r.item);
    setWinnerIndex(resolved);
    setIsCustomResult(!!r.custom);
    setPhase("spinning");
  }, []);

  useEffect(() => {
    if (!open) return;

    setMode("group");
    setPhase("setup");
    setRotation(0);
    rotationRef.current = 0;
    setWinner(null);
    setCandidates([]);
    setWinnerIndex(null);
    setIsCustomResult(false);
    setError("");
    setIncludeWatched(false);
    setIncludeUnwatched(true);
    setCustomText("");
    setPresetName("");

    setPoolLoading(true);
    setPresetsLoading(true);

    api
      .watchlistGroupItems(groupId)
      .then((r) => {
        setPoolItems(r.items);
        setSelectedIds(new Set(r.items.map((i) => i.id)));
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load group items");
        setPhase("error");
      })
      .finally(() => setPoolLoading(false));

    api
      .watchlistWheelPresets()
      .then((r) => setPresets(r.presets))
      .catch(() => setPresets([]))
      .finally(() => setPresetsLoading(false));

    return () => {
      spinTokenRef.current += 1;
      window.cancelAnimationFrame(animFrameRef.current);
    };
  }, [open, groupId]);

  const eligibleCount = useMemo(() => {
    return poolItems.filter((item) => {
      if (!selectedIds.has(item.id)) return false;
      if (item.my_watched && !includeWatched) return false;
      if (!item.my_watched && !includeUnwatched) return false;
      return true;
    }).length;
  }, [poolItems, selectedIds, includeWatched, includeUnwatched]);

  const beginSpin = async () => {
    const token = ++spinTokenRef.current;
    window.cancelAnimationFrame(animFrameRef.current);
    spinPlanRef.current = null;
    activeSpinRef.current = 0;
    setPhase("loading");
    setRotation(0);
    rotationRef.current = 0;
    setWinner(null);
    setCandidates([]);
    setWinnerIndex(null);
    setIsCustomResult(false);
    setError("");

    try {
      let result: WatchlistWheelResult;
      if (mode === "custom") {
        result = await api.watchlistCustomWheel(customLabels);
      } else {
        const allSelected = selectedIds.size === poolItems.length;
        result = await api.watchlistWheel(groupId, {
          include_watched_by_me: includeWatched,
          include_unwatched_by_me: includeUnwatched,
          item_ids: allSelected ? undefined : [...selectedIds],
        });
      }
      applySpinResult(token, result);
    } catch (err: unknown) {
      if (token !== spinTokenRef.current) return;
      setError(err instanceof Error ? err.message : "Spin failed");
      setPhase("error");
    }
  };

  const startSpin = () => {
    if (mode === "custom") {
      if (customLabels.length === 0) {
        setError("Add at least one label (one per line)");
        return;
      }
      void beginSpin();
      return;
    }

    if (!includeWatched && !includeUnwatched) {
      setError("Include at least watched or unwatched titles");
      return;
    }
    if (selectedIds.size === 0) {
      setError("Select at least one title for the wheel");
      return;
    }
    if (eligibleCount === 0) {
      setError("No titles match your filters — adjust checkboxes or selection");
      return;
    }
    void beginSpin();
  };

  const savePreset = async () => {
    if (!presetName.trim()) {
      setError("Enter a name to save this preset");
      return;
    }
    if (customLabels.length === 0) {
      setError("Add labels before saving a preset");
      return;
    }
    setSaveBusy(true);
    setError("");
    try {
      const created = await api.watchlistCreateWheelPreset(presetName.trim(), customLabels);
      setPresets((prev) => [...prev, created]);
      setPresetName("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save preset");
    } finally {
      setSaveBusy(false);
    }
  };

  const deletePreset = async (id: number) => {
    try {
      await api.watchlistDeleteWheelPreset(id);
      setPresets((prev) => prev.filter((p) => p.id !== id));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to delete preset");
    }
  };

  useEffect(() => {
    if (phase !== "spinning" || !spinPlanRef.current) return;

    const token = spinTokenRef.current;
    if (activeSpinRef.current === token) return;
    activeSpinRef.current = token;

    const plan = spinPlanRef.current;
    const from = rotationRef.current;
    const to = plan.target;

    const start = () => {
      if (token !== spinTokenRef.current) return;
      if (!wheelRef.current) {
        requestAnimationFrame(start);
        return;
      }
      runSpinAnimation(from, to, token);
    };

    requestAnimationFrame(start);
  }, [phase, runSpinAnimation]);

  const toggleItem = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const winnerCandidate =
    winnerIndex != null && winnerIndex >= 0 && winnerIndex < candidates.length
      ? candidates[winnerIndex]
      : null;
  const displayTitle = winner?.title || winnerCandidate?.title || "Untitled";
  const displayPoster = !isCustomResult ? winner?.poster || winnerCandidate?.poster || "" : "";
  const winnerStreamTarget = !isCustomResult && winner ? streamTargetFromPartial(winner) : null;

  if (!open) return null;

  const n = candidates.length;
  const spinCount = mode === "custom" ? customLabels.length : eligibleCount;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4" onClick={onClose}>
      <div
        className="card max-h-[90vh] w-full max-w-md overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 className="text-center text-lg font-semibold">Wheel of Movie Night</h3>
        <p className="mt-1 text-center text-xs text-slate-400">
          {mode === "group" ? groupName || "Watchlist group" : "Custom labels"}
        </p>

        {phase === "setup" && (
          <div className="mt-4 space-y-4">
            <div className="flex gap-1 rounded-xl border border-white/5 bg-black/20 p-1">
              <button
                type="button"
                onClick={() => {
                  setMode("group");
                  setError("");
                }}
                className={`flex-1 rounded-lg px-3 py-2 text-xs font-medium ${
                  mode === "group" ? "bg-brand-500/20 text-white" : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Group titles
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode("custom");
                  setError("");
                }}
                className={`flex-1 rounded-lg px-3 py-2 text-xs font-medium ${
                  mode === "custom" ? "bg-brand-500/20 text-white" : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Custom labels
              </button>
            </div>

            {mode === "group" && (
              <>
                <div className="space-y-2 rounded-xl border border-white/5 bg-white/[0.02] p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Include for me</div>
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
                    <input
                      type="checkbox"
                      checked={includeUnwatched}
                      onChange={(e) => setIncludeUnwatched(e.target.checked)}
                      className="h-4 w-4 rounded accent-brand-500"
                    />
                    Unwatched titles
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
                    <input
                      type="checkbox"
                      checked={includeWatched}
                      onChange={(e) => setIncludeWatched(e.target.checked)}
                      className="h-4 w-4 rounded accent-brand-500"
                    />
                    Already watched titles
                  </label>
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Pick titles ({selectedIds.size} selected)
                    </span>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        className="btn-ghost px-2 py-0.5 text-[10px]"
                        onClick={() => setSelectedIds(new Set(poolItems.map((i) => i.id)))}
                      >
                        All
                      </button>
                      <button
                        type="button"
                        className="btn-ghost px-2 py-0.5 text-[10px]"
                        onClick={() => setSelectedIds(new Set())}
                      >
                        None
                      </button>
                    </div>
                  </div>
                  {poolLoading ? (
                    <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-400">
                      <Loader2 className="h-4 w-4 animate-spin" /> Loading titles…
                    </div>
                  ) : poolItems.length === 0 ? (
                    <p className="py-6 text-center text-sm text-slate-500">No titles in this group.</p>
                  ) : (
                    <div className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-white/5 p-2">
                      {poolItems.map((item) => (
                        <label
                          key={item.id}
                          className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/5"
                        >
                          <input
                            type="checkbox"
                            checked={selectedIds.has(item.id)}
                            onChange={() => toggleItem(item.id)}
                            className="h-3.5 w-3.5 rounded accent-brand-500"
                          />
                          <span className="min-w-0 flex-1 truncate text-sm">{item.title}</span>
                          {item.my_watched && (
                            <span className="chip bg-emerald-500/15 text-[10px] text-emerald-300">watched</span>
                          )}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}

            {mode === "custom" && (
              <>
                <p className="text-xs text-slate-500">
                  Spin for genres, themes, or anything else — one label per line. Great before spinning a watchlist
                  group.
                </p>

                {presetsLoading ? (
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading saved wheels…
                  </div>
                ) : presets.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Saved wheels</div>
                    <div className="flex flex-wrap gap-1.5">
                      {presets.map((p) => (
                        <div key={p.id} className="flex items-center gap-0.5">
                          <button
                            type="button"
                            className="chip bg-brand-500/15 text-brand-200 hover:bg-brand-500/25"
                            onClick={() => setCustomText(p.labels.join("\n"))}
                          >
                            {p.name}
                          </button>
                          <button
                            type="button"
                            title={`Delete ${p.name}`}
                            onClick={() => deletePreset(p.id)}
                            className="rounded p-0.5 text-slate-500 hover:text-red-400"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <label className="block text-xs text-slate-400">
                  Labels
                  <textarea
                    value={customText}
                    onChange={(e) => setCustomText(e.target.value)}
                    placeholder={"Horror\nComedy\nSci-fi\nDocumentary"}
                    rows={6}
                    className="input mt-1 resize-y font-mono text-sm"
                  />
                </label>
                <p className="text-[11px] text-slate-500">{customLabels.length} label(s) on the wheel</p>

                <div className="flex gap-2">
                  <input
                    value={presetName}
                    onChange={(e) => setPresetName(e.target.value)}
                    placeholder="Preset name (e.g. Genres)"
                    className="input flex-1 text-xs"
                  />
                  <button type="button" disabled={saveBusy} onClick={savePreset} className="btn-ghost shrink-0 text-xs">
                    {saveBusy ? "Saving…" : "Save"}
                  </button>
                </div>
              </>
            )}

            {error && <p className="text-center text-sm text-red-300">{error}</p>}

            <p className="text-center text-[11px] text-slate-500">
              {spinCount} option{spinCount === 1 ? "" : "s"} on the wheel
            </p>

            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="btn-ghost flex-1">
                Cancel
              </button>
              <button
                type="button"
                onClick={startSpin}
                disabled={(mode === "group" && (poolLoading || eligibleCount === 0)) || (mode === "custom" && customLabels.length === 0)}
                className="btn-primary flex-1"
              >
                Spin the wheel
              </button>
            </div>
          </div>
        )}

        {phase === "loading" && (
          <div className="flex flex-col items-center py-16 text-slate-400">
            <div className="h-48 w-48 animate-pulse rounded-full bg-white/5" />
            <p className="mt-4 text-sm">Spinning up…</p>
          </div>
        )}

        {phase === "error" && (
          <div className="py-12 text-center">
            <p className="text-sm text-red-300">{error}</p>
            <button type="button" onClick={() => setPhase("setup")} className="btn-ghost mt-4">
              Back
            </button>
            <button type="button" onClick={onClose} className="btn-primary mt-4">
              Close
            </button>
          </div>
        )}

        {(phase === "spinning" || phase === "done") && n > 0 && (
          <>
            <div className="relative mx-auto mt-6 h-72 w-72">
              <div className="pointer-events-none absolute left-1/2 top-0 z-20 -translate-x-1/2 -translate-y-1">
                <div className="h-0 w-0 border-x-[10px] border-t-[18px] border-x-transparent border-t-brand-400 drop-shadow" />
              </div>

              <div className="absolute inset-0 rounded-full border-4 border-brand-500/30 bg-ink-900/80 p-1">
                <div
                  ref={wheelRef}
                  className="relative h-full w-full will-change-transform"
                  style={{
                    transform: `rotate(${rotation}deg)`,
                    transformOrigin: "50% 50%",
                  }}
                >
                  <svg viewBox="-100 -100 200 200" className="absolute inset-0 h-full w-full">
                    {candidates.map((c, i) => (
                      <path
                        key={c.id}
                        d={segmentPath(i, n, 96)}
                        fill={WHEEL_COLORS[i % WHEEL_COLORS.length]}
                        stroke="#0f0f14"
                        strokeWidth="0.6"
                      />
                    ))}
                    <circle r="14" fill="#1e1e28" stroke="#6366f1" strokeWidth="2" />
                  </svg>

                  {candidates.map((c, i) => (
                    <WheelLabel key={c.id} index={i} total={n} title={c.title} />
                  ))}
                </div>
              </div>
            </div>

            {phase === "spinning" && (
              <p className="mt-4 animate-pulse text-center text-sm text-brand-300">Spinning…</p>
            )}

            {phase === "done" && (
              <div className="mt-5 text-center">
                <p className="text-sm text-slate-400">{isCustomResult ? "The wheel landed on" : "Tonight we watch"}</p>
                <p className="mt-2 break-words text-base font-bold leading-snug text-white">{displayTitle}</p>
                {displayPoster && (
                  <img
                    src={displayPoster}
                    alt=""
                    className="mx-auto mt-3 h-36 max-w-full rounded-lg object-cover shadow-glow"
                  />
                )}
                {winner?.kind === "collection" && (
                  <p className="mt-2 text-xs text-slate-500">
                    Expand the collection on your watchlist to pick which movie to stream.
                  </p>
                )}
                {winnerStreamTarget && onFindStreams && (
                  <div className="mt-4 flex justify-center">
                    <TitleMediaActions
                      libraryMatch={winner?.library_match}
                      onFindStreams={() => {
                        onFindStreams(winnerStreamTarget);
                        onClose();
                      }}
                    />
                  </div>
                )}
                <button type="button" onClick={onClose} className="btn-primary mt-5 w-full">
                  Let&apos;s go!
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
