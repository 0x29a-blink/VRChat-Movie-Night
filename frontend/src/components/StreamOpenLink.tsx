import { ExternalLink } from "lucide-react";
import type { StreamOpenParams } from "../streamOpenUrl";
import { openStreamInNewTab, streamOpenHref } from "../streamOpenUrl";

/** Static card — no hover, blur, or transitions (prevents grid flicker). */
export const BROWSE_CARD =
  "rounded-2xl border border-white/5 bg-ink-850/90 overflow-hidden text-left";

export function StreamOpenLink({
  params,
  onOpenInPlace,
  className,
  children,
  disabled,
  title,
}: {
  params: StreamOpenParams;
  onOpenInPlace: () => void;
  className?: string;
  children: React.ReactNode;
  disabled?: boolean;
  title?: string;
}) {
  const href = streamOpenHref(params);

  const openNewTab = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    openStreamInNewTab(params);
  };

  return (
    <a
      href={disabled ? undefined : href}
      title={title}
      className={className}
      onClick={(e) => {
        if (disabled) {
          e.preventDefault();
          return;
        }
        if (e.metaKey || e.ctrlKey || e.shiftKey) {
          openNewTab(e);
          return;
        }
        if (e.button !== 0) return;
        e.preventDefault();
        onOpenInPlace();
      }}
      onMouseDown={(e) => {
        if (disabled) return;
        if (e.button === 1) openNewTab(e);
      }}
      onAuxClick={(e) => {
        if (disabled) return;
        if (e.button === 1) openNewTab(e);
      }}
    >
      {children}
    </a>
  );
}

// fallow-ignore-next-line unused-export
export function StreamNewTabButton({
  params,
  disabled,
  className = "btn-ghost shrink-0 px-2 py-1 text-[10px]",
}: {
  params: StreamOpenParams;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title="Open streams in new tab"
      className={className}
      onClick={(e) => {
        e.stopPropagation();
        openStreamInNewTab(params);
      }}
    >
      <ExternalLink className="h-3 w-3" />
    </button>
  );
}
