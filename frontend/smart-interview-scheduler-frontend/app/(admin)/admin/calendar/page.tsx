"use client";

import * as React from "react";
import { CalendarConnectionPanel } from "@/components/shared/CalendarConnectionPanel";

// Lives inside the (admin) route group so it renders with the normal admin
// AppShell (sidebar + header). The OAuth redirect targets stay at
// /calendar/connected and /calendar/error.
export default function AdminCalendarPage() {
  return (
    <div className="space-y-8 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          Google Calendar
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Connect Google Calendar so booking a slot creates one real calendar
          event with a Google Meet link for every participant.
        </p>
      </div>

      <CalendarConnectionPanel />
    </div>
  );
}
