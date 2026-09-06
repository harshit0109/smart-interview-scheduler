import * as React from "react";
import { Progress } from "@/components/ui/progress";
import { formatScorePercent } from "@/lib/utils";

interface ScoreBarProps {
  label: string;
  score: number; // 0.0 to 1.0
  weight: number; // e.g. 0.30
  description?: string;
}

export const ScoreBar: React.FC<ScoreBarProps> = ({
  label,
  score,
  weight,
  description,
}) => {
  const percent = formatScorePercent(score);

  // Determine indicator color based on score
  const colorClass =
    percent >= 90
      ? "bg-emerald-600"
      : percent >= 75
      ? "bg-workday-blue"
      : percent >= 60
      ? "bg-amber-500"
      : "bg-rose-500";

  return (
    <div className="space-y-1.5 group">
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-slate-700">{label}</span>
          <span className="text-[10px] font-mono text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
            wt: {Math.round(weight * 100)}%
          </span>
        </div>
        <div className="font-mono font-bold text-slate-900">{percent}%</div>
      </div>

      <Progress value={percent} colorClass={colorClass} className="h-2" />

      {description && (
        <p className="text-[11px] text-slate-500 leading-tight pt-0.5">{description}</p>
      )}
    </div>
  );
};
