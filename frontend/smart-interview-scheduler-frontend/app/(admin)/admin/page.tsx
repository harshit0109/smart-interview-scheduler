"use client";

import * as React from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { interviewsApi } from "@/lib/api-client";
import { InterviewRequest } from "@/lib/types";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { formatDateTime, formatDateOnly } from "@/lib/utils";
import {
  Calendar,
  Plus,
  Users,
  Clock,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  TrendingUp,
  Video,
  Activity,
} from "lucide-react";

export default function AdminDashboardPage() {
  const { user } = useAuth();
  const [interviews, setInterviews] = React.useState<InterviewRequest[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    const load = async () => {
      try {
        const res = await interviewsApi.list(0, 50);
        setInterviews(res.items);
      } catch (err) {
        console.error("Dashboard failed to load:", err);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, []);

  const totalInterviews = interviews.length;
  const pendingAvailability = interviews.filter(
    (i) => i.status === "AWAITING_CANDIDATE_AVAILABILITY"
  ).length;
  const readyToSchedule = interviews.filter(
    (i) => i.status === "READY_FOR_SCHEDULING" || i.status === "RECOMMENDED"
  ).length;
  const bookedCount = interviews.filter((i) => i.status === "BOOKED").length;

  return (
    <div className="space-y-8">
      {/* Top Welcome & Actions Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
            Good day, {user?.name || "Hiring Lead"}
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Here&apos;s what&apos;s happening with your interview pipelines today.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link href="/admin/interviews/new">
            <Button variant="workday" size="md" className="gap-2 shadow-sm">
              <Plus className="w-4 h-4 stroke-[3]" />
              <span>Create Interview Request</span>
            </Button>
          </Link>
        </div>
      </div>

      {/* Stats Cards (Section 15) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-5 border-slate-200 shadow-xs hover:border-slate-300">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Total Interviews
            </span>
            <div className="w-8 h-8 rounded-md bg-slate-100 text-slate-700 flex items-center justify-center">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-bold text-slate-900">{totalInterviews}</span>
            <p className="text-[11px] text-slate-500 mt-0.5">Across all candidate rounds</p>
          </div>
        </Card>

        <Card className="p-5 border-slate-200 shadow-xs hover:border-amber-300">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-amber-700">
              Pending Availability
            </span>
            <div className="w-8 h-8 rounded-md bg-amber-50 text-amber-600 flex items-center justify-center">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-bold text-slate-900">{pendingAvailability}</span>
            <p className="text-[11px] text-slate-500 mt-0.5">Awaiting candidate windows</p>
          </div>
        </Card>

        <Card className="p-5 border-slate-200 shadow-xs hover:border-sky-300">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-sky-700">
              Ready to Schedule
            </span>
            <div className="w-8 h-8 rounded-md bg-sky-50 text-sky-600 flex items-center justify-center">
              <Sparkles className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-bold text-slate-900">{readyToSchedule}</span>
            <p className="text-[11px] text-slate-500 mt-0.5">Scored & ready for booking</p>
          </div>
        </Card>

        <Card className="p-5 border-slate-200 shadow-xs hover:border-emerald-300">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-700">
              Booked & Confirmed
            </span>
            <div className="w-8 h-8 rounded-md bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-bold text-slate-900">{bookedCount}</span>
            <p className="text-[11px] text-slate-500 mt-0.5">Meet links generated</p>
          </div>
        </Card>
      </div>

      {/* Upcoming / Active Interviews Table (Section 15) */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Active Interview Pipelines</h2>
            <p className="text-xs text-slate-500">
              Track candidate submissions, recommendation scores, and finalized calendar bookings.
            </p>
          </div>
          <Link href="/admin/interviews">
            <Button variant="ghost" size="sm" className="text-xs font-semibold text-workday-blue">
              <span>View All Interviews</span>
              <ArrowRight className="w-3.5 h-3.5 ml-1" />
            </Button>
          </Link>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 font-semibold uppercase tracking-wider border-b border-slate-200">
                <tr>
                  <th className="p-4">Candidate</th>
                  <th className="p-4">Round</th>
                  <th className="p-4">Panelists</th>
                  <th className="p-4">Created Date</th>
                  <th className="p-4">Status</th>
                  <th className="p-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {interviews.slice(0, 6).map((inv) => (
                  <tr key={inv.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="p-4">
                      <span className="font-semibold text-slate-900 block text-sm">
                        {inv.candidate_name}
                      </span>
                      <span className="text-[11px] text-slate-400">
                        {inv.candidate_email} ({inv.candidate_timezone})
                      </span>
                    </td>

                    <td className="p-4">
                      <span className="font-semibold text-slate-800 capitalize">
                        {inv.round_type.toLowerCase()}
                      </span>
                      <span className="block text-[11px] text-slate-500">
                        {inv.duration_minutes}m (+{inv.buffer_minutes}m buffer)
                      </span>
                    </td>

                    <td className="p-4 max-w-xs truncate">
                      {inv.panelists.map((p) => p.name).join(", ")}
                    </td>

                    <td className="p-4 text-slate-500">
                      {formatDateOnly(inv.created_at, user?.timezone)}
                    </td>

                    <td className="p-4">
                      <StatusBadge status={inv.status} />
                    </td>

                    <td className="p-4 text-right">
                      {inv.status === "READY_FOR_SCHEDULING" || inv.status === "RECOMMENDED" ? (
                        <Link href={`/admin/interviews/${inv.id}/recommendations`}>
                          <Button variant="primary" size="sm" className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white gap-1">
                            <Sparkles className="w-3 h-3" />
                            <span>Recommendations</span>
                          </Button>
                        </Link>
                      ) : inv.status === "BOOKED" ? (
                        <Link href={`/admin/interviews/${inv.id}`}>
                          <Button variant="outline" size="sm" className="text-xs text-emerald-800 border-emerald-300 hover:bg-emerald-50">
                            <span>View Booking</span>
                          </Button>
                        </Link>
                      ) : (
                        <Link href={`/admin/interviews/${inv.id}`}>
                          <Button variant="outline" size="sm" className="text-xs">
                            <span>Details</span>
                          </Button>
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Scheduling Activity Feed (Section 15) */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
          <Activity className="w-4 h-4 text-workday-blue" />
          <span>Recent Scheduling Activity</span>
        </h3>

        {interviews.length === 0 ? (
          <div className="p-6 bg-white rounded-lg border border-slate-200 text-xs text-slate-500 text-center">
            No recent interview activity recorded yet. Create an interview request to begin scheduling.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {interviews.slice(0, 3).map((inv) => (
              <div key={inv.id} className="p-4 bg-white rounded-lg border border-slate-200 text-xs space-y-1">
                <span className="font-semibold text-slate-700 flex items-center gap-1.5">
                  <StatusBadge status={inv.status} />
                </span>
                <p className="text-slate-900 font-bold text-xs pt-1">
                  {inv.candidate_name} — {inv.round_type} Round
                </p>
                <p className="text-[11px] text-slate-400">
                  {inv.duration_minutes}m duration • {inv.panelists.length} panelist(s) assigned
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
