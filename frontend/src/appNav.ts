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
// a single segmented control. Lives in the URL as `sub` so
// `?tab=add&sub=browse` is a 1-click deep link.
//
// UI v3 merge: the old top-level "catalogs" and "collections" tabs were the
// same browse component pointed at two sources, so they collapsed into one
// "browse" tab with an internal Collections | AIOStreams switcher. The inner
// source persists in the URL as `src`; legacy `?sub=` values (catalogs,
// collections, and the even older browse/anime) are mapped below so old
// deep links keep resolving to the right inner source.
export type AddSource = "search" | "browse" | "youtube" | "m3u8";
export type AddBrowseSource = "collections" | "aiostreams";

export type NavState = {
  tab: AppTab;
  watchlistGroupId?: number;
  watchlistSection?: WatchlistSection;
  addSource?: AddSource;
  /** Inner source of the merged Browse tab; only meaningful when addSource === "browse". */
  addBrowseSource?: AddBrowseSource;
};

function parseWatchlistSection(value: string | null): WatchlistSection | undefined {
  if (value === "watched" || value === "to_watch") return value;
  return undefined;
}

const VALID_ADD_SOURCES = new Set<AddSource>(["search", "browse", "youtube", "m3u8"]);

// Legacy `?sub=` values, mapped to the merged Browse tab and (where the old
// value implied one) its inner source.
const LEGACY_ADD_SOURCE_ALIASES: Record<string, { source: AddSource; browse?: AddBrowseSource }> = {
  catalogs: { source: "browse", browse: "aiostreams" },
  collections: { source: "browse", browse: "collections" },
  anime: { source: "browse", browse: "aiostreams" },
};

function parseAddSource(value: string | null): { source?: AddSource; browse?: AddBrowseSource } {
  if (!value) return {};
  const legacy = LEGACY_ADD_SOURCE_ALIASES[value];
  if (legacy) return { source: legacy.source, browse: legacy.browse };
  if (VALID_ADD_SOURCES.has(value as AddSource)) return { source: value as AddSource };
  return {};
}

function parseAddBrowseSource(value: string | null): AddBrowseSource | undefined {
  if (value === "collections" || value === "aiostreams") return value;
  return undefined;
}

export function readNavFromLocation(): NavState {
  const params = new URLSearchParams(window.location.search);
  const { source: addSource, browse: legacyBrowse } = parseAddSource(params.get("sub"));
  const addBrowseSource =
    addSource === "browse" ? (parseAddBrowseSource(params.get("src")) ?? legacyBrowse) : undefined;
  return {
    tab: parseAppTab(params.get("tab")) ?? "tonight",
    watchlistGroupId: params.has("group") ? Number(params.get("group")) : undefined,
    watchlistSection: parseWatchlistSection(params.get("section")),
    addSource,
    addBrowseSource,
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
  if (state.tab === "add" && state.addSource === "browse" && state.addBrowseSource) {
    params.set("src", state.addBrowseSource);
  } else {
    params.delete("src");
  }
  const qs = params.toString();
  const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
  window.history.replaceState(null, "", url);
}
