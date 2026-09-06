"use client";

import * as React from "react";
import Link from "next/link";
import { Calendar, Clock, Users, ArrowRight } from "lucide-react";

const interviews = [
  {
    id: "int-101",
    round: "TECHNICAL ROUND",
    title: "TECHNICAL Interview",
    company: "ABC Technologies",
    duration: "60 minutes",
    panel: "Devon Vance, Marcus Aurelius",
    status: "Ready to Schedule",
    statusType: "schedule",
  },
  {
    id: "int-102",
    round: "MANAGERIAL ROUND",
    title: "MANAGERIAL Interview",
    company: "ABC Technologies",
    duration: "45 minutes",
    panel: "Devon Vance",
    status: "Booked & Confirmed",
    statusType: "confirmed",
    date: "Tue, Sep 8, 5:04 PM",
  },
];

export default function CandidateInterviewsPage() {
  return (
    <div className="space-y-8 max-w-5xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          My Interviews
        </h1>

        <p className="text-sm text-slate-500 mt-1">
          View and manage all your interview invitations.
        </p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2">
        <button className="px-4 py-2 rounded-lg bg-workday-blue text-white text-xs font-semibold">
          All Interviews
        </button>

        <button className="px-4 py-2 rounded-lg border border-slate-200 bg-white text-slate-600 text-xs font-semibold hover:bg-slate-50">
          Action Required
        </button>

        <button className="px-4 py-2 rounded-lg border border-slate-200 bg-white text-slate-600 text-xs font-semibold hover:bg-slate-50">
          Upcoming
        </button>

        <button className="px-4 py-2 rounded-lg border border-slate-200 bg-white text-slate-600 text-xs font-semibold hover:bg-slate-50">
          Completed
        </button>
      </div>

      {/* Interview List */}
      <div className="space-y-4">
        {interviews.map((interview) => (
          <div
            key={interview.id}
            className="rounded-xl border border-slate-200 bg-white p-6 shadow-enterprise"
          >
            <div className="flex items-start justify-between gap-6">
              <div className="space-y-4">
                <div>
                  <div className="flex items-center gap-2 text-xs font-semibold text-workday-blue">
                    <span>{interview.round}</span>
                    <span className="text-slate-300">•</span>
                    <span className="text-slate-500 font-normal">
                      {interview.duration}
                    </span>
                  </div>

                  <h2 className="text-lg font-bold text-slate-900 mt-1">
                    {interview.title}
                  </h2>

                  <p className="text-sm text-slate-500 mt-1">
                    {interview.company}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-5 text-xs text-slate-500">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4" />
                    <span>{interview.panel}</span>
                  </div>

                  {interview.date && (
                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4" />
                      <span>{interview.date}</span>
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    <span>{interview.duration}</span>
                  </div>
                </div>
              </div>

              <div className="flex flex-col items-end gap-4 shrink-0">
                <span
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold ${
                    interview.statusType === "confirmed"
                      ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                      : "bg-sky-50 text-sky-700 border border-sky-200"
                  }`}
                >
                  {interview.status}
                </span>

                <Link
                  href={`/candidate/interviews/${interview.id}`}
                  className="inline-flex items-center gap-2 text-xs font-semibold text-workday-blue hover:underline"
                >
                  View Details
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}