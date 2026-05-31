export type AppTab = "downloads" | "library" | "watchlist" | "stats" | "queue" | "checklist" | "settings";

const VALID_TABS = new Set<AppTab>([
  "downloads",
  "library",
  "watchlist",
  "stats",
  "queue",
  "checklist",
  "settings",
]);

export function parseAppTab(value: string | null): AppTab | null {
  if (value && VALID_TABS.has(value as AppTab)) return value as AppTab;
  return null;
}

export type NavState = {
  tab: AppTab;
  watchlistGroupId?: number;
};

export function readNavFromLocation(): NavState {
  const params = new URLSearchParams(window.location.search);
  return {
    tab: parseAppTab(params.get("tab")) ?? "downloads",
    watchlistGroupId: params.has("group") ? Number(params.get("group")) : undefined,
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
  const qs = params.toString();
  const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
  window.history.replaceState(null, "", url);
}
