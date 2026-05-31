export type StreamFilterState = {
  minRes: string;
  codec: string;
  maxSize: string;
  cachedOnly: boolean;
  minSeeders: string;
  sortBy: "quality" | "size" | "seeders";
};

const STORAGE_KEY = "vrc-movie-night-stream-filters";

export const DEFAULT_STREAM_FILTERS: StreamFilterState = {
  minRes: "",
  codec: "",
  maxSize: "",
  cachedOnly: false,
  minSeeders: "",
  sortBy: "quality",
};

export function loadStreamFilters(): StreamFilterState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_STREAM_FILTERS };
    const parsed = JSON.parse(raw) as Partial<StreamFilterState>;
    return { ...DEFAULT_STREAM_FILTERS, ...parsed };
  } catch {
    return { ...DEFAULT_STREAM_FILTERS };
  }
}

export function saveStreamFilters(filters: StreamFilterState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
  } catch {
    /* ignore quota errors */
  }
}
