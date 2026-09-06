import * as React from "react";
import { Button } from "@/components/ui/button";
import { AlertCircle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface ErrorStateProps {
  title?: string;
  message: string;
  traceId?: string;
  onRetry?: () => void;
  className?: string;
}

export const ErrorState: React.FC<ErrorStateProps> = ({
  title = "Something went wrong",
  message,
  traceId,
  onRetry,
  className,
}) => {
  return (
    <div
      className={cn(
        "rounded-xl border border-rose-200 bg-rose-50/50 p-6 text-slate-800 space-y-3",
        className
      )}
    >
      <div className="flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <h4 className="text-sm font-bold text-rose-950">{title}</h4>
          <p className="text-sm text-rose-800 leading-relaxed">{message}</p>
          {traceId && (
            <p className="text-xs font-mono text-rose-600 pt-1">
              Reference ID: {traceId}
            </p>
          )}
        </div>
      </div>

      {onRetry && (
        <div className="pt-2 pl-8">
          <Button
            variant="outline"
            size="sm"
            onClick={onRetry}
            className="border-rose-300 text-rose-900 hover:bg-rose-100/60"
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
            Try again
          </Button>
        </div>
      )}
    </div>
  );
};
