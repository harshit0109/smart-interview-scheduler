"use client";

import * as React from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { interviewsApi } from "@/lib/api-client";
import { InterviewRequest } from "@/lib/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { formatDateTime } from "@/lib/utils";
import {
  Calendar,
  Clock,
  Video,
  ExternalLink,
  ArrowRight,
  UserCheck,
  CheckCircle2,
} from "lucide-react";

export default function CandidateDashboardPage() {
  const { user } = useAuth();
  const [interviews, setInterviews] = React.useState<InterviewRequest[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    const load = async () => {
      try {
        const res = await interviewsApi.list();
        setInterviews(res.items);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, []);

  return (
    <div className="space-y-8 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          Welcome, {user?.name || "Candidate"}
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Review your active interview rounds, provide your availability windows, or join confirmed sessions.
        </p>
      </div>

      <div className="space-y-4">
        <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
          <Calendar className="w-4 h-4 text-workday-blue" />
          <span>My Interview Invitations</span>
        </h2>

        {interviews.length === 0 ? (
          <Card className="p-8 text-center border-dashed border-slate-300 bg-slate-50/50">
            <UserCheck className="w-8 h-8 text-slate-400 mx-auto mb-2" />
            <p className="text-sm font-semibold text-slate-700">No interview requests</p>
            <p className="text-xs text-slate-500 mt-1">
              You will see your interview details here when a recruiter schedules a session for you.
            </p>
          </Card>
        ) : (
          <div className="space-y-4">
            {interviews.map((inv) => (
              <Card
                key={inv.id}
                className="p-6 border-slate-200 hover:border-workday-blue transition-all duration-150"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-workday-blue">
                        {inv.round_type} Round
                      </span>
                      <span className="text-xs text-slate-400">•</span>
                      <span className="text-xs text-slate-500">{inv.duration_minutes} minutes</span>
                    </div>

                    <h3 className="text-lg font-bold text-slate-900 mt-1">
                      {inv.round_type} Interview
                    </h3>

                    <p className="text-xs text-slate-500 mt-0.5">
                      Interview Panel: {inv.panelists.map((p) => p.name).join(", ")}
                    </p>
                  </div>

                  <div className="flex flex-col sm:items-end gap-2 shrink-0">
                    <StatusBadge status={inv.status} />

                    {inv.status === "AWAITING_CANDIDATE_AVAILABILITY" && (
                      <Link href={`/candidate/interviews/${inv.id}/availability`}>
                        <Button variant="primary" size="sm" className="gap-1 mt-1">
                          <span>Submit Availability</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </Button>
                      </Link>
                    )}

                    {inv.status === "RECOMMENDED" && (
                      <Link href={`/candidate/interviews/${inv.id}/recommendations`}>
                        <Button variant="outline" size="sm" className="text-xs">
                          View Recommended Times
                        </Button>
                      </Link>
                    )}

                    {inv.status === "BOOKED" && inv.event && (
                      <div className="space-y-1 sm:text-right">
                        <p className="text-xs font-semibold text-emerald-800">
                          {formatDateTime(inv.event.start_time, user?.timezone)}
                        </p>
                        {inv.event.meeting_link && (
                          <a
                            href={inv.event.meeting_link}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-emerald-100 text-emerald-800 text-xs font-semibold hover:bg-emerald-200"
                          >
                            <Video className="w-3.5 h-3.5" />
                            <span>Join Google Meet</span>
                            <ExternalLink className="w-3 h-3 opacity-60" />
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
