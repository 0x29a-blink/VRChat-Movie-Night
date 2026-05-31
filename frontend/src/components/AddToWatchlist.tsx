import { BookmarkPlus } from "lucide-react";
import type { WatchlistAddPayload } from "../watchlistAddModal";
import { useWatchlistAdd } from "../watchlistAddModal";

export type { WatchlistAddPayload } from "../watchlistAddModal";

export function AddToWatchlistButton({
  payload,
  label = "Watchlist",
  className = "btn-ghost text-xs",
}: {
  payload: WatchlistAddPayload;
  label?: string;
  className?: string;
}) {
  const { openWatchlistAdd } = useWatchlistAdd();

  const openModal = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    openWatchlistAdd(payload);
  };

  return (
    <button type="button" onClick={openModal} onMouseDown={(e) => e.stopPropagation()} className={className}>
      <BookmarkPlus className="h-3.5 w-3.5" /> {label}
    </button>
  );
}
