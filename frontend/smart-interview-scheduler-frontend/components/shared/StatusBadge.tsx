import * as React from "react";
import { InterviewStatus } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import {
  Clock,
  UserCheck,
  CalendarCheck2,
  CheckCircle2,
  Sparkles,
  AlertCircle,
  XCircle,
  RotateCcw,
} from "lucide-react";

interface StatusBadgeProps {
  status: InterviewStatus;
  className?: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, className }) => {
  switch (status) {
    case "DRAFT":
      return (
        <Badge variant="outline" className={className}>
          <Clock className="w-3 h-3 text-slate-500" />
          <span>Draft</span>
        </Badge>
      );
    case "AWAITING_CANDIDATE_AVAILABILITY":
      return (
        <Badge variant="warning" className={className}>
          <UserCheck className="w-3 h-3 text-amber-600" />
          <span>Awaiting Availability</span>
        </Badge>
      );
    case "READY_FOR_SCHEDULING":
      return (
        <Badge variant="info" className={className}>
          <CalendarCheck2 className="w-3 h-3 text-sky-600" />
          <span>Ready to Schedule</span>
        </Badge>
      );
    case "RECOMMENDED":
      return (
        <Badge variant="secondary" className={className}>
          <Sparkles className="w-3 h-3 text-indigo-600" />
          <span>Recommended</span>
        </Badge>
      );
    case "BOOKED":
      return (
        <Badge variant="success" className={className}>
          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
          <span>Booked & Confirmed</span>
        </Badge>
      );
    case "COMPLETED":
      return (
        <Badge variant="default" className={className}>
          <CheckCircle2 className="w-3 h-3 text-slate-600" />
          <span>Completed</span>
        </Badge>
      );
    case "FAILED":
      return (
        <Badge variant="danger" className={className}>
          <AlertCircle className="w-3 h-3 text-rose-600" />
          <span>Scheduling Failed</span>
        </Badge>
      );
    case "CANCELLED":
      return (
        <Badge variant="outline" className={className}>
          <XCircle className="w-3 h-3 text-slate-400" />
          <span>Cancelled</span>
        </Badge>
      );
    case "RESCHEDULING":
      return (
        <Badge variant="warning" className={className}>
          <RotateCcw className="w-3 h-3 text-amber-600" />
          <span>Rescheduling</span>
        </Badge>
      );
    default:
      return <Badge variant="default" className={className}>{status}</Badge>;
  }
};
