"use client";

import * as React from "react";
import Link from "next/link";
import { interviewsApi } from "@/lib/api-client";
import { InterviewRequest } from "@/lib/types";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Users, Clock } from "lucide-react";

export default function PanelistInterviewsPage() {
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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">My Assigned Interviews</h1>
        <p className="text-sm text-slate-500 mt-1">
          Review all scheduled and in-progress candidate rounds where you are a panel interviewer.
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-xs overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-slate-500 font-semibold uppercase tracking-wider border-b border-slate-200">
            <tr>
              <th className="p-3.5">Candidate</th>
              <th className="p-3.5">Round Type</th>
              <th className="p-3.5">Duration</th>
              <th className="p-3.5">Panel Members</th>
              <th className="p-3.5">Status</th>
              <th className="p-3.5 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-700">
            {interviews.map((inv) => (
              <tr key={inv.id} className="hover:bg-slate-50/70">
                <td className="p-3.5 font-semibold text-slate-900">
                  {inv.candidate_name}
                  <span className="block text-[11px] text-slate-400 font-normal">
                    {inv.candidate_email}
                  </span>
                </td>
                <td className="p-3.5 capitalize">{inv.round_type.toLowerCase()}</td>
                <td className="p-3.5">{inv.duration_minutes} mins</td>
                <td className="p-3.5">{inv.panelists.map((p) => p.name).join(", ")}</td>
                <td className="p-3.5">
                  <StatusBadge status={inv.status} />
                </td>
                <td className="p-3.5 text-right">
                  <Link href={`/panelist/interviews/${inv.id}`}>
                    <Button variant="outline" size="sm" className="text-xs">
                      View Details
                    </Button>
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
