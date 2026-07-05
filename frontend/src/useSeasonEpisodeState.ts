import { useState } from "react";
import type { TmdbEpisode } from "./types";

type SeasonSummary = {
  season_number: number;
  name: string;
  episode_count: number;
};

export function useSeasonEpisodeState() {
  const [seasons, setSeasons] = useState<SeasonSummary[]>([]);
  const [season, setSeason] = useState<number | undefined>();
  const [episode, setEpisode] = useState<number | undefined>();
  const [episodes, setEpisodes] = useState<TmdbEpisode[]>([]);
  const [loadingEpisodes, setLoadingEpisodes] = useState(false);

  return {
    seasons,
    setSeasons,
    season,
    setSeason,
    episode,
    setEpisode,
    episodes,
    setEpisodes,
    loadingEpisodes,
    setLoadingEpisodes,
  };
}
