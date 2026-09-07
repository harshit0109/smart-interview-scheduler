"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { interviewsApi } from "@/lib/api-client";
import { InterviewRequest } from "@/lib/types";
import { useAuth } from "@/lib/auth-context";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { InterviewTimeline } from "@/components/shared/InterviewTimeline";
import { LifecycleActions } from "@/components/shared/LifecycleActions";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { formatDateTime } from "@/lib/utils";
import {
  Calendar,
  Clock,
  Video,
  ExternalLink,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
} from "lucide-react";

export default function CandidateInterviewDetailPage() {
  const params = useParams();
  const { user } = useAuth();
  const id = params.id as string;

  const [interview, setInterview] = React.useState<InterviewRequest | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    try {
      const data = await interviewsApi.getById(id);
      setInterview(data);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  React.useEffect(() => {
    load();
  }, [load]);

  if (isLoading) {
    return (
      <div className="py-16 text-center text-xs text-slate-500">
        Loading interview details...
      </div>
    );
  }

  if (!interview) {
    return (
      <div className="py-16 text-center space-y-3">
        <h3 className="text-base font-bold text-slate-800">Interview Not Found</h3>
        <Link href="/candidate">
          <Button variant="outline" size="sm">Back to Invitations</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <Link href="/candidate">
        <Button variant="ghost" size="sm" className="text-xs -ml-2">
          <ArrowLeft className="w-3.5 h-3.5 mr-1" />
          Back to Invitations
        </Button>
      </Link>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-workday-blue">
            {interview.round_type} Round
          </span>
          <h1 className="text-2xl font-bold text-slate-900 mt-0.5">
            {interview.round_type} Interview
          </h1>
          {(interview.company || interview.title) && (
            <p className="text-xs text-slate-600 mt-0.5 font-medium">
              {[interview.company, interview.title].filter(Boolean).join(" · ")}
            </p>
          )}
          <p className="text-xs text-slate-500 mt-0.5">
            Duration: {interview.duration_minutes} minutes
          </p>
        </div>
        <StatusBadge status={interview.status} />
      </div>

      <Card className="p-4 bg-white border-slate-200">
        <InterviewTimeline status={interview.status} />
      </Card>

      {/* Booked / completed: keep the scheduled slot + link visible as history */}
      {interview.event &&
        ["BOOKED", "COMPLETED"].includes(interview.status) &&
        interview.event.status === "CONFIRMED" && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-6 space-y-4">
          <div className="flex items-center gap-2 text-emerald-900 font-bold text-base">
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            <span>
              {interview.status === "COMPLETED"
                ? "Your interview (completed)"
                : "Your Interview is Scheduled!"}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs text-slate-700 pt-2 border-t border-emerald-200/60">
            <div>
              <span className="text-slate-500 font-medium block">Confirmed Date & Time:</span>
              <p className="text-sm font-bold text-slate-900 mt-0.5">
                {formatDateTime(interview.event.start_time, user?.timezone)}
              </p>
            </div>

            <div>
              <span className="text-slate-500 font-medium block">Video Meeting:</span>
              {interview.event.meeting_link ? (
                <a
                  href={interview.event.meeting_link}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 px-3.5 py-1.5 mt-1 rounded-md bg-emerald-600 text-white font-semibold text-xs hover:bg-emerald-700 transition-colors shadow-xs"
                >
                  <Video className="w-4 h-4" />
                  <span>Join Interview</span>
                  <ExternalLink className="w-3 h-3 opacity-70" />
                </a>
              ) : (
                <p className="text-slate-400 mt-1">
                  {interview.event.provider === "SIMULATED"
                    ? "The video link will be shared closer to the interview."
                    : "Calendar event scheduled without video link."}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* If Awaiting Availability: prompt candidate to submit */}
      {interview.status === "AWAITING_CANDIDATE_AVAILABILITY" && (
        <Card className="p-6 border-amber-200 bg-amber-50/60 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="font-bold text-amber-950 text-base">
                Action Required: Submit Your Availability
              </h3>
              <p className="text-xs text-amber-900 mt-1">
                Please provide your available date and time windows so the scheduling engine can find overlapping intervals with the panel.
              </p>
            </div>
            <Link href={`/candidate/interviews/${interview.id}/availability`}>
              <Button variant="primary" size="md" className="gap-2 shrink-0">
                <span>Provide Availability</span>
                <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
          </div>
        </Card>
      )}

      {/* If Recommended: provide link to view recommendations */}
      {interview.status === "RECOMMENDED" && (
        <Card className="p-6 border-indigo-200 bg-indigo-50/60 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="font-bold text-indigo-950 text-base">
                Recommended Times Found
              </h3>
              <p className="text-xs text-indigo-900 mt-1">
                Mathematical matches have been computed. Your recruiter will finalize the booking shortly.
              </p>
            </div>
            <Link href={`/candidate/interviews/${interview.id}/recommendations`}>
              <Button variant="outline" size="md" className="text-xs bg-white text-indigo-900 border-indigo-300">
                View Recommendations
              </Button>
            </Link>
          </div>
        </Card>
      )}

      <LifecycleActions
        interview={interview}
        viewerRole="CANDIDATE"
        viewerId={user?.id}
        onDone={load}
      />
    </div>
  );
}
