"use client";

import * as React from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { interviewsApi } from "@/lib/api-client";
import { InterviewRequest } from "@/lib/types";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { formatDateTime, formatTimeRange } from "@/lib/utils";
import {
  Calendar,
  AlertTriangle,
  Clock,
  Video,
  ExternalLink,
  Users,
  CheckCircle2,
  CalendarCheck,
} from "lucide-react";

export default function PanelistDashboardPage() {
  const { user, calendarStatus } = useAuth();
  const [interviews, setInterviews] = React.useState<InterviewRequest[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    const load = async () => {
      try {
        const res = await interviewsApi.list();
        // Filter interviews where this panelist is assigned
        setInterviews(res.items);
      } catch (err) {
        console.error("Failed to load panelist interviews:", err);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, []);

  const bookedInterviews = interviews.filter((i) => i.status === "BOOKED" && i.event);
  const pendingInterviews = interviews.filter((i) => i.status !== "BOOKED");

  return (
    <div className="space-y-8">
      {/* Top Greeting */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          Good day, {user?.name || "Panelist"}
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Here are the interview panels assigned to you and your calendar sync status.
        </p>
      </div>

      {/* Calendar Alert Banner if not connected */}
      {calendarStatus !== "CONNECTED" && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <h4 className="text-sm font-bold text-amber-900">
                Your Google Calendar is not connected
              </h4>
              <p className="text-xs text-amber-800 mt-0.5">
                The scheduling engine cannot verify your free/busy availability until you connect your Google Calendar.
              </p>
            </div>
          </div>
          <Link href="/panelist/calendar">
            <Button variant="primary" size="sm" className="bg-amber-600 hover:bg-amber-700 text-white shrink-0">
              Connect Calendar
            </Button>
          </Link>
        </div>
      )}

      {/* Upcoming Confirmed Interviews */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <CalendarCheck className="w-4 h-4 text-workday-blue" />
            <span>Upcoming Confirmed Interviews</span>
          </h2>
          <span className="text-xs font-semibold text-slate-500">
            {bookedInterviews.length} Scheduled
          </span>
        </div>

        {bookedInterviews.length === 0 ? (
          <Card className="p-8 text-center border-dashed border-slate-300 bg-slate-50/50">
            <Calendar className="w-8 h-8 text-slate-400 mx-auto mb-2" />
            <p className="text-sm font-semibold text-slate-700">No scheduled sessions</p>
            <p className="text-xs text-slate-500 mt-1">
              You will see confirmed sessions with Google Meet links here once an admin finalizes recommended slots.
            </p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {bookedInterviews.map((inv) => (
              <Card key={inv.id} className="p-5 border-slate-200 hover:border-workday-blue transition-colors">
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div>
                    <span className="text-xs font-bold uppercase tracking-wider text-workday-blue">
                      {inv.round_type} Round
                    </span>
                    <h3 className="text-base font-bold text-slate-900 mt-0.5">
                      Candidate: {inv.candidate_name}
                    </h3>
                    {(inv.company || inv.title) && (
                      <p className="text-xs text-slate-500 mt-0.5">
                        {[inv.company, inv.title].filter(Boolean).join(" · ")}
                      </p>
                    )}
                  </div>
                  <StatusBadge status={inv.status} />
                </div>

                {inv.event && (
                  <div className="space-y-2 text-xs text-slate-600 pt-2 border-t border-slate-100">
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4 text-slate-400" />
                      <span className="font-semibold text-slate-800">
                        {formatDateTime(inv.event.start_time, user?.timezone)}
                      </span>
                    </div>

                    {inv.event.meeting_link && (
                      <div className="pt-2">
                        <a
                          href={inv.event.meeting_link}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200 font-semibold hover:bg-emerald-100 transition-colors"
                        >
                          <Video className="w-3.5 h-3.5 text-emerald-600" />
                          <span>Join Google Meet</span>
                          <ExternalLink className="w-3 h-3 opacity-60" />
                        </a>
                      </div>
                    )}
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Pending / In-progress interview assignments */}
      <div className="space-y-4 pt-4">
        <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
          <Users className="w-4 h-4 text-slate-500" />
          <span>Active Interview Pipelines In Progress</span>
        </h2>

        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-xs">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 font-semibold uppercase tracking-wider border-b border-slate-200">
              <tr>
                <th className="p-3.5">Candidate</th>
                <th className="p-3.5">Round</th>
                <th className="p-3.5">Duration</th>
                <th className="p-3.5">Status</th>
                <th className="p-3.5 text-right">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {pendingInterviews.map((inv) => (
                <tr key={inv.id} className="hover:bg-slate-50/70">
                  <td className="p-3.5 font-medium text-slate-900">
                    {inv.candidate_name}
                  </td>
                  <td className="p-3.5 capitalize">{inv.round_type.toLowerCase()}</td>
                  <td className="p-3.5">{inv.duration_minutes} min (+{inv.buffer_minutes}m buffer)</td>
                  <td className="p-3.5">
                    <StatusBadge status={inv.status} />
                  </td>
                  <td className="p-3.5 text-right">
                    <Link
                      href={`/panelist/interviews/${inv.id}`}
                      className="text-workday-blue hover:underline font-semibold"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
