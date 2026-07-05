export type AppTab = "tonight" | "library" | "watchlist" | "stats" | "add" | "settings";

// "tonight" and "add" are the canonical target-state nav names (see
// plans/022-ui-v2-design-spec.md, landed by plan 024). "downloads", "queue",
// and "checklist" are legacy URL values from before the Tonight rework —
// they're accepted as aliases and canonicalized to the panels that absorbed
// them (Add Media and the Tonight cockpit) so old bookmarks/links keep working.
type LegacyOrAliasTab = AppTab | "downloads" | "queue" | "checklist";

const VALID_INPUT_TABS = new Set<LegacyOrAliasTab>([
  "tonight",
  "library",
  "watchlist",
  "stats",
  "add",
  "settings",
  "downloads",
  "queue",
  "checklist",
]);

const ALIAS_TO_CANONICAL: Partial<Record<LegacyOrAliasTab, AppTab>> = {
  downloads: "add",
  queue: "tonight",
  checklist: "tonight",
};

function parseAppTab(value: string | null): AppTab | null {
  if (!value || !VALID_INPUT_TABS.has(value as LegacyOrAliasTab)) return null;
  const input = value as LegacyOrAliasTab;
  return ALIAS_TO_CANONICAL[input] ?? (input as AppTab);
}

export type WatchlistSection = "to_watch" | "watched";

// AddSource backs the "Add Media" flattened source picker (plan 026):
// a single segmented control replacing the old 4-level nesting
// (tab -> Downloads TABS -> Search mode -> Browse source). Lives in the
// URL as `sub` so `?tab=add&sub=catalogs` is a 1-click deep link.
//
// Plan 031 (honest taxonomy): "browse" was actually TMDB collections and
// "anime" was actually the general AIOStreams catalog browser (pre-filtered
// to one catalog) — renamed to what they really are. Legacy `?sub=` values
// are mapped in parseAddSource below so old deep links keep resolving.
export type AddSource = "search" | "catalogs" | "collections" | "youtube" | "m3u8";

export type NavState = {
  tab: AppTab;
  watchlistGroupId?: number;
  watchlistSection?: WatchlistSection;
  addSource?: AddSource;
};

function parseWatchlistSection(value: string | null): WatchlistSection | undefined {
  if (value === "watched" || value === "to_watch") return value;
  return undefined;
}

const VALID_ADD_SOURCES = new Set<AddSource>(["search", "catalogs", "collections", "youtube", "m3u8"]);

// Legacy `?sub=` values from before plan 031's rename, mapped to their
// honest equivalents so old deep links/bookmarks still resolve.
const LEGACY_ADD_SOURCE_ALIASES: Record<string, AddSource> = {
  browse: "collections",
  anime: "catalogs",
};

function parseAddSource(value: string | null): AddSource | undefined {
  if (!value) return undefined;
  if (LEGACY_ADD_SOURCE_ALIASES[value]) return LEGACY_ADD_SOURCE_ALIASES[value];
  if (VALID_ADD_SOURCES.has(value as AddSource)) return value as AddSource;
  return undefined;
}

export function readNavFromLocation(): NavState {
  const params = new URLSearchParams(window.location.search);
  return {
    tab: parseAppTab(params.get("tab")) ?? "tonight",
    watchlistGroupId: params.has("group") ? Number(params.get("group")) : undefined,
    watchlistSection: parseWatchlistSection(params.get("section")),
    addSource: parseAddSource(params.get("sub")),
  };
}

export function writeNavToLocation(state: NavState, preserveStreamParams = false) {
  const params = new URLSearchParams(window.location.search);
  if (!preserveStreamParams) {
    params.delete("open");
    params.delete("openStremio");
    params.delete("media");
  }
  params.set("tab", state.tab);
  if (state.tab === "watchlist" && state.watchlistGroupId != null && !Number.isNaN(state.watchlistGroupId)) {
    params.set("group", String(state.watchlistGroupId));
  } else {
    params.delete("group");
  }
  if (state.tab === "watchlist" && state.watchlistSection === "watched") {
    params.set("section", "watched");
  } else {
    params.delete("section");
  }
  if (state.tab === "add" && state.addSource) {
    params.set("sub", state.addSource);
  } else {
    params.delete("sub");
  }
  const qs = params.toString();
  const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
  window.history.replaceState(null, "", url);
}
