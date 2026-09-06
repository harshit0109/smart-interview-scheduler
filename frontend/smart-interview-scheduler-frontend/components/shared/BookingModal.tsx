"use client";

import * as React from "react";
import { RecommendedSlot, InterviewRequest } from "@/lib/types";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatDateOnly, formatTimeRange } from "@/lib/utils";
import {
  Calendar,
  Clock,
  User,
  Users,
  Video,
  AlertTriangle,
  CheckCircle2,
  CalendarCheck,
} from "lucide-react";

interface BookingModalProps {
  isOpen: boolean;
  onClose: () => void;
  interview: InterviewRequest;
  slot: RecommendedSlot | null;
  onConfirm: () => Promise<void>;
  isBooking: boolean;
  bookingError?: string | null;
  bookingTraceId?: string | null;
}

const BOOKING_STEPS = [
  "Checking the selected slot...",
  "Confirming panelist availability...",
  "Creating Google Calendar event...",
  "Generating Google Meet video link...",
  "Finalizing confirmed booking...",
];

export const BookingModal: React.FC<BookingModalProps> = ({
  isOpen,
  onClose,
  interview,
  slot,
  onConfirm,
  isBooking,
  bookingError,
  bookingTraceId,
}) => {
  const [activeStepIndex, setActiveStepIndex] = React.useState(0);

  React.useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isBooking) {
      setActiveStepIndex(0);
      interval = setInterval(() => {
        setActiveStepIndex((prev) => (prev < BOOKING_STEPS.length - 1 ? prev + 1 : prev));
      }, 700);
    }
    return () => clearInterval(interval);
  }, [isBooking]);

  if (!slot) return null;

  return (
    <Dialog
      isOpen={isOpen}
      onClose={() => {
        if (!isBooking) onClose();
      }}
      title="Confirm Interview Booking"
      description="Review scheduling details before dispatching calendar event creation."
      className="max-w-xl"
    >
      {isBooking ? (
        <div className="py-8 px-4 text-center space-y-6">
          <div className="mx-auto w-14 h-14 rounded-full bg-workday-accent flex items-center justify-center text-workday-blue animate-pulse">
            <CalendarCheck className="w-8 h-8" />
          </div>

          <div>
            <h3 className="text-lg font-bold text-slate-900">
              Booking your interview...
            </h3>
            <p className="text-sm text-slate-500 mt-1">
              Please do not close this window while calendar invitations are generated.
            </p>
          </div>

          {/* Stepper feedback */}
          <div className="space-y-2.5 max-w-sm mx-auto text-left pt-2">
            {BOOKING_STEPS.map((step, idx) => {
              const isCompleted = idx < activeStepIndex;
              const isCurrent = idx === activeStepIndex;
              return (
                <div
                  key={step}
                  className="flex items-center gap-3 text-xs transition-opacity duration-200"
                  style={{ opacity: idx <= activeStepIndex ? 1 : 0.4 }}
                >
                  {isCompleted ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  ) : isCurrent ? (
                    <div className="w-4 h-4 border-2 border-workday-blue border-t-transparent rounded-full animate-spin shrink-0" />
                  ) : (
                    <div className="w-4 h-4 rounded-full border border-slate-300 shrink-0" />
                  )}
                  <span
                    className={
                      isCurrent
                        ? "font-semibold text-slate-900"
                        : isCompleted
                        ? "text-slate-600"
                        : "text-slate-400"
                    }
                  >
                    {step}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Details Box */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3.5 text-sm">
            <div className="flex items-center justify-between pb-2 border-b border-slate-200/70">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Round
              </span>
              <span className="font-semibold text-slate-900 capitalize">
                {interview.round_type.toLowerCase()} Interview ({interview.duration_minutes} mins)
              </span>
            </div>

            <div className="flex items-start gap-3">
              <User className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs text-slate-500 font-medium">Candidate</p>
                <p className="font-medium text-slate-900">{interview.candidate_name}</p>
                <p className="text-xs text-slate-400">{interview.candidate_email} ({interview.candidate_timezone})</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <Calendar className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs text-slate-500 font-medium">Date & Time</p>
                <p className="font-semibold text-slate-900">
                  {formatDateOnly(slot.start_time, interview.candidate_timezone)}
                </p>
                <p className="text-xs text-slate-600 mt-0.5">
                  {formatTimeRange(slot.start_time, slot.end_time, interview.candidate_timezone)}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <Users className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs text-slate-500 font-medium">Interview Panelists</p>
                <p className="font-medium text-slate-900">
                  {interview.panelists.map((p) => p.name).join(", ") || "Assigned interviewers"}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <Video className="w-4 h-4 text-workday-blue mt-0.5 shrink-0" />
              <div>
                <p className="text-xs text-slate-500 font-medium">Video Conferencing</p>
                <p className="font-medium text-workday-blue">
                  A Google Meet link will be generated automatically
                </p>
              </div>
            </div>
          </div>

          {/* Architectural notice */}
          <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-xs text-amber-900">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <p>
              The system will revalidate availability across all participant calendars to protect
              against double booking before creating the confirmed calendar event.
            </p>
          </div>

          {/* Booking Error feedback */}
          {bookingError && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 space-y-1">
              <div className="font-semibold flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                {bookingError}
              </div>
              {bookingTraceId && (
                <p className="text-[11px] font-mono text-rose-600">
                  Reference ID: {bookingTraceId}
                </p>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isBooking}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={onConfirm}
              isLoading={isBooking}
              className="bg-emerald-700 hover:bg-emerald-800 text-white font-semibold px-5"
            >
              Confirm & Book Slot
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
};
