import * as React from "react";
import { ScoreBreakdown as ScoreBreakdownType } from "@/lib/types";
import { ScoreBar } from "./ScoreBar";
import { Info } from "lucide-react";

interface ScoreBreakdownProps {
  breakdown: ScoreBreakdownType;
  className?: string;
}

export const ScoreBreakdown: React.FC<ScoreBreakdownProps> = ({
  breakdown,
  className,
}) => {
  return (
    <div className={className}>
      <div className="flex items-center justify-between pb-2 mb-3 border-b border-slate-100">
        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
          <Info className="w-3.5 h-3.5 text-workday-blue" />
          Deterministic 5-Factor Score Breakdown
        </h4>
        <span className="text-[10px] text-slate-400 font-medium">Sum = 100%</span>
      </div>

      <div className="space-y-3">
        <ScoreBar
          label="Timezone Fairness"
          score={breakdown.timezone_fairness}
          weight={0.30}
          description="Balances local daylight hours across all participants' time zones."
        />

        <ScoreBar
          label="Working-Hours Comfort"
          score={breakdown.working_hours_comfort}
          weight={0.20}
          description="Avoids early mornings, late evenings, or core lunch breaks."
        />

        <ScoreBar
          label="Scheduling Proximity"
          score={breakdown.scheduling_proximity}
          weight={0.20}
          description="Favors earlier available dates to speed hiring velocity."
        />

        <ScoreBar
          label="Workload Balance"
          score={breakdown.workload_balance}
          weight={0.15}
          description="Prevents interview fatigue and back-to-back panel commitments."
        />

        <ScoreBar
          label="Buffer Quality"
          score={breakdown.buffer_quality}
          weight={0.15}
          description="Guarantees protected prep and debrief breathing room."
        />
      </div>
    </div>
  );
};
