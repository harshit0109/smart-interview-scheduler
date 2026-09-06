"use client";

import * as React from "react";
import { CalendarConnectionPanel } from "@/components/shared/CalendarConnectionPanel";
import { Info } from "lucide-react";

export default function PanelistCalendarPage() {
  return (
    <div className="space-y-8 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          Google Calendar Synchronization
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Connect your Google Calendar so Smart Interview Scheduler can check your
          free/busy availability when recommending optimal interview slots.
        </p>
      </div>

      {/* Google Login vs Google Calendar — two separate OAuth flows */}
      <div className="rounded-xl border border-sky-200 bg-sky-50/70 p-5 text-sm text-slate-800">
        <div className="flex items-start gap-3">
          <Info className="w-5 h-5 text-workday-blue shrink-0 mt-0.5" />
          <div className="space-y-2">
            <h4 className="font-bold text-workday-navy text-sm">
              Sign-In vs Calendar Synchronization
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs pt-1">
              <div className="p-3 bg-white/80 rounded-lg border border-sky-100">
                <span className="font-semibold text-slate-900 block mb-1">
                  1. Google Identity Sign-In
                </span>
                <p className="text-slate-600">
                  Verifies who you are (name &amp; email). Never accesses your schedule.
                </p>
              </div>
              <div className="p-3 bg-white/80 rounded-lg border border-sky-100">
                <span className="font-semibold text-slate-900 block mb-1">
                  2. Google Calendar Integration
                </span>
                <p className="text-slate-600">
                  Computes free/busy availability and creates confirmed interview
                  events with Google Meet.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <CalendarConnectionPanel />
    </div>
  );
}
