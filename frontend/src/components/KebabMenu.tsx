import { MoreVertical } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type KebabMenuItem = {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  destructive?: boolean;
  disabled?: boolean;
};

/**
 * Generic "⋯" overflow menu. Trigger button + a portaled, absolutely
 * positioned menu card that follows the trigger and closes on outside
 * click, scroll/resize reflow, or Escape. No app-specific imports — reused
 * across Watchlist and (later) Library rows.
 */
export function KebabMenu({
  items,
  label = "More actions",
  className = "",
}: {
  items: KebabMenuItem[];
  label?: string;
  className?: string;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open || !buttonRef.current) return;

    const updatePosition = () => {
      if (!buttonRef.current) return;
      const rect = buttonRef.current.getBoundingClientRect();
      const menuWidth = menuRef.current?.offsetWidth ?? 192;
      const left = Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8));
      setPos({ top: rect.bottom + 6, left });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  // Focus the first menu item when the menu opens; return focus to the
  // trigger only when the menu actually closes (Escape, item activation,
  // outside click) — NOT on initial mount. Focusing on mount would call
  // .focus() (which scrolls the element into view) for every KebabMenu in a
  // list, so a long list of rows would scroll itself to the last row on load
  // and on every remount (tab/filter switch). preventScroll guards the
  // legitimate close case too, since the trigger is already in view.
  const hasOpenedRef = useRef(false);
  useEffect(() => {
    if (open) {
      hasOpenedRef.current = true;
      itemRefs.current[0]?.focus({ preventScroll: true });
    } else if (hasOpenedRef.current) {
      buttonRef.current?.focus({ preventScroll: true });
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const enabled = itemRefs.current
          .map((el, idx) => ({ el, idx }))
          .filter(({ el }) => el && !el.disabled);
        if (enabled.length === 0) return;
        const activeIdx = enabled.findIndex(({ el }) => el === document.activeElement);
        const delta = e.key === "ArrowDown" ? 1 : -1;
        const nextPos = activeIdx === -1 ? 0 : (activeIdx + delta + enabled.length) % enabled.length;
        enabled[nextPos].el?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const stop = (e: React.PointerEvent | React.MouseEvent) => e.stopPropagation();

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        onPointerDown={stop}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        title={label}
        className={`btn-ghost flex min-h-11 min-w-11 shrink-0 items-center justify-center px-1 py-0.5 text-slate-400 ${className}`}
      >
        <MoreVertical className="h-3.5 w-3.5" />
        <span className="sr-only">{label}</span>
      </button>
      {open &&
        pos &&
        createPortal(
          <>
            <button
              type="button"
              className="fixed inset-0 z-40"
              aria-label="Close menu"
              onClick={() => setOpen(false)}
            />
            <div
              ref={menuRef}
              role="menu"
              className="card fixed z-50 w-48 max-w-[calc(100vw-1rem)] p-1 shadow-xl"
              style={{ top: pos.top, left: pos.left }}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={stop}
            >
              {items.map((item, idx) => (
                <button
                  key={idx}
                  ref={(el) => {
                    itemRefs.current[idx] = el;
                  }}
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  onClick={() => {
                    setOpen(false);
                    item.onClick();
                  }}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs disabled:cursor-not-allowed disabled:opacity-40 ${
                    item.destructive
                      ? "text-red-400 hover:bg-red-500/10"
                      : "text-slate-200 hover:bg-white/5"
                  }`}
                >
                  {item.icon}
                  {item.label}
                </button>
              ))}
            </div>
          </>,
          document.body
        )}
    </>
  );
}
