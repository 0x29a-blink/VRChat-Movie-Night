const ANIME_PREFIXES = ["kitsu:", "mal:", "anilist:"] as const;

export function isAnimeStremioId(stremioId: string | null | undefined): boolean {
  const sid = (stremioId || "").trim().toLowerCase();
  return ANIME_PREFIXES.some((p) => sid.startsWith(p));
}

export function animeProviderLabel(stremioId: string | null | undefined): string {
  const sid = (stremioId || "").trim();
  if (sid.toLowerCase().startsWith("mal:")) return `MyAnimeList ${sid.slice(4)}`;
  if (sid.toLowerCase().startsWith("kitsu:")) return `Kitsu ${sid.slice(6)}`;
  if (sid.toLowerCase().startsWith("anilist:")) return `AniList ${sid.slice(8)}`;
  return sid || "Anime catalog";
}
