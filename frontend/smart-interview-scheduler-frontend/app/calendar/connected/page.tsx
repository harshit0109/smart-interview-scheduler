"use client";

import * as React from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CheckCircle2, ArrowRight } from "lucide-react";

/**
 * Landing page for the Google Calendar OAuth success redirect.
 *
 * Flow: Google → backend `GET /api/v1/calendar/callback` (does the token
 * exchange) → backend 302 → here. There is no code to exchange on this page;
 * we just confirm and refresh the cached connection status.
 */
export default function CalendarConnectedPage() {
  const { refreshCalendarStatus, role } = useAuth();

  React.useEffect(() => {
    refreshCalendarStatus();
  }, [refreshCalendarStatus]);

  const targetDashboard = role === "PANELIST" ? "/panelist" : "/admin";

  return (
    <div className="min-h-screen bg-workday-surface flex items-center justify-center p-6 text-slate-900">
      <Card className="max-w-md w-full p-8 text-center space-y-6 shadow-enterprise border-slate-200">
        <div className="w-14 h-14 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
          <CheckCircle2 className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-bold text-slate-900">
          Google Calendar Connected
        </h2>
        <p className="text-xs text-slate-600 leading-relaxed max-w-sm mx-auto">
          Your Google Calendar is now synced. Smart Interview Scheduler can read
          your free/busy intervals to recommend conflict-free interview slots and
          create confirmed calendar events.
        </p>
        <div className="pt-4 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link href="/panelist/calendar" className="w-full sm:w-auto">
            <Button variant="outline" size="md" className="w-full">
              View Calendar Status
            </Button>
          </Link>
          <Link href={targetDashboard} className="w-full sm:w-auto">
            <Button variant="primary" size="md" className="w-full">
              Return to Dashboard <ArrowRight className="w-4 h-4 ml-1.5" />
            </Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
