import * as React from "react";
import { InterviewStatus } from "@/lib/types";
import { Check, Circle } from "lucide-react";
import { cn } from "@/lib/utils";

interface InterviewTimelineProps {
  status: InterviewStatus;
  className?: string;
}

interface Step {
  id: string;
  label: string;
  isCompleted: (status: InterviewStatus) => boolean;
  isCurrent: (status: InterviewStatus) => boolean;
}

const STEPS: Step[] = [
  {
    id: "created",
    label: "Request Created",
    isCompleted: (s) => s !== "DRAFT",
    isCurrent: (s) => s === "DRAFT",
  },
  {
    id: "availability",
    label: "Candidate Availability",
    isCompleted: (s) =>
      s === "READY_FOR_SCHEDULING" ||
      s === "RECOMMENDED" ||
      s === "BOOKED" ||
      s === "COMPLETED",
    isCurrent: (s) => s === "AWAITING_CANDIDATE_AVAILABILITY",
  },
  {
    id: "ready",
    label: "Calendar Sync",
    isCompleted: (s) =>
      s === "RECOMMENDED" || s === "BOOKED" || s === "COMPLETED",
    isCurrent: (s) => s === "READY_FOR_SCHEDULING",
  },
  {
    id: "recommended",
    label: "Recommendations",
    isCompleted: (s) => s === "BOOKED" || s === "COMPLETED",
    isCurrent: (s) => s === "RECOMMENDED",
  },
  {
    id: "booked",
    label: "Booked & Meet Ready",
    isCompleted: (s) => s === "BOOKED" || s === "COMPLETED",
    isCurrent: (s) => s === "BOOKED",
  },
];

export const InterviewTimeline: React.FC<InterviewTimelineProps> = ({
  status,
  className,
}) => {
  return (
    <div className={cn("w-full py-4", className)}>
      <div className="relative flex items-center justify-between">
        {/* Progress Line */}
        <div className="absolute left-6 right-6 top-1/2 -translate-y-1/2 h-0.5 bg-slate-200 -z-0" />

        {STEPS.map((step) => {
          const completed = step.isCompleted(status);
          const current = step.isCurrent(status);

          return (
            <div
              key={step.id}
              className="relative z-10 flex flex-col items-center group"
            >
              <div
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold transition-colors duration-200 border-2",
                  completed
                    ? "bg-workday-blue border-workday-blue text-white shadow-sm"
                    : current
                    ? "bg-white border-workday-blue text-workday-blue ring-4 ring-workday-blue/10 animate-pulse"
                    : "bg-white border-slate-300 text-slate-400"
                )}
              >
                {completed ? (
                  <Check className="w-4 h-4 stroke-[3]" />
                ) : current ? (
                  <Circle className="w-3 h-3 fill-workday-blue text-workday-blue" />
                ) : (
                  <span className="w-2 h-2 rounded-full bg-slate-300" />
                )}
              </div>

              <span
                className={cn(
                  "mt-2 text-xs font-medium text-center max-w-[90px] leading-tight",
                  current
                    ? "text-workday-blue font-bold"
                    : completed
                    ? "text-slate-800"
                    : "text-slate-400"
                )}
              >
                {step.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
