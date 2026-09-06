"use client";

import * as React from "react";
import { calendarApi } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { CalendarStatusResponse } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import {
  Calendar,
  CheckCircle2,
  AlertTriangle,
  CalendarX2,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
  Info,
  Clock,
} from "lucide-react";

export default function PanelistCalendarPage() {
  const { user, refreshCalendarStatus } = useAuth();
  const [calendarData, setCalendarData] = React.useState<CalendarStatusResponse | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isConnecting, setIsConnecting] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  const fetchStatus = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const data = await calendarApi.getStatus();
      setCalendarData(data);
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to retrieve Google Calendar synchronization status.");
    } finally {
      setIsLoading(false);
    }
  };

  React.useEffect(() => {
    fetchStatus();
  }, []);

  const handleConnectCalendar = async () => {
    setIsConnecting(true);
    setErrorMsg(null);
    try {
      const { authorization_url } = await calendarApi.connect();
      // Directly redirect to backend OAuth URL per specification
      window.location.href = authorization_url;
    } catch (err: any) {
      setIsConnecting(false);
      setErrorMsg(err.message || "Failed to initiate Google Calendar connection.");
    }
  };

  const handleDisconnect = async () => {
    await fetchStatus();
    await refreshCalendarStatus();
  };

  const status = calendarData?.status || "DISCONNECTED";

  return (
    <div className="space-y-8 max-w-4xl">
      {/* Header / Intro */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          Google Calendar Synchronization
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Connect your Google Calendar so Smart Interview Scheduler can check your free/busy availability when recommending optimal interview slots.
        </p>
      </div>

      {/* Critical Clarification Box (Section 30: Google Login vs Google Calendar) */}
      <div className="rounded-xl border border-sky-200 bg-sky-50/70 p-5 text-sm text-slate-800">
        <div className="flex items-start gap-3">
          <Info className="w-5 h-5 text-workday-blue shrink-0 mt-0.5" />
          <div className="space-y-2">
            <h4 className="font-bold text-workday-navy text-sm">
              Important Distinction: Sign-In vs Calendar Synchronization
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs pt-1">
              <div className="p-3 bg-white/80 rounded-lg border border-sky-100">
                <span className="font-semibold text-slate-900 block mb-1">
                  1. Google Identity Sign-In
                </span>
                <p className="text-slate-600">
                  Used solely to verify who you are (name & email). It never accesses or modifies your personal schedule.
                </p>
              </div>

              <div className="p-3 bg-white/80 rounded-lg border border-sky-100">
                <span className="font-semibold text-slate-900 block mb-1">
                  2. Google Calendar Integration
                </span>
                <p className="text-slate-600">
                  Used separately to compute free/busy availability intervals and automatically generate confirmed interview events with Google Meet.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {errorMsg && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800 flex items-center gap-2.5">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Main Status Card */}
      <Card className="border-slate-200 shadow-enterprise overflow-hidden">
        <CardHeader className="bg-slate-50/60 pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Calendar className="w-5 h-5 text-workday-blue" />
              <span>Connection Status</span>
            </CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchStatus}
              isLoading={isLoading}
              className="text-xs"
            >
              <RefreshCw className="w-3.5 h-3.5 mr-1" />
              Refresh Status
            </Button>
          </div>
        </CardHeader>

        <CardContent className="pt-6 space-y-6">
          {/* Status states */}
          {status === "CONNECTED" && (
            <div className="space-y-4">
              <div className="flex items-start gap-4 p-4 rounded-xl bg-emerald-50 border border-emerald-200">
                <CheckCircle2 className="w-8 h-8 text-emerald-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <h3 className="text-sm font-bold text-emerald-950">
                    Google Calendar Connected & Synchronized
                  </h3>
                  <p className="text-xs text-emerald-800 leading-relaxed">
                    Your calendar is connected for interview scheduling. The scheduler can securely query free/busy intervals to recommend conflict-free slots.
                  </p>
                  {calendarData?.last_synced_at && (
                    <p className="text-[11px] text-emerald-700 font-medium pt-1 flex items-center gap-1.5">
                      <Clock className="w-3 h-3" />
                      Last synced: {formatDateTime(calendarData.last_synced_at, user?.timezone)}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                <p className="text-xs text-slate-500">
                  Account: <span className="font-semibold text-slate-800">{user?.email}</span>
                </p>
                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleConnectCalendar}
                    isLoading={isConnecting}
                  >
                    Re-authenticate
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleDisconnect}
                    className="text-rose-600 hover:bg-rose-50"
                  >
                    Disconnect
                  </Button>
                </div>
              </div>
            </div>
          )}

          {status === "DISCONNECTED" && (
            <div className="space-y-4">
              <div className="flex items-start gap-4 p-4 rounded-xl bg-slate-50 border border-slate-200">
                <CalendarX2 className="w-8 h-8 text-slate-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <h3 className="text-sm font-bold text-slate-900">
                    Google Calendar Not Connected
                  </h3>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Connect your calendar to allow the interview scheduler to read your free/busy commitments and protect you from overlapping sessions.
                  </p>
                </div>
              </div>

              <div className="pt-2">
                <Button
                  variant="primary"
                  size="md"
                  onClick={handleConnectCalendar}
                  isLoading={isConnecting}
                  className="gap-2"
                >
                  <Calendar className="w-4 h-4" />
                  <span>Connect Google Calendar</span>
                  <ExternalLink className="w-3.5 h-3.5 opacity-70" />
                </Button>
              </div>
            </div>
          )}

          {status === "REVOKED" && (
            <div className="space-y-4">
              <div className="flex items-start gap-4 p-4 rounded-xl bg-amber-50 border border-amber-200">
                <AlertTriangle className="w-8 h-8 text-amber-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <h3 className="text-sm font-bold text-amber-950">
                    Google Calendar Access Needs Attention
                  </h3>
                  <p className="text-xs text-amber-800 leading-relaxed">
                    Your Google Calendar authorization was revoked or expired. The scheduler will not be able to compute your availability until reconnected.
                  </p>
                </div>
              </div>

              <div className="pt-2">
                <Button
                  variant="primary"
                  size="md"
                  onClick={handleConnectCalendar}
                  isLoading={isConnecting}
                  className="bg-amber-600 hover:bg-amber-700 text-white"
                >
                  Reconnect Google Calendar
                </Button>
              </div>
            </div>
          )}

          {status === "EXPIRED" && (
            <div className="space-y-4">
              <div className="flex items-start gap-4 p-4 rounded-xl bg-slate-50 border border-slate-200">
                <Clock className="w-8 h-8 text-slate-500 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <h3 className="text-sm font-bold text-slate-900">
                    Calendar Synchronization Inactive
                  </h3>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Your session token has expired. You can re-authorize below to resume automated scheduling checks.
                  </p>
                </div>
              </div>

              <div className="pt-2">
                <Button
                  variant="primary"
                  size="md"
                  onClick={handleConnectCalendar}
                  isLoading={isConnecting}
                >
                  Refresh Google Calendar Auth
                </Button>
              </div>
            </div>
          )}

          {/* Privacy & Scope Protection Details */}
          <div className="pt-4 border-t border-slate-100 flex items-start gap-2.5 text-xs text-slate-500">
            <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <p>
              Smart Interview Scheduler requests read-only free/busy interval access and event creation permissions strictly for scheduled interviews. Personal event descriptions or invitee lists are never stored.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
