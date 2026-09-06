import * as React from "react";
import { cn } from "@/lib/utils";

interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value: number; // 0 to 100
  colorClass?: string;
}

export function Progress({
  value,
  colorClass = "bg-workday-blue",
  className,
  ...props
}: ProgressProps) {
  const clamped = Math.min(Math.max(value, 0), 100);

  return (
    <div
      className={cn(
        "relative h-2 w-full overflow-hidden rounded-full bg-slate-100 border border-slate-200/60",
        className
      )}
      {...props}
    >
      <div
        className={cn("h-full transition-all duration-300 ease-out rounded-full", colorClass)}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
