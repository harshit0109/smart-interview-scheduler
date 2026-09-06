"use client";

import * as React from "react";
import { useAuth } from "@/lib/auth-context";
import { RoleGuard } from "@/components/shared/RoleGuard";
import {
  Calendar,
  CheckCircle2,
  CalendarX2,
} from "lucide-react";

export default function CalendarPage() {
  return (
    <RoleGuard allowedRole={["ADMIN", "PANELIST"]}>
      <CalendarContent />
    </RoleGuard>
  );
}

function CalendarContent() {
  const { user, calendarStatus } = useAuth();

  const isConnected = calendarStatus === "CONNECTED";

  return (
    <div className="space-y-8 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          Google Calendar
        </h1>

        <p className="text-sm text-slate-500 mt-1">
          Manage your Google Calendar connection for interview scheduling.
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-enterprise">
        <div className="flex items-start gap-4">
          {isConnected ? (
            <CheckCircle2 className="w-8 h-8 text-emerald-600 shrink-0" />
          ) : (
            <CalendarX2 className="w-8 h-8 text-slate-400 shrink-0" />
          )}

          <div>
            <h2 className="text-base font-bold text-slate-900">
              {isConnected
                ? "Google Calendar Connected"
                : "Google Calendar Not Connected"}
            </h2>

            <p className="text-xs text-slate-500 mt-1">
              Account: {user?.email || "Not available"}
            </p>

            <p className="text-xs text-slate-600 mt-3">
              {isConnected
                ? "Your Google Calendar is connected and available for interview scheduling."
                : "Connect your Google Calendar to allow the scheduler to check your availability."}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}