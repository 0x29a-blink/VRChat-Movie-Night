export type AppTab = "downloads" | "library" | "watchlist" | "stats" | "queue" | "checklist" | "settings";

// "tonight" and "add" are target-state nav names (see
// plans/022-ui-v2-design-spec.md). In THIS plan they are accepted as URL
// aliases and canonicalized to the existing panels they currently render
// ("queue" and "downloads" respectively) — no layout change yet. Plan 024
// flips this: those become the real canonical AppTab values and this mapping
// direction reverses (existing values will alias to them instead).
type LegacyOrAliasTab = AppTab | "tonight" | "add";

const VALID_INPUT_TABS = new Set<LegacyOrAliasTab>([
  "downloads",
  "library",
  "watchlist",
  "stats",
  "queue",
  "checklist",
  "settings",
  "tonight",
  "add",
]);

const ALIAS_TO_CANONICAL: Partial<Record<LegacyOrAliasTab, AppTab>> = {
  tonight: "queue",
  add: "downloads",
};

function parseAppTab(value: string | null): AppTab | null {
  if (!value || !VALID_INPUT_TABS.has(value as LegacyOrAliasTab)) return null;
  const input = value as LegacyOrAliasTab;
  return ALIAS_TO_CANONICAL[input] ?? (input as AppTab);
}

export type WatchlistSection = "to_watch" | "watched";

export type NavState = {
  tab: AppTab;
  watchlistGroupId?: number;
  watchlistSection?: WatchlistSection;
};

function parseWatchlistSection(value: string | null): WatchlistSection | undefined {
  if (value === "watched" || value === "to_watch") return value;
  return undefined;
}

export function readNavFromLocation(): NavState {
  const params = new URLSearchParams(window.location.search);
  return {
    tab: parseAppTab(params.get("tab")) ?? "downloads",
    watchlistGroupId: params.has("group") ? Number(params.get("group")) : undefined,
    watchlistSection: parseWatchlistSection(params.get("section")),
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
  const qs = params.toString();
  const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
  window.history.replaceState(null, "", url);
}
