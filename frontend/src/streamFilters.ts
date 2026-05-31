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
};

export function loadStreamFilters(): StreamFilterState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_STREAM_FILTERS };
    const parsed = JSON.parse(raw) as Partial<StreamFilterState>;
    const { searchText: _ignored, ...persisted } = parsed;
    return { ...DEFAULT_STREAM_FILTERS, ...persisted };
  } catch {
    return { ...DEFAULT_STREAM_FILTERS };
  }
}

export function saveStreamFilters(filters: StreamFilterState) {
  try {
    const { searchText: _ignored, ...persisted } = filters;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
  } catch {
    /* ignore quota errors */
  }
}
