import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { StreamFilterPreset, StreamFilterState } from "../streamFilters";
import type { StreamResult } from "../types";
import { RES_OPTIONS, streamKey } from "../streamListUtils";
import { StreamResultRow } from "./StreamResultRow";

function PresetsBlock({
  presets,
  onApplyPreset,
  onSavePreset,
  onDeletePreset,
}: {
  presets: StreamFilterPreset[];
  onApplyPreset: (name: string) => void;
  onSavePreset: (name: string) => void;
  onDeletePreset: (name: string) => void;
}) {
  const [selected, setSelected] = useState("");
  const [newName, setNewName] = useState("");

  return (
    <div className="space-y-2 border-b border-white/10 pb-3">
      <div className="text-xs font-semibold text-slate-300">Presets</div>
      <div className="flex items-center gap-1.5">
        <select
          className="input flex-1"
          value={selected}
          onChange={(e) => {
            setSelected(e.target.value);
            if (e.target.value) onApplyPreset(e.target.value);
          }}
        >
          <option value="">Select preset…</option>
          {presets.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
        </select>
        {selected && (
          <button
            type="button"
            className="btn-ghost px-2 text-xs"
            title="Delete preset"
            onClick={() => {
              onDeletePreset(selected);
              setSelected("");
            }}
          >
            ×
          </button>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          className="input flex-1"
          placeholder="Preset name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <button
          type="button"
          className="btn-ghost px-2 text-xs"
          disabled={!newName.trim()}
          onClick={() => {
            onSavePreset(newName.trim());
            setSelected(newName.trim());
            setNewName("");
          }}
        >
          Save
        </button>
      </div>
    </div>
  );
}

function StreamFiltersPanel({
  filters,
  onChange,
  shownCount,
  totalCount,
  showSearch = false,
  indexerOptions = [],
  releaseGroupOptions = [],
  presets,
  onApplyPreset,
  onSavePreset,
  onDeletePreset,
}: {
  filters: StreamFilterState;
  onChange: (patch: Partial<StreamFilterState>) => void;
  shownCount: number;
  totalCount: number;
  showSearch?: boolean;
  indexerOptions?: string[];
  releaseGroupOptions?: string[];
  presets?: StreamFilterPreset[];
  onApplyPreset?: (name: string) => void;
  onSavePreset?: (name: string) => void;
  onDeletePreset?: (name: string) => void;
}) {
  return (
    <div className="card h-fit space-y-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold">Filters</div>
        <div className="text-[11px] text-slate-500">
          {shownCount} / {totalCount}
        </div>
      </div>
      {presets && onApplyPreset && onSavePreset && onDeletePreset && (
        <PresetsBlock
          presets={presets}
          onApplyPreset={onApplyPreset}
          onSavePreset={onSavePreset}
          onDeletePreset={onDeletePreset}
        />
      )}
      {showSearch && (
        <>
          <label className="block text-xs text-slate-400">
            Search titles
            <input
              type="search"
              className="input mt-1"
              value={filters.searchText ?? ""}
              onChange={(e) => onChange({ searchText: e.target.value })}
              placeholder="e.g. remux 1080p dual"
            />
          </label>
          <p className="-mt-2 text-[10px] leading-snug text-slate-500">
            Matches release name, filename, description, codec, and language tags.
          </p>
        </>
      )}
      <label className="block text-xs text-slate-400">
        Min resolution
        <select
          className="input mt-1"
          value={filters.minRes}
          onChange={(e) => onChange({ minRes: e.target.value })}
        >
          <option value="">Any</option>
          {RES_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-xs text-slate-400">
        Codec
        <select className="input mt-1" value={filters.codec} onChange={(e) => onChange({ codec: e.target.value })}>
          <option value="">Any</option>
          <option value="HEVC">HEVC / x265</option>
          <option value="H264">H264 / x264</option>
          <option value="AV1">AV1</option>
        </select>
      </label>
      {indexerOptions.length > 0 && (
        <label className="block text-xs text-slate-400">
          Indexer
          <select
            className="input mt-1"
            value={filters.indexer}
            onChange={(e) => onChange({ indexer: e.target.value })}
          >
            <option value="">All</option>
            {indexerOptions.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </label>
      )}
      {releaseGroupOptions.length > 0 && (
        <label className="block text-xs text-slate-400">
          Release group
          <select
            className="input mt-1"
            value={filters.releaseGroup}
            onChange={(e) => onChange({ releaseGroup: e.target.value })}
          >
            <option value="">All</option>
            {releaseGroupOptions.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="block text-xs text-slate-400">
        Max size (GB)
        <input
          type="number"
          className="input mt-1"
          value={filters.maxSize}
          onChange={(e) => onChange({ maxSize: e.target.value })}
          placeholder="∞"
        />
      </label>
      <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-300">
        <input
          type="checkbox"
          checked={filters.cachedOnly}
          onChange={(e) => onChange({ cachedOnly: e.target.checked })}
          className="h-4 w-4 rounded accent-brand-500"
        />
        Cached only (recommended)
      </label>
      <label className="block text-xs text-slate-400">
        Min seeders (uncached)
        <input
          type="number"
          min={0}
          className="input mt-1"
          value={filters.minSeeders}
          onChange={(e) => onChange({ minSeeders: e.target.value })}
          placeholder="e.g. 50"
          disabled={filters.cachedOnly}
        />
      </label>
      <p className="text-[10px] leading-snug text-slate-500">
        Cached = instant download. Uncached = “Cache &amp; download” (TorBox API key). If a row vanishes after
        TorBox download, turn off “Cached only” and click Refresh streams — TorBox may mark the link used. Seed counts
        come from indexers. Rows without a resolution badge usually lack it in the addon name (check filename below).
      </p>
      <label className="block text-xs text-slate-400">
        Audio (release name)
        <select
          className="input mt-1"
          value={filters.audioLang}
          onChange={(e) => onChange({ audioLang: e.target.value as StreamFilterState["audioLang"] })}
        >
          <option value="">Any</option>
          <option value="dub">English dub (incl. dual)</option>
          <option value="sub">Sub / original audio</option>
          <option value="dual">Dual audio only</option>
        </select>
      </label>
      <label className="block text-xs text-slate-400">
        Subtitles (release name)
        <select
          className="input mt-1"
          value={filters.subtitleType}
          onChange={(e) => onChange({ subtitleType: e.target.value as StreamFilterState["subtitleType"] })}
        >
          <option value="">Any</option>
          <option value="hardsub">Hardsub</option>
          <option value="softsub">Softsub</option>
        </select>
      </label>
      <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-300">
        <input
          type="checkbox"
          checked={filters.preferDub}
          onChange={(e) => onChange({ preferDub: e.target.checked })}
          className="h-4 w-4 rounded accent-brand-500"
        />
        Prefer dub when sorting by quality
      </label>
      <label className="block text-xs text-slate-400">
        Sort by
        <select
          className="input mt-1"
          value={filters.sortBy}
          onChange={(e) => onChange({ sortBy: e.target.value as StreamFilterState["sortBy"] })}
        >
          <option value="quality">Quality</option>
          <option value="size">Size</option>
          <option value="seeders">Seeders</option>
        </select>
      </label>
      <p className="text-[10px] leading-snug text-slate-500">
        Dub/sub uses AIOStreams parsed languages when your formatter includes 🌎 / 📝 lines (or
        streamData.parsedFile); otherwise release-name regex. Verify filename if unsure.
      </p>
    </div>
  );
}

export function StreamResultsPanel({
  streams,
  filtered,
  grabbed,
  onGrabCached,
  onGrabCache,
  showLocalDownload,
  onLocalDownload,
  onCopyLink,
  filters,
  onFiltersChange,
  presets,
  onApplyPreset,
  onSavePreset,
  onDeletePreset,
}: {
  streams: StreamResult[];
  filtered: StreamResult[];
  grabbed: Set<string>;
  onGrabCached: (s: StreamResult) => void;
  onGrabCache: (s: StreamResult) => void;
  showLocalDownload?: boolean;
  onLocalDownload?: (s: import("../types").StreamResult) => void;
  onCopyLink?: (s: import("../types").StreamResult) => void;
  filters: StreamFilterState;
  onFiltersChange: (patch: Partial<StreamFilterState>) => void;
  presets?: StreamFilterPreset[];
  onApplyPreset?: (name: string) => void;
  onSavePreset?: (name: string) => void;
  onDeletePreset?: (name: string) => void;
}) {
  const searchText = filters.searchText ?? "";

  const indexerOptions = useMemo(
    () =>
      Array.from(new Set(streams.map((s) => s.indexer).filter((v): v is string => !!v))).sort(),
    [streams]
  );
  const releaseGroupOptions = useMemo(
    () =>
      Array.from(
        new Set(streams.map((s) => s.release_group).filter((v): v is string => !!v))
      ).sort(),
    [streams]
  );

  const PAGE_SIZE = 100;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Reset paging when the result set fundamentally changes (new search) or any
  // filter changes — filtered.length is a cheap, adequate proxy for both.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [streams, filters]);

  const visible = filtered.slice(0, visibleCount);

  return (
    <div className="min-w-0 space-y-4">
      <div className="card flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
        <label className="flex min-w-0 flex-1 items-center gap-2">
          <Search className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
          <span className="sr-only">Search stream titles</span>
          <input
            type="search"
            className="input min-w-0 flex-1"
            value={searchText}
            onChange={(e) => onFiltersChange({ searchText: e.target.value })}
            placeholder="Search release names, filenames, codec… (e.g. remux 1080p)"
          />
        </label>
        <div className="shrink-0 text-xs text-slate-500 sm:text-right">
          {filtered.length > visibleCount
            ? `showing ${visibleCount} of ${filtered.length} matches (${streams.length} total)`
            : `${filtered.length} of ${streams.length} streams`}
        </div>
      </div>
      <div className="grid min-w-0 gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
        <StreamFiltersPanel
          filters={filters}
          onChange={onFiltersChange}
          shownCount={filtered.length}
          totalCount={streams.length}
          indexerOptions={indexerOptions}
          releaseGroupOptions={releaseGroupOptions}
          presets={presets}
          onApplyPreset={onApplyPreset}
          onSavePreset={onSavePreset}
          onDeletePreset={onDeletePreset}
        />
        <div className="min-w-0 space-y-2">
          {filtered.length === 0 ? (
            <div className="rounded-lg border border-dashed border-white/10 px-4 py-8 text-center text-sm text-slate-500">
              No streams match your search or filters.
            </div>
          ) : (
            <>
              {visible.map((s, i) => (
                <StreamResultRow
                  key={streamKey(s) || String(i)}
                  stream={s}
                  index={i}
                  grabbed={grabbed}
                  onGrabCached={onGrabCached}
                  onGrabCache={onGrabCache}
                  showLocalDownload={showLocalDownload}
                  onLocalDownload={onLocalDownload}
                  onCopyLink={onCopyLink}
                />
              ))}
              {filtered.length > visibleCount && (
                <button
                  type="button"
                  className="btn-ghost w-full text-xs"
                  onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                >
                  Show {Math.min(PAGE_SIZE, filtered.length - visibleCount)} more (
                  {filtered.length - visibleCount} hidden)
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
