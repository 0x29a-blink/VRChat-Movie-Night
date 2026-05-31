import type { StreamFilterState } from "../streamFilters";
import type { StreamResult } from "../types";
import { RES_OPTIONS, streamKey } from "../streamListUtils";
import { StreamResultRow } from "./StreamResultRow";

export function StreamFiltersPanel({
  filters,
  onChange,
  shownCount,
  totalCount,
}: {
  filters: StreamFilterState;
  onChange: (patch: Partial<StreamFilterState>) => void;
  shownCount: number;
  totalCount: number;
}) {
  return (
    <div className="card h-fit space-y-4 p-4">
      <div className="text-sm font-semibold">Filters</div>
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
        Cached = instant download. Uncached = “Cache &amp; download” (TorBox API key). Seed counts come from
        indexers — TorBox may show fewer live peers. Rows without a resolution badge usually lack it in the addon
        name (check filename below).
      </p>
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
      <div className="text-[11px] text-slate-500">
        {shownCount} of {totalCount} shown
      </div>
    </div>
  );
}

export function StreamResultsPanel({
  streams,
  filtered,
  grabbed,
  onGrabCached,
  onGrabCache,
  filters,
  onFiltersChange,
}: {
  streams: StreamResult[];
  filtered: StreamResult[];
  grabbed: Set<string>;
  onGrabCached: (s: StreamResult) => void;
  onGrabCache: (s: StreamResult) => void;
  filters: StreamFilterState;
  onFiltersChange: (patch: Partial<StreamFilterState>) => void;
}) {
  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
      <StreamFiltersPanel
        filters={filters}
        onChange={onFiltersChange}
        shownCount={filtered.length}
        totalCount={streams.length}
      />
      <div className="min-w-0 space-y-2">
        {filtered.map((s, i) => (
          <StreamResultRow
            key={streamKey(s) || String(i)}
            stream={s}
            index={i}
            grabbed={grabbed}
            onGrabCached={onGrabCached}
            onGrabCache={onGrabCache}
          />
        ))}
      </div>
    </div>
  );
}
