import { CheckCircle2, X, XCircle } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { createPortal } from "react-dom";

export type ToastKind = "success" | "error" | "info";

type ToastAction = {
  label: string;
  onClick: () => void;
};

type ToastItem = {
  id: number;
  message: string;
  kind: ToastKind;
  action?: ToastAction;
};

type ToastContextValue = {
  push: (message: string, kind?: ToastKind, action?: ToastAction) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const push = useCallback((message: string, kind: ToastKind = "info", action?: ToastAction) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, kind, action }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, action ? 8000 : 5000);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <div className="pointer-events-none fixed bottom-20 right-4 z-[200] flex max-w-sm flex-col gap-2">
          {/* bottom-20 (not bottom-4): static offset that clears the h-14
              SessionStrip (plan 025) on non-Tonight tabs. Toasts already
              render above the strip in z-order (200 > 40); this offset
              also keeps them visually clear of the strip when it's
              visible, at the cost of a little extra bottom margin on
              Tonight where the strip never shows. */}
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`pointer-events-auto flex items-start gap-2 rounded-xl border px-4 py-3 text-sm shadow-lg backdrop-blur-sm ${
                t.kind === "success"
                  ? "border-emerald-500/30 bg-emerald-950/90 text-emerald-100"
                  : t.kind === "error"
                    ? "border-red-500/30 bg-red-950/90 text-red-100"
                    : "border-white/10 bg-ink-900/95 text-slate-100"
              }`}
            >
              {t.kind === "success" ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              ) : t.kind === "error" ? (
                <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
              ) : null}
              <div className="flex-1 space-y-2">
                <span>{t.message}</span>
                {t.action && (
                  <button
                    type="button"
                    onClick={() => {
                      t.action?.onClick();
                      dismiss(t.id);
                    }}
                    className="block text-xs font-semibold underline underline-offset-2 hover:no-underline"
                  >
                    {t.action.label}
                  </button>
                )}
              </div>
              <button type="button" onClick={() => dismiss(t.id)} className="text-slate-400 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
