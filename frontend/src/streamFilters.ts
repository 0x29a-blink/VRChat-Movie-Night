export type StreamFilterState = {
  searchText: string;
  minRes: string;
  codec: string;
  maxSize: string;
  cachedOnly: boolean;
  minSeeders: string;
  sortBy: "quality" | "size" | "seeders";
  audioLang: "" | "dub" | "sub" | "dual";
  subtitleType: "" | "hardsub" | "softsub";
  preferDub: boolean;
  indexer: string;
  releaseGroup: string;
};

const STORAGE_KEY = "vrc-movie-night-stream-filters";

export const DEFAULT_STREAM_FILTERS: StreamFilterState = {
  searchText: "",
  minRes: "",
  codec: "",
  maxSize: "",
  cachedOnly: false,
  minSeeders: "",
  sortBy: "quality",
  audioLang: "",
  subtitleType: "",
  preferDub: false,
  indexer: "",
  releaseGroup: "",
};

export function loadStreamFilters(): StreamFilterState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_STREAM_FILTERS };
    const parsed = JSON.parse(raw) as Partial<StreamFilterState>;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructure strips searchText from the rest-spread
    const { searchText: _ignored, ...persisted } = parsed;
    return { ...DEFAULT_STREAM_FILTERS, ...persisted };
  } catch {
    return { ...DEFAULT_STREAM_FILTERS };
  }
}

export function saveStreamFilters(filters: StreamFilterState) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructure strips searchText from the rest-spread
    const { searchText: _ignored, ...persisted } = filters;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
  } catch {
    /* ignore quota errors */
  }
}

export type StreamFilterPreset = {
  name: string;
  filters: StreamFilterState;
};

const PRESETS_STORAGE_KEY = "vrc-movie-night-stream-filter-presets";

export function loadStreamPresets(): StreamFilterPreset[] {
  try {
    const raw = localStorage.getItem(PRESETS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as StreamFilterPreset[];
  } catch {
    return [];
  }
}

export function saveStreamPresets(list: StreamFilterPreset[]) {
  try {
    localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* ignore quota errors */
  }
}
