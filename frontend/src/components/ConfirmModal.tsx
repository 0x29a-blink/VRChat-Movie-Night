import { createPortal } from "react-dom";

export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4" onClick={onCancel}>
      <div
        className="card w-full max-w-sm p-5"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 className={`text-base font-semibold ${danger ? "text-red-300" : "text-white"}`}>{title}</h3>
        <div className="mt-2 text-sm text-slate-300">{message}</div>
        <div className="mt-5 flex gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className="btn-ghost flex-1">
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`btn-primary flex-1 ${danger ? "!bg-red-600 hover:!bg-red-500" : ""}`}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export function PromptModal({
  open,
  title,
  message,
  value,
  onChange,
  confirmLabel = "OK",
  cancelLabel = "Cancel",
  busy = false,
  inputType = "text",
  placeholder = "",
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message?: React.ReactNode;
  value: string;
  onChange: (v: string) => void;
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  inputType?: string;
  placeholder?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4" onClick={onCancel}>
      <div
        className="card w-full max-w-sm p-5"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-white">{title}</h3>
        {message && <div className="mt-2 text-sm text-slate-300">{message}</div>}
        <input
          type={inputType}
          className="input mt-4 w-full"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoFocus
          onKeyDown={(e) => e.key === "Enter" && value.trim() && onConfirm()}
        />
        <div className="mt-5 flex gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className="btn-ghost flex-1">
            {cancelLabel}
          </button>
          <button type="button" onClick={onConfirm} disabled={busy || !value.trim()} className="btn-primary flex-1">
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
