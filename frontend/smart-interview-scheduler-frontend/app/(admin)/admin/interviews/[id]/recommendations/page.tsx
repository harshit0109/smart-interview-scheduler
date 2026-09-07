"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { interviewsApi, schedulingApi, bookingApi } from "@/lib/api-client";
import {
  InterviewRequest,
  RecommendationRun,
  RecommendedSlot,
  InterviewEvent,
} from "@/lib/types";
import { useAuth } from "@/lib/auth-context";
import { RecommendationCard } from "@/components/shared/RecommendationCard";
import { BookingModal } from "@/components/shared/BookingModal";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatDateTime, formatDateOnly, formatTimeRange, formatScorePercent } from "@/lib/utils";
import {
  Sparkles,
  ArrowLeft,
  Calendar,
  Clock,
  Video,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  SlidersHorizontal,
  Layers,
  ArrowRight,
} from "lucide-react";

export default function AdminRecommendationsPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const interviewId = params.id as string;

  const [interview, setInterview] = React.useState<InterviewRequest | null>(null);
  const [recommendationRun, setRecommendationRun] = React.useState<RecommendationRun | null>(null);
  const [selectedSlot, setSelectedSlot] = React.useState<RecommendedSlot | null>(null);

  // Loading & Generation state
  const [isLoading, setIsLoading] = React.useState(true);
  const [isGenerating, setIsGenerating] = React.useState(false);
  const [loadStep, setLoadStep] = React.useState(0);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  // Compare mode toggle (Section 65)
  const [compareMode, setCompareMode] = React.useState(false);

  // Booking states (Sections 41 - 45)
  const [isBookingModalOpen, setIsBookingModalOpen] = React.useState(false);
  const [isBooking, setIsBooking] = React.useState(false);
  const [bookedEvent, setBookedEvent] = React.useState<InterviewEvent | null>(null);
  const [bookingError, setBookingError] = React.useState<string | null>(null);
  const [bookingTraceId, setBookingTraceId] = React.useState<string | null>(null);

  const fetchRecommendations = async () => {
    setIsGenerating(true);
    setErrorMsg(null);
    setLoadStep(0);

    // Progressive loading simulation per Section 39
    const stepTimer = setInterval(() => {
      setLoadStep((prev) => (prev < 4 ? prev + 1 : prev));
    }, 450);

    try {
      const inv = await interviewsApi.getById(interviewId);
      setInterview(inv);

      // Check if already booked
      if (inv.status === "BOOKED" && inv.event) {
        setBookedEvent(inv.event);
      }

      const recs = await schedulingApi.getRecommendations(interviewId);
      setRecommendationRun(recs);
      if (recs.slots && recs.slots.length > 0) {
        setSelectedSlot(recs.slots[0]); // Default to rank 1
      }
    } catch (err: any) {
      if (err.code === "NOT_READY_FOR_SCHEDULING") {
        setErrorMsg(
          "This interview isn't ready for scheduling yet. Make sure the candidate has submitted availability."
        );
      } else if (
        err.code === "PANELIST_CALENDAR_NOT_CONNECTED" ||
        err.code === "CALENDAR_CONNECTION_REVOKED" ||
        err.code === "CALENDAR_CONNECTION_EXPIRED"
      ) {
        // The backend message names the specific panelist — keep it, then say
        // what to do about it.
        setErrorMsg(
          `${err.message || "An assigned panelist's Google Calendar isn't connected."} ` +
            "The scheduling engine reads each panelist's free/busy from Google Calendar, " +
            "so every panelist must connect theirs (their “Google Calendar” page) " +
            "before recommendations can run. If Google Calendar OAuth isn't configured on " +
            "this deployment yet, set GOOGLE_CALENDAR_OAUTH_CLIENT_ID / _SECRET on the backend."
        );
      } else if (err.code === "CALENDAR_SYNC_FAILED") {
        setErrorMsg(
          "Couldn't reach Google Calendar to read panelist availability. This is usually transient — try Re-evaluate in a moment."
        );
      } else if (err.code === "NO_COMMON_AVAILABILITY") {
        setErrorMsg(
          "No common availability was found. Try adjusting the interview constraints or asking the candidate for additional availability."
        );
      } else {
        setErrorMsg(err.message || "Failed to generate recommended slots.");
      }
    } finally {
      clearInterval(stepTimer);
      setIsGenerating(false);
      setIsLoading(false);
    }
  };

  React.useEffect(() => {
    fetchRecommendations();
  }, [interviewId]);

  // Handle final booking confirmation (Sections 42 & 43)
  const handleConfirmBooking = async () => {
    if (!selectedSlot) return;
    setIsBooking(true);
    setBookingError(null);
    setBookingTraceId(null);

    try {
      const event = await bookingApi.bookSlot(interviewId, {
        recommended_slot_id: selectedSlot.id,
      });
      setBookedEvent(event);
      setIsBookingModalOpen(false);
    } catch (err: any) {
      if (err.statusCode === 409) {
        setBookingError(
          "This time is no longer available. Someone else may have booked it, or a participant's calendar changed. Please choose another recommended slot."
        );
      } else if (err.statusCode === 502) {
        setBookingError(
          "We couldn't create the Google Calendar event. Your interview has not been booked. Please try again."
        );
      } else {
        setBookingError(
          err.message ||
            "The booking could not be completed. The system attempted to safely clean up the calendar event. No booking has been confirmed."
        );
      }
      setBookingTraceId(err.trace_id);
    } finally {
      setIsBooking(false);
    }
  };

  // BOOKING SUCCESS SCREEN (Sections 44 & 82)
  if (bookedEvent && selectedSlot && interview) {
    return (
      <div className="max-w-2xl mx-auto py-8">
        <Card className="p-8 sm:p-10 text-center space-y-6 shadow-enterprise-lg border-emerald-200 bg-white">
          <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto ring-8 ring-emerald-50">
            <CheckCircle2 className="w-10 h-10" />
          </div>

          <div className="space-y-2">
            <span className="text-xs font-bold uppercase tracking-widest text-emerald-800 bg-emerald-50 border border-emerald-200 px-3 py-1 rounded-full">
              {bookedEvent.provider === "SIMULATED" ? "BOOKED — DEVELOPMENT MODE" : "CONFIRMED & SCHEDULED"}
            </span>
            <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight">
              Interview Booked Successfully
            </h2>
            <p className="text-sm text-slate-600 max-w-md mx-auto">
              {bookedEvent.provider === "SIMULATED"
                ? "Recorded locally. Google Calendar OAuth isn't configured, so no real calendar event or Google Meet link was created — set GOOGLE_CALENDAR_OAUTH_CLIENT_ID / _SECRET for the real integration."
                : "Your Google Calendar event has been created and shared with all participants, with a Google Meet link."}
            </p>
          </div>

          {/* Booking summary box */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-left space-y-4 text-xs">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div>
                <p className="text-slate-500 font-medium">Interview Round</p>
                <p className="text-base font-bold text-slate-900 capitalize">
                  {interview.round_type.toLowerCase()} Interview ({interview.duration_minutes}m)
                </p>
              </div>
              <span className="font-mono text-[11px] text-slate-500 bg-white px-2 py-1 rounded border">
                ID: {bookedEvent.calendar_event_id}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <p className="text-slate-500 font-medium">Scheduled Time (Your Timezone):</p>
                <p className="text-sm font-semibold text-slate-900 mt-0.5">
                  {formatDateTime(bookedEvent.start_time, user?.timezone)}
                </p>
              </div>

              <div>
                <p className="text-slate-500 font-medium">Candidate Local Time:</p>
                <p className="text-sm font-semibold text-slate-900 mt-0.5">
                  {formatDateTime(bookedEvent.start_time, interview.candidate_timezone)}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
              <div>
                <p className="text-slate-500 font-medium">Candidate:</p>
                <p className="text-xs font-bold text-slate-800 mt-0.5">
                  {interview.candidate_name}
                </p>
              </div>

              <div>
                <p className="text-slate-500 font-medium">Interview Panel:</p>
                <p className="text-xs font-bold text-slate-800 mt-0.5">
                  {interview.panelists.map((p) => p.name).join(", ")}
                </p>
              </div>
            </div>

            {/* Google Meet action */}
            {bookedEvent.meeting_link && (
              <div className="pt-3 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center">
                    <Video className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="font-bold text-slate-900 block text-xs">
                      Google Meet Video Conference
                    </span>
                    <span className="text-[11px] text-slate-500">
                      Joinable by all participants
                    </span>
                  </div>
                </div>

                <a
                  href={bookedEvent.meeting_link}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition-colors shadow-xs"
                >
                  <span>Join Google Meet</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            )}
          </div>

          <div className="pt-2 flex flex-col sm:flex-row justify-center gap-3">
            <Link href="/admin/interviews">
              <Button variant="outline" size="md">
                All Interviews
              </Button>
            </Link>
            <Link href={`/admin/interviews/${interviewId}`}>
              <Button variant="primary" size="md" className="gap-2">
                <span>View Interview Overview</span>
                <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  // INTELLIGENT LOADING EXPERIENCE (Section 39)
  if (isGenerating) {
    const loadingMessages = [
      "Checking candidate availability windows...",
      "Connecting to panelist Google Calendars for free/busy intervals...",
      "Evaluating cross-globe timezone fairness...",
      "Ranking possible slots with 5-factor scoring model...",
      "Preparing recommendations and explainability breakdown...",
    ];

    return (
      <div className="max-w-xl mx-auto py-16 text-center space-y-6">
        <div className="w-14 h-14 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto animate-pulse">
          <Sparkles className="w-7 h-7" />
        </div>

        <div className="space-y-1">
          <h2 className="text-xl font-bold text-slate-900">
            Finding the Best Interview Times
          </h2>
          <p className="text-xs text-slate-500">
            Analyzing candidate windows, panelist calendars, and mathematical scheduling constraints.
          </p>
        </div>

        <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-xs space-y-3 text-left max-w-md mx-auto">
          {loadingMessages.map((msg, idx) => (
            <div
              key={msg}
              className="flex items-center gap-3 text-xs"
              style={{ opacity: idx <= loadStep ? 1 : 0.3 }}
            >
              {idx < loadStep ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : idx === loadStep ? (
                <div className="w-4 h-4 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin shrink-0" />
              ) : (
                <div className="w-4 h-4 rounded-full border border-slate-300 shrink-0" />
              )}
              <span className={idx === loadStep ? "font-semibold text-slate-900" : "text-slate-600"}>
                {msg}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-5xl pb-24">
      {/* Top Navigation & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Link href={`/admin/interviews/${interviewId}`}>
            <Button variant="ghost" size="sm" className="text-xs -ml-2">
              <ArrowLeft className="w-3.5 h-3.5 mr-1" />
              Back to Interview
            </Button>
          </Link>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCompareMode(!compareMode)}
            className="text-xs gap-1.5"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>{compareMode ? "Card View" : "Compare All Slots"}</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={fetchRecommendations}
            className="text-xs gap-1"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Re-evaluate</span>
          </Button>
        </div>
      </div>

      {/* Hero Header (Section 34) */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-workday-blue mb-1">
          <Sparkles className="w-4 h-4" />
          <span>Explainable Deterministic Scheduling Engine</span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
          Best times to interview
        </h1>
        <p className="text-sm text-slate-600 mt-1 max-w-2xl">
          We&apos;ve analyzed candidate availability, panelist calendars, time zones, working hours, workload distribution, and buffer quality to generate the top {recommendationRun?.slots.length || 3} conflict-free slots.
        </p>

        {interview && (
          <div className="mt-4 pt-4 border-t border-slate-100 flex flex-wrap items-center gap-4 text-xs text-slate-500">
            <span>
              Candidate: <strong className="text-slate-800">{interview.candidate_name}</strong> ({interview.candidate_timezone})
            </span>
            <span>•</span>
            <span>
              Round: <strong className="text-slate-800 capitalize">{interview.round_type.toLowerCase()}</strong> ({interview.duration_minutes}m)
            </span>
            <span>•</span>
            <span>
              Panelists: <strong className="text-slate-800">{interview.panelists.map((p) => p.name).join(", ")}</strong>
            </span>
          </div>
        )}
      </div>

      {errorMsg && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-slate-800 space-y-2">
          <div className="flex items-center gap-2 text-rose-800 font-bold text-sm">
            <AlertTriangle className="w-5 h-5 text-rose-600" />
            <span>Scheduling Notice</span>
          </div>
          <p className="text-xs text-rose-700 leading-relaxed">{errorMsg}</p>
          <div className="pt-2">
            <Link href={`/admin/interviews/${interviewId}`}>
              <Button variant="outline" size="sm" className="text-xs border-rose-300 text-rose-900 hover:bg-rose-100/60">
                Review Interview Setup
              </Button>
            </Link>
          </div>
        </div>
      )}

      {/* RECOMMENDATION SLOTS VIEW */}
      {recommendationRun?.slots && recommendationRun.slots.length > 0 && (
        <>
          {/* COMPARE MODE (Section 65) */}
          {compareMode ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-xs">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-600 font-bold uppercase tracking-wider border-b border-slate-200">
                      <tr>
                        <th className="p-4">Factor</th>
                        <th className="p-4">Weight</th>
                        {recommendationRun.slots.map((s) => (
                          <th key={s.id} className="p-4 text-center">
                            <span className="block font-bold text-slate-900 text-sm">
                              #{s.rank} {s.rank === 1 ? "Best Match" : `Option ${s.rank}`}
                            </span>
                            <span className="text-xs text-workday-blue font-mono font-bold">
                              {formatScorePercent(s.total_score)}%
                            </span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-slate-700">
                      <tr>
                        <td className="p-4 font-bold text-slate-900">Slot Date & Time</td>
                        <td className="p-4 text-slate-400 font-mono">-</td>
                        {recommendationRun.slots.map((s) => (
                          <td key={s.id} className="p-4 text-center text-xs">
                            <p className="font-semibold text-slate-900">
                              {formatDateOnly(s.start_time, user?.timezone)}
                            </p>
                            <p className="text-slate-500">
                              {formatTimeRange(s.start_time, s.end_time, user?.timezone)}
                            </p>
                          </td>
                        ))}
                      </tr>

                      <tr>
                        <td className="p-4 font-medium text-slate-800">Timezone Fairness</td>
                        <td className="p-4 text-slate-400 font-mono">30%</td>
                        {recommendationRun.slots.map((s) => (
                          <td key={s.id} className="p-4 text-center font-mono font-bold">
                            {formatScorePercent(s.score_breakdown.timezone_fairness)}%
                          </td>
                        ))}
                      </tr>

                      <tr>
                        <td className="p-4 font-medium text-slate-800">Working-Hours Comfort</td>
                        <td className="p-4 text-slate-400 font-mono">20%</td>
                        {recommendationRun.slots.map((s) => (
                          <td key={s.id} className="p-4 text-center font-mono font-bold">
                            {formatScorePercent(s.score_breakdown.working_hours_comfort)}%
                          </td>
                        ))}
                      </tr>

                      <tr>
                        <td className="p-4 font-medium text-slate-800">Scheduling Proximity</td>
                        <td className="p-4 text-slate-400 font-mono">20%</td>
                        {recommendationRun.slots.map((s) => (
                          <td key={s.id} className="p-4 text-center font-mono font-bold">
                            {formatScorePercent(s.score_breakdown.scheduling_proximity)}%
                          </td>
                        ))}
                      </tr>

                      <tr>
                        <td className="p-4 font-medium text-slate-800">Workload Balance</td>
                        <td className="p-4 text-slate-400 font-mono">15%</td>
                        {recommendationRun.slots.map((s) => (
                          <td key={s.id} className="p-4 text-center font-mono font-bold">
                            {formatScorePercent(s.score_breakdown.workload_balance)}%
                          </td>
                        ))}
                      </tr>

                      <tr>
                        <td className="p-4 font-medium text-slate-800">Buffer Quality</td>
                        <td className="p-4 text-slate-400 font-mono">15%</td>
                        {recommendationRun.slots.map((s) => (
                          <td key={s.id} className="p-4 text-center font-mono font-bold">
                            {formatScorePercent(s.score_breakdown.buffer_quality)}%
                          </td>
                        ))}
                      </tr>

                      <tr className="bg-slate-50/50">
                        <td className="p-4 font-bold text-slate-900">Select Slot</td>
                        <td className="p-4 text-slate-400">-</td>
                        {recommendationRun.slots.map((s) => (
                          <td key={s.id} className="p-4 text-center">
                            <Button
                              size="sm"
                              variant={selectedSlot?.id === s.id ? "primary" : "outline"}
                              onClick={() => setSelectedSlot(s)}
                              className="text-xs"
                            >
                              {selectedSlot?.id === s.id ? "Selected" : "Select Slot"}
                            </Button>
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : (
            /* STANDARD CARDS VIEW (Section 35 & 80) */
            <div className="space-y-5">
              {recommendationRun.slots.map((slot) => (
                <RecommendationCard
                  key={slot.id}
                  slot={slot}
                  isSelected={selectedSlot?.id === slot.id}
                  onSelect={(s) => setSelectedSlot(s)}
                  displayTimezone={user?.timezone}
                  secondaryTimezone={interview?.candidate_timezone}
                />
              ))}
            </div>
          )}

          {/* FLOATING ACTION BAR FOR CONFIRMATION (Section 38) */}
          {selectedSlot && (
            <div className="fixed bottom-0 left-0 right-0 z-40 p-4 bg-white/95 backdrop-blur-md border-t border-slate-200 shadow-enterprise-lg">
              <div className="max-w-5xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-workday-blue text-white flex items-center justify-center font-bold text-sm">
                    #{selectedSlot.rank}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                        Selected Interview Time ({formatScorePercent(selectedSlot.total_score)}% Match)
                      </span>
                    </div>
                    <p className="text-sm font-bold text-slate-900">
                      {formatDateOnly(selectedSlot.start_time, user?.timezone)} •{" "}
                      {formatTimeRange(selectedSlot.start_time, selectedSlot.end_time, user?.timezone)}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <Button
                    type="button"
                    variant="workday"
                    size="lg"
                    onClick={() => setIsBookingModalOpen(true)}
                    className="px-6 font-bold shadow-md bg-emerald-700 hover:bg-emerald-800 text-white"
                  >
                    <span>Book Selected Time</span>
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* BOOKING CONFIRMATION MODAL (Sections 41 & 81) */}
      {interview && (
        <BookingModal
          isOpen={isBookingModalOpen}
          onClose={() => setIsBookingModalOpen(false)}
          interview={interview}
          slot={selectedSlot}
          onConfirm={handleConfirmBooking}
          isBooking={isBooking}
          bookingError={bookingError}
          bookingTraceId={bookingTraceId}
        />
      )}
    </div>
  );
}
