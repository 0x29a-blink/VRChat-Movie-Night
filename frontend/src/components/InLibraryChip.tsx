export function InLibraryChip({ className = "" }: { className?: string }) {
  return (
    <span
      className={`chip bg-emerald-500/15 text-emerald-300 ${className}`.trim()}
      title="A downloaded file for this title exists in your Library folder"
    >
      In library
    </span>
  );
}
