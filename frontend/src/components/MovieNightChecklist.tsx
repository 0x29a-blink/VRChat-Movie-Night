import { PreflightPanel } from "./PreflightPanel";

interface Props {
  onIssuesChange?: (count: number) => void;
}

export function MovieNightChecklist({ onIssuesChange }: Props) {
  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Movie Night Checklist</h1>
        <p className="mt-1 text-sm text-slate-400">
          Run through this before guests join. HLS will show inactive until you click Go live — that is normal.
        </p>
      </div>
      <PreflightPanel onUpdate={(s) => onIssuesChange?.((s.issues ?? []).length)} />
    </div>
  );
}
