"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { interviewsApi } from "@/lib/api-client";
import { InterviewRequest } from "@/lib/types";
import { useAuth } from "@/lib/auth-context";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { InterviewTimeline } from "@/components/shared/InterviewTimeline";
import { LifecycleActions } from "@/components/shared/LifecycleActions";
import { formatDateTime, formatTimeRange } from "@/lib/utils";
import {
  Calendar,
  Clock,
  User,
  Users,
  Video,
  ExternalLink,
  ArrowLeft,
  CheckCircle2,
} from "lucide-react";

export default function PanelistInterviewDetailPage() {
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
      <div className="py-12 text-center text-xs text-slate-500">
        Loading interview assignment details...
      </div>
    );
  }

  if (!interview) {
    return (
      <div className="py-12 text-center space-y-3">
        <p className="text-sm font-semibold text-slate-700">Interview not found</p>
        <Link href="/panelist/interviews">
          <Button variant="outline" size="sm">Back to Assigned Interviews</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-2">
        <Link href="/panelist/interviews">
          <Button variant="ghost" size="sm" className="text-xs">
            <ArrowLeft className="w-3.5 h-3.5 mr-1" />
            Back to Interviews
          </Button>
        </Link>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-workday-blue">
            {interview.round_type} Round
          </span>
          <h1 className="text-2xl font-bold text-slate-900 mt-0.5">
            Interview with {interview.candidate_name}
          </h1>
          {(interview.company || interview.title) && (
            <p className="text-xs text-slate-600 mt-1 font-medium">
              {[interview.company, interview.title].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
        <StatusBadge status={interview.status} />
      </div>

      {/* State timeline */}
      <Card className="p-4 bg-white border-slate-200">
        <InterviewTimeline status={interview.status} />
      </Card>

      {/* Booked / completed: keep the scheduled slot + link visible as history */}
      {interview.event &&
        ["BOOKED", "COMPLETED"].includes(interview.status) &&
        interview.event.status === "CONFIRMED" && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-6 space-y-4">
          <div className="flex items-center gap-2 text-emerald-800 font-bold text-sm">
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            <span>
              {interview.status === "COMPLETED"
                ? "Interview (completed)"
                : "Interview Confirmed"}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs text-slate-700">
            <div>
              <span className="text-slate-500 font-medium block">Scheduled Time (Your Timezone):</span>
              <p className="text-sm font-semibold text-slate-900 mt-0.5">
                {formatDateTime(interview.event.start_time, user?.timezone)}
              </p>
            </div>

            {interview.event.meeting_link && (
              <div>
                <span className="text-slate-500 font-medium block">Video Conference:</span>
                <a
                  href={interview.event.meeting_link}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 px-3 py-1.5 mt-1 rounded-md bg-emerald-600 text-white font-semibold text-xs hover:bg-emerald-700 transition-colors shadow-xs"
                >
                  <Video className="w-4 h-4" />
                  <span>Join Google Meet</span>
                  <ExternalLink className="w-3 h-3 opacity-70" />
                </a>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Interview specifications */}
      <Card className="border-slate-200 shadow-xs">
        <CardHeader>
          <CardTitle className="text-sm">Interview Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <p className="text-slate-500 font-medium">Candidate</p>
              <p className="font-semibold text-slate-900 text-sm mt-0.5">{interview.candidate_name}</p>
              <p className="text-slate-500">{interview.candidate_email} ({interview.candidate_timezone})</p>
            </div>
            <div>
              <p className="text-slate-500 font-medium">Duration & Buffer</p>
              <p className="font-semibold text-slate-900 text-sm mt-0.5">
                {interview.duration_minutes} minutes (+{interview.buffer_minutes}m buffer)
              </p>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-100">
            <p className="text-slate-500 font-medium mb-1.5">Interview Panel</p>
            <div className="space-y-1">
              {interview.panelists.map((p) => (
                <div key={p.id} className="flex items-center justify-between text-xs py-1">
                  <span className="font-medium text-slate-800">{p.name} ({p.role})</span>
                  <span className="text-slate-400">{p.timezone || "UTC"}</span>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <LifecycleActions
        interview={interview}
        viewerRole="PANELIST"
        viewerId={user?.id}
        onDone={load}
      />
    </div>
  );
}
