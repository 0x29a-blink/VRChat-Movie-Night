import { Search } from "lucide-react";
import { Star } from "lucide-react";
import { AddToWatchlistButton } from "./AddToWatchlist";
import { BROWSE_CARD, StreamOpenLink } from "./StreamOpenLink";
import type { SearchResult } from "../types";
import { streamOpenFromSearchResult } from "../streamOpenUrl";
import { watchlistPayloadFromSearch } from "./watchlistPayload";

/** TMDB search result tile — consistent actions for movies and series. */
export function MediaSearchCard({
  result,
  onOpen,
}: {
  result: SearchResult;
  onOpen: () => void;
}) {
  const params = streamOpenFromSearchResult(result);
  const watchlist = watchlistPayloadFromSearch(result);

  return (
    <div className={BROWSE_CARD}>
      <StreamOpenLink
        params={params}
        onOpenInPlace={onOpen}
        className="block w-full text-left no-underline text-inherit"
        title="Open streams"
      >
        <div className="aspect-[2/3] w-full bg-ink-800">
          {result.poster ? (
            <img src={result.poster} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="grid h-full place-items-center text-xs text-slate-600">No image</div>
          )}
        </div>
        <div className="p-2.5">
          <div className="line-clamp-2 text-sm font-medium leading-snug">{result.title}</div>
          <div className="mt-1 flex items-center justify-between gap-1 text-xs text-slate-400">
            <span>{result.year || "—"}</span>
            <span className="flex shrink-0 items-center gap-0.5">
              <Star className="h-3 w-3 text-amber-400" />
              {result.rating > 0 ? result.rating.toFixed(1) : "—"}
            </span>
          </div>
          <span className="chip mt-1.5 bg-white/5 text-[10px] text-slate-400">{result.type}</span>
        </div>
      </StreamOpenLink>
      <div className="grid grid-cols-2 gap-1.5 border-t border-white/5 p-2">
        <AddToWatchlistButton
          payload={watchlist}
          label="Watchlist"
          className="btn-ghost min-w-0 justify-center py-1.5 text-[10px]"
        />
        <StreamOpenLink
          params={params}
          onOpenInPlace={onOpen}
          className="btn-primary min-w-0 justify-center gap-1 py-1.5 text-[10px] no-underline"
          title="Find torrent streams"
        >
          <Search className="h-3 w-3 shrink-0" />
          Streams
        </StreamOpenLink>
      </div>
    </div>
  );
}
