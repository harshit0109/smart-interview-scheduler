"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { interviewsApi } from "@/lib/api-client";
import { InterviewRequest } from "@/lib/types";
import { useAuth } from "@/lib/auth-context";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { InterviewTimeline } from "@/components/shared/InterviewTimeline";
import { CopyButton } from "@/components/shared/CopyButton";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { formatDateTime, formatDateOnly, formatTimeRange } from "@/lib/utils";
import {
  Calendar,
  Clock,
  Sparkles,
  ArrowLeft,
  ArrowRight,
  Video,
  ExternalLink,
  Users,
  CheckCircle2,
  AlertCircle,
  Copy,
  CalendarCheck,
} from "lucide-react";

export default function AdminInterviewDetailPage() {
  const params = useParams();
  const { user } = useAuth();
  const id = params.id as string;

  const [interview, setInterview] = React.useState<InterviewRequest | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    const load = async () => {
      try {
        const data = await interviewsApi.getById(id);
        setInterview(data);
      } catch (err) {
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [id]);

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
        <Link href="/admin/interviews">
          <Button variant="outline" size="sm">Back to Interview List</Button>
        </Link>
      </div>
    );
  }

  const candidateLink =
    typeof window !== "undefined"
      ? `${window.location.origin}/candidate/interviews/${interview.id}/availability`
      : `/candidate/interviews/${interview.id}/availability`;

  return (
    <div className="space-y-8 max-w-5xl">
      {/* Top Breadcrumb & Actions */}
      <div className="flex items-center justify-between">
        <Link href="/admin/interviews">
          <Button variant="ghost" size="sm" className="text-xs -ml-2">
            <ArrowLeft className="w-3.5 h-3.5 mr-1" />
            Back to Interviews
          </Button>
        </Link>

        <div className="flex items-center gap-2">
          {(interview.status === "READY_FOR_SCHEDULING" ||
            interview.status === "RECOMMENDED") && (
            <Link href={`/admin/interviews/${interview.id}/recommendations`}>
              <Button variant="primary" size="sm" className="bg-indigo-600 hover:bg-indigo-700 text-white gap-1.5 shadow-sm">
                <Sparkles className="w-4 h-4" />
                <span>View Recommendations</span>
                <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
          )}
        </div>
      </div>

      {/* Header Banner */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-workday-blue">
              {interview.round_type} Round
            </span>
            <span className="text-xs text-slate-400">•</span>
            <span className="text-xs text-slate-500">
              Duration: {interview.duration_minutes}m (+{interview.buffer_minutes}m buffer)
            </span>
          </div>

          <h1 className="text-2xl font-bold text-slate-900 mt-1">
            Candidate: {interview.candidate_name}
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {interview.candidate_email} ({interview.candidate_timezone})
          </p>
        </div>

        <div className="flex items-center gap-3">
          <StatusBadge status={interview.status} />
        </div>
      </div>

      {/* State timeline (Section 24) */}
      <Card className="p-6 bg-white border-slate-200 shadow-xs">
        <div className="mb-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Interview Lifecycle Progress
          </h3>
        </div>
        <InterviewTimeline status={interview.status} />
      </Card>

      {/* CONFIRMED BOOKING HERO (Sections 44 & 47) */}
      {interview.status === "BOOKED" && interview.event && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-6 space-y-4 shadow-sm">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 text-emerald-900 font-bold text-base">
              <CheckCircle2 className="w-6 h-6 text-emerald-600" />
              <span>Interview Booked & Google Calendar Confirmed</span>
            </div>
            <span className="text-xs font-mono font-semibold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded">
              Event ID: {interview.event.calendar_event_id}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-slate-700 pt-2 border-t border-emerald-200/60">
            <div>
              <span className="text-slate-500 font-medium block">Confirmed Date & Time:</span>
              <p className="text-sm font-bold text-slate-900 mt-0.5">
                {formatDateTime(interview.event.start_time, user?.timezone)}
              </p>
              <p className="text-slate-500 mt-0.5">
                Candidate local: {formatDateTime(interview.event.start_time, interview.candidate_timezone)}
              </p>
            </div>

            <div>
              <span className="text-slate-500 font-medium block">Google Meet Video Link:</span>
              {interview.event.meeting_link ? (
                <div className="mt-1 flex items-center gap-2">
                  <a
                    href={interview.event.meeting_link}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-md bg-emerald-600 text-white font-semibold text-xs hover:bg-emerald-700 transition-colors shadow-xs"
                  >
                    <Video className="w-4 h-4" />
                    <span>Join Google Meet</span>
                    <ExternalLink className="w-3 h-3 opacity-70" />
                  </a>
                  <CopyButton textToCopy={interview.event.meeting_link} label="Copy link" />
                </div>
              ) : (
                <p className="text-slate-400 mt-1">Calendar event created without video link.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Candidate Availability Status & Share Link */}
      <Card className="border-slate-200 shadow-xs">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Candidate Availability Link</CardTitle>
          <CardDescription className="text-xs">
            Send this link to the candidate so they can submit their available times.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={candidateLink}
              className="flex-1 font-mono text-xs bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-slate-700 select-all"
            />
            <CopyButton textToCopy={candidateLink} />
          </div>

          {interview.availability ? (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800 flex items-center justify-between">
              <span className="flex items-center gap-1.5 font-medium">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                Candidate submitted {interview.availability.windows.length} availability window(s) in {interview.availability.timezone}
              </span>
              <span className="text-[11px] font-mono text-emerald-700">
                Submitted {formatDateOnly(interview.availability.submitted_at)}
              </span>
            </div>
          ) : (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-600 shrink-0" />
              <span>Awaiting candidate availability submission before recommendations can run.</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Panelists Card */}
      <Card className="border-slate-200 shadow-xs">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Assigned Interview Panel</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="divide-y divide-slate-100">
            {interview.panelists.map((pan) => (
              <div key={pan.id} className="py-3 flex items-center justify-between text-xs">
                <div>
                  <p className="font-semibold text-slate-900">{pan.name}</p>
                  <p className="text-slate-500">{pan.email} • {pan.timezone || "UTC"}</p>
                </div>
                <div>
                  {pan.calendar_status === "CONNECTED" ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                      <CalendarCheck className="w-3 h-3 text-emerald-600" />
                      Calendar Connected
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 bg-slate-50 px-2 py-0.5 rounded border border-slate-200">
                      Calendar status unknown
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
