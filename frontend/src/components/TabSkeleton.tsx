import type { AppTab } from "../appNav";

type SkeletonVariant = "list" | "grid";

const TAB_VARIANT: Partial<Record<AppTab, SkeletonVariant>> = {
  tonight: "list",
  library: "grid",
  watchlist: "list",
  stats: "grid",
  add: "list",
  settings: "list",
};

function Block({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-white/5 ${className}`} />;
}

function ListSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Block className="h-7 w-40" />
        <Block className="h-9 w-28" />
      </div>
      <Block className="h-24 w-full" />
      <div className="space-y-3">
        <Block className="h-16 w-full" />
        <Block className="h-16 w-full" />
        <Block className="h-16 w-full" />
      </div>
    </div>
  );
}

function GridSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Block className="h-7 w-40" />
        <Block className="h-9 w-28" />
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Block key={i} className="aspect-[2/3] w-full" />
        ))}
      </div>
    </div>
  );
}

/**
 * Layout-matching placeholder shown while a lazily-loaded tab chunk fetches.
 * Never render a bare "Loading…" line — pulse blocks approximate the final
 * layout so the shell doesn't jump when the real content mounts.
 */
export function TabSkeleton({ tab }: { tab: AppTab }) {
  const variant = TAB_VARIANT[tab] ?? "list";
  return variant === "grid" ? <GridSkeleton /> : <ListSkeleton />;
}
