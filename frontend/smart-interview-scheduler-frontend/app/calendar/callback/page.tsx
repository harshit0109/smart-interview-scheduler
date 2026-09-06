"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { calendarApi } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CheckCircle2, AlertCircle, Calendar, ArrowRight, Loader2 } from "lucide-react";

function CalendarCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { refreshCalendarStatus, role } = useAuth();

  const [status, setStatus] = React.useState<"loading" | "success" | "error">("loading");
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const errorParam = searchParams.get("error");

  React.useEffect(() => {
    const exchange = async () => {
      if (errorParam) {
        setStatus("error");
        setErrorMessage("Google Calendar authorization was declined or cancelled.");
        return;
      }

      if (!code) {
        setStatus("error");
        setErrorMessage("Missing authorization code in redirect.");
        return;
      }

      try {
        await calendarApi.handleCallback(code, state || "");
        await refreshCalendarStatus();
        setStatus("success");
      } catch (err: any) {
        setStatus("error");
        setErrorMessage(
          err.message || "We couldn't connect your Google Calendar. Please try again."
        );
      }
    };

    exchange();
  }, [code, state, errorParam]);

  const targetDashboard = role === "PANELIST" ? "/panelist" : "/admin";

  return (
    <div className="min-h-screen bg-workday-surface flex items-center justify-center p-6 text-slate-900">
      <Card className="max-w-md w-full p-8 text-center space-y-6 shadow-enterprise border-slate-200">
        {status === "loading" && (
          <div className="space-y-4 py-6">
            <Loader2 className="w-12 h-12 text-workday-blue animate-spin mx-auto" />
            <h2 className="text-xl font-bold text-slate-900">
              Connecting Google Calendar...
            </h2>
            <p className="text-xs text-slate-500">
              Exchanging authorization code and saving free/busy synchronization tokens...
            </p>
          </div>
        )}

        {status === "success" && (
          <div className="space-y-4 py-4">
            <div className="w-14 h-14 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <h2 className="text-xl font-bold text-slate-900">
              Google Calendar Connected Successfully
            </h2>
            <p className="text-xs text-slate-600 leading-relaxed max-w-sm mx-auto">
              Your Google Calendar is now synced. Smart Interview Scheduler can now automatically read your free/busy intervals and generate optimal interview slots.
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
          </div>
        )}

        {status === "error" && (
          <div className="space-y-4 py-4">
            <div className="w-14 h-14 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center mx-auto">
              <AlertCircle className="w-8 h-8" />
            </div>
            <h2 className="text-xl font-bold text-slate-900">
              Calendar Connection Failed
            </h2>
            <p className="text-xs text-rose-700 bg-rose-50 p-3 rounded-lg border border-rose-200">
              {errorMessage}
            </p>
            <div className="pt-4 flex justify-center gap-3">
              <Link href="/panelist/calendar">
                <Button variant="primary" size="md">
                  Try Connecting Again
                </Button>
              </Link>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

export default function CalendarCallbackPage() {
  return (
    <React.Suspense
      fallback={
        <div className="min-h-screen bg-workday-surface flex items-center justify-center text-xs text-slate-500">
          Loading calendar callback...
        </div>
      }
    >
      <CalendarCallbackContent />
    </React.Suspense>
  );
}
