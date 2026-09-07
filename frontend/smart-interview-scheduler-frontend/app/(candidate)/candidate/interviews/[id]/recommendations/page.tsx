"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { interviewsApi, bookingApi } from "@/lib/api-client";
import { RecommendedSlot, InterviewRequest, InterviewEvent } from "@/lib/types";
import { RecommendationCard } from "@/components/shared/RecommendationCard";
import { Button } from "@/components/ui/button";
import { formatDateOnly, formatTimeRange } from "@/lib/utils";
import { ArrowLeft, Info, CheckCircle2, AlertCircle, Video } from "lucide-react";

export default function CandidateRecommendationsPage() {
  const params = useParams();
  const interviewId = params.id as string;

  const [interview, setInterview] = React.useState<InterviewRequest | null>(null);
  const [slots, setSlots] = React.useState<RecommendedSlot[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);

  const [selectedSlot, setSelectedSlot] = React.useState<RecommendedSlot | null>(null);
  const [bookedEvent, setBookedEvent] = React.useState<InterviewEvent | null>(null);
  const [isBooking, setIsBooking] = React.useState(false);
  const [bookingError, setBookingError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      // Read-only fetch: the latest recommendation run rides on the interview
      // detail payload. Never POST /recommendations here.
      const inv = await interviewsApi.getById(interviewId);
      setInterview(inv);
      setSlots(inv.latest_recommendations ?? []);
      if (inv.event) setBookedEvent(inv.event);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, [interviewId]);

  React.useEffect(() => {
    load();
  }, [load]);

  const canChoose = interview?.status === "RECOMMENDED" && !bookedEvent;

  const handleConfirm = async () => {
    if (!selectedSlot) return;
    setIsBooking(true);
    setBookingError(null);
    try {
      const event = await bookingApi.bookSlot(interviewId, {
        recommended_slot_id: selectedSlot.id,
      });
      setBookedEvent(event);
    } catch (err: any) {
      if (err.statusCode === 409) {
        setBookingError(
          "That time is no longer available — a participant's calendar changed or it was just booked. Pick another slot below."
        );
        await load(); // refresh the slot list
      } else if (err.statusCode === 502) {
        setBookingError(
          "We couldn't create the Google Calendar event, so nothing was booked. Please try again."
        );
      } else {
        setBookingError(
          err.message || "The booking could not be completed. Nothing was confirmed."
        );
      }
    } finally {
      setIsBooking(false);
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto py-16 text-center text-xs text-slate-500">
        Loading recommended times...
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Link href={`/candidate/interviews/${interviewId}`}>
        <Button variant="ghost" size="sm" className="text-xs -ml-2">
          <ArrowLeft className="w-3.5 h-3.5 mr-1" />
          Back to interview
        </Button>
      </Link>

      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          {bookedEvent ? "Your interview is booked" : "Choose your interview time"}
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          {interview?.company ? `${interview.company} · ` : ""}
          {interview?.title || interview?.round_type}
        </p>
      </div>

      {bookedEvent ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 space-y-2 text-sm text-slate-800">
          <div className="flex items-center gap-2 font-semibold text-emerald-900">
            <CheckCircle2 className="w-4 h-4" />
            Confirmed
          </div>
          <p>
            {formatDateOnly(bookedEvent.start_time, interview?.candidate_timezone)} ·{" "}
            {formatTimeRange(
              bookedEvent.start_time,
              bookedEvent.end_time,
              interview?.candidate_timezone
            )}{" "}
            ({interview?.candidate_timezone || "your local time"})
          </p>
          <p className="flex items-center gap-2 text-xs">
            <Video className="w-3.5 h-3.5 text-slate-500" />
            {bookedEvent.meeting_link ? (
              <a
                href={bookedEvent.meeting_link}
                target="_blank"
                rel="noreferrer"
                className="text-workday-blue underline break-all"
              >
                {bookedEvent.meeting_link}
              </a>
            ) : bookedEvent.provider === "SIMULATED" ? (
              "No video link — development booking (Google Calendar not configured)."
            ) : (
              "A calendar invite with the video link is on its way."
            )}
          </p>
        </div>
      ) : canChoose ? (
        <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-xs text-slate-700 flex items-center gap-3">
          <Info className="w-4 h-4 text-workday-blue shrink-0" />
          <p>
            These times work for you and every interviewer (calendar conflicts and
            timezones already checked). Pick one and confirm — you&apos;ll get a
            calendar invite and video link.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-xs text-slate-700 flex items-center gap-3">
          <Info className="w-4 h-4 text-workday-blue shrink-0" />
          <p>
            <span className="font-semibold text-slate-900">Preview:</span> your
            hiring coordinator will confirm the final time from these options.
          </p>
        </div>
      )}

      {bookingError && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{bookingError}</span>
        </div>
      )}

      {!bookedEvent && slots.length > 0 && (
        <div className="space-y-4">
          {slots.map((slot) => (
            <RecommendationCard
              key={slot.id}
              slot={slot}
              isReadOnly={!canChoose}
              isSelected={selectedSlot?.id === slot.id}
              onSelect={canChoose ? setSelectedSlot : undefined}
              displayTimezone={interview?.candidate_timezone}
            />
          ))}
        </div>
      )}

      {!bookedEvent && slots.length === 0 && (
        <div className="p-8 text-center bg-white rounded-xl border border-slate-200 text-slate-500 text-xs">
          No recommendations available yet.
        </div>
      )}

      {canChoose && (
        <div className="sticky bottom-4 flex justify-end">
          <Button
            type="button"
            variant="workday"
            size="lg"
            disabled={!selectedSlot || isBooking}
            isLoading={isBooking}
            onClick={handleConfirm}
          >
            {selectedSlot ? "Confirm this time" : "Select a time above"}
          </Button>
        </div>
      )}
    </div>
  );
}
