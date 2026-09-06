import * as React from "react";
import { RecommendedSlot } from "@/lib/types";
import { formatDateOnly, formatTimeRange, formatScorePercent } from "@/lib/utils";
import { ScoreBreakdown } from "./ScoreBreakdown";
import { Button } from "@/components/ui/button";
import {
  Sparkles,
  Check,
  Calendar,
  Clock,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface RecommendationCardProps {
  slot: RecommendedSlot;
  isSelected?: boolean;
  onSelect?: (slot: RecommendedSlot) => void;
  isReadOnly?: boolean; // When viewed by Candidate
  displayTimezone?: string;
  secondaryTimezone?: string;
}

export const RecommendationCard: React.FC<RecommendationCardProps> = ({
  slot,
  isSelected = false,
  onSelect,
  isReadOnly = false,
  displayTimezone,
  secondaryTimezone,
}) => {
  const [showDetails, setShowDetails] = React.useState(true);
  const matchPercent = formatScorePercent(slot.total_score);
  const isTopRank = slot.rank === 1;

  const dateStr = formatDateOnly(slot.start_time, displayTimezone);
  const timeRangeStr = formatTimeRange(slot.start_time, slot.end_time, displayTimezone);
  const secondaryTimeStr = secondaryTimezone
    ? formatTimeRange(slot.start_time, slot.end_time, secondaryTimezone)
    : null;

  return (
    <div
      className={cn(
        "rounded-xl border transition-all duration-200 bg-white relative overflow-hidden",
        isSelected
          ? "border-workday-blue ring-2 ring-workday-blue/20 shadow-enterprise"
          : isTopRank
          ? "border-indigo-200 shadow-sm hover:border-indigo-300 hover:shadow-card"
          : "border-slate-200 shadow-sm hover:border-slate-300 hover:shadow-card"
      )}
    >
      {/* Top Banner for Best Match */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-slate-100 bg-slate-50/70">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "text-xs font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full flex items-center gap-1",
              isTopRank
                ? "bg-indigo-100 text-indigo-800"
                : "bg-slate-200/80 text-slate-700"
            )}
          >
            {isTopRank && <Sparkles className="w-3 h-3 text-indigo-600" />}
            #{slot.rank} {isTopRank ? "BEST MATCH" : "ALTERNATIVE"}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-xs text-slate-500 font-medium">Match:</span>
          <span
            className={cn(
              "text-sm font-bold font-mono px-2 py-0.5 rounded",
              matchPercent >= 90
                ? "bg-emerald-100 text-emerald-800"
                : "bg-workday-accent text-workday-blue"
            )}
          >
            {matchPercent}%
          </span>
        </div>
      </div>

      {/* Main slot details */}
      <div className="p-6">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-slate-900 font-semibold text-lg">
              <Calendar className="w-5 h-5 text-workday-blue shrink-0" />
              <span>{dateStr}</span>
            </div>

            <div className="flex items-center gap-2 text-slate-700 font-medium text-base mt-1">
              <Clock className="w-4 h-4 text-slate-400 shrink-0" />
              <span>{timeRangeStr}</span>
            </div>

            {secondaryTimeStr && (
              <p className="text-xs text-slate-500 mt-1 pl-6">
                Candidate time: {secondaryTimeStr}
              </p>
            )}
          </div>

          {!isReadOnly && onSelect && (
            <Button
              type="button"
              variant={isSelected ? "primary" : "outline"}
              onClick={() => onSelect(slot)}
              className={cn(
                "self-start shrink-0 min-w-[150px]",
                isSelected
                  ? "bg-emerald-700 hover:bg-emerald-800 text-white"
                  : "border-slate-300 text-slate-700 hover:border-workday-blue hover:text-workday-blue"
              )}
            >
              {isSelected ? (
                <>
                  <Check className="w-4 h-4 mr-1.5 stroke-[3]" />
                  Selected
                </>
              ) : (
                "Select this time"
              )}
            </Button>
          )}
        </div>

        {/* Explainability Section */}
        <div className="mt-5 rounded-lg bg-slate-50 p-4 border border-slate-100">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
              Why this slot?
            </h4>
            <button
              type="button"
              onClick={() => setShowDetails(!showDetails)}
              className="text-xs text-workday-blue hover:underline flex items-center gap-0.5"
            >
              {showDetails ? "Hide breakdown" : "Show breakdown"}
              {showDetails ? (
                <ChevronUp className="w-3 h-3" />
              ) : (
                <ChevronDown className="w-3 h-3" />
              )}
            </button>
          </div>

          <p className="text-sm text-slate-700 leading-relaxed font-normal">
            {slot.explanation}
          </p>

          {showDetails && (
            <div className="mt-4 pt-4 border-t border-slate-200/80">
              <ScoreBreakdown breakdown={slot.score_breakdown} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
