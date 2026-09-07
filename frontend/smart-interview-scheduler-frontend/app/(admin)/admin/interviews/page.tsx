"use client";

import * as React from "react";
import Link from "next/link";
import { interviewsApi } from "@/lib/api-client";
import { InterviewRequest, InterviewStatus } from "@/lib/types";
import { useAuth } from "@/lib/auth-context";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { formatDateOnly } from "@/lib/utils";
import {
  Plus,
  Filter,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";

type FilterTab = "ALL" | InterviewStatus;

export default function AdminInterviewsListPage() {
  const { user } = useAuth();
  const [interviews, setInterviews] = React.useState<InterviewRequest[]>([]);
  const [activeTab, setActiveTab] = React.useState<FilterTab>("ALL");
  const [page, setPage] = React.useState(0);
  const [size] = React.useState(10);
  const [total, setTotal] = React.useState(0);
  const [isLoading, setIsLoading] = React.useState(true);

  const fetchInterviews = async (pageIndex: number) => {
    setIsLoading(true);
    try {
      const res = await interviewsApi.list(pageIndex, size);
      setInterviews(res.items);
      setTotal(res.total);
      setPage(res.page);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  React.useEffect(() => {
    fetchInterviews(0);
  }, []);

  const filteredInterviews = interviews.filter((item) => {
    if (activeTab === "ALL") return true;
    return item.status === activeTab;
  });

  const totalPages = Math.ceil(total / size) || 1;

  const tabs: { label: string; value: FilterTab }[] = [
    { label: "All", value: "ALL" },
    { label: "Awaiting Availability", value: "AWAITING_CANDIDATE_AVAILABILITY" },
    { label: "Ready to Schedule", value: "READY_FOR_SCHEDULING" },
    { label: "Recommended", value: "RECOMMENDED" },
    { label: "Booked", value: "BOOKED" },
    { label: "Draft", value: "DRAFT" },
    { label: "Failed", value: "FAILED" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            Interview Management
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Review candidate pipeline requests, track calendar synchronization, and book recommended slots.
          </p>
        </div>

        <Link href="/admin/interviews/new">
          <Button variant="workday" size="md" className="gap-2">
            <Plus className="w-4 h-4 stroke-[3]" />
            <span>Create Interview Request</span>
          </Button>
        </Link>
      </div>

      {/* Filter Tabs (Section 22) */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 border-b border-slate-200">
        {tabs.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            className={cn(
              "px-3.5 py-2 text-xs font-semibold rounded-t-lg transition-colors whitespace-nowrap",
              activeTab === tab.value
                ? "bg-white text-workday-blue border-b-2 border-workday-blue font-bold shadow-xs"
                : "text-slate-500 hover:text-slate-800 hover:bg-slate-100"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Data Table */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 font-semibold uppercase tracking-wider border-b border-slate-200">
              <tr>
                <th className="p-4">Candidate</th>
                <th className="p-4">Round</th>
                <th className="p-4">Assigned Panelists</th>
                <th className="p-4">Created</th>
                <th className="p-4">Status</th>
                <th className="p-4 text-right">Next Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {filteredInterviews.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-400">
                    No interview requests match the selected filter.
                  </td>
                </tr>
              ) : (
                filteredInterviews.map((inv) => (
                  <tr key={inv.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="p-4">
                      <Link
                        href={`/admin/interviews/${inv.id}`}
                        className="font-semibold text-slate-900 hover:text-workday-blue text-sm block"
                      >
                        {inv.candidate_name}
                      </Link>
                      <span className="block text-[11px] font-medium text-slate-600">
                        {[inv.company, inv.title].filter(Boolean).join(" · ") || "No company / role set"}
                      </span>
                      <span className="text-[11px] text-slate-400">
                        {inv.candidate_email} ({inv.candidate_timezone})
                      </span>
                    </td>

                    <td className="p-4">
                      <span className="font-semibold text-slate-800 capitalize">
                        {inv.round_type.toLowerCase()}
                        {inv.round_number && inv.round_number > 1 ? ` · Round ${inv.round_number}` : ""}
                      </span>
                      <span className="block text-[11px] text-slate-500">
                        {inv.duration_minutes} mins (+{inv.buffer_minutes}m buffer)
                      </span>
                    </td>

                    <td className="p-4 max-w-xs">
                      <div className="flex flex-wrap gap-1">
                        {inv.panelists.map((p) => (
                          <span
                            key={p.id}
                            className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded text-[11px]"
                          >
                            {p.name}
                          </span>
                        ))}
                      </div>
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
                          <Button
                            variant="primary"
                            size="sm"
                            className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white gap-1"
                          >
                            <Sparkles className="w-3.5 h-3.5" />
                            <span>Recommendations</span>
                          </Button>
                        </Link>
                      ) : (
                        <Link href={`/admin/interviews/${inv.id}`}>
                          <Button variant="outline" size="sm" className="text-xs">
                            Manage
                          </Button>
                        </Link>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Real Pagination Footer (Section 22) */}
        <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs text-slate-500">
          <span>
            Showing <strong className="text-slate-800">{filteredInterviews.length}</strong> of{" "}
            <strong className="text-slate-800">{total}</strong> interviews
          </span>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 0 || isLoading}
              onClick={() => fetchInterviews(page - 1)}
              className="text-xs"
            >
              <ChevronLeft className="w-3.5 h-3.5 mr-1" />
              Previous
            </Button>
            <span className="px-2 font-mono">
              Page {page + 1} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages - 1 || isLoading}
              onClick={() => fetchInterviews(page + 1)}
              className="text-xs"
            >
              Next
              <ChevronRight className="w-3.5 h-3.5 ml-1" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
