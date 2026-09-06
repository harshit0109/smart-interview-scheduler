"use client";

import * as React from "react";
import { calendarApi } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { CalendarStatusResponse } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
  Calendar,
  CheckCircle2,
  AlertTriangle,
  CalendarX2,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
  Clock,
} from "lucide-react";

/**
 * The real Google Calendar connect/status surface, shared by the admin
 * (`/calendar`) and panelist (`/panelist/calendar`) pages. Talks to the live
 * backend: POST /calendar/connect → Google consent → GET /calendar/callback →
 * 302 back to /calendar/connected. Honest about an unconfigured deployment
 * (empty client_id in the auth URL) — no fake "connected".
 */
export function CalendarConnectionPanel() {
  const { user, refreshCalendarStatus } = useAuth();
  const [calendarData, setCalendarData] = React.useState<CalendarStatusResponse | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isConnecting, setIsConnecting] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [oauthNotConfigured, setOauthNotConfigured] = React.useState(false);

  const fetchStatus = React.useCallback(async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const data = await calendarApi.getStatus();
      setCalendarData(data);
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to retrieve Google Calendar status.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleConnect = async () => {
    setIsConnecting(true);
    setErrorMsg(null);
    setOauthNotConfigured(false);
    try {
      const { authorization_url } = await calendarApi.connect();
      // Unconfigured deployments return an auth URL with an empty client_id —
      // that would land the user on a broken Google consent screen. Detect it.
      const clientId = new URL(authorization_url, window.location.origin).searchParams.get(
        "client_id"
      );
      if (!clientId) {
        setIsConnecting(false);
        setOauthNotConfigured(true);
        return;
      }
      window.location.href = authorization_url;
    } catch (err: any) {
      setIsConnecting(false);
      setErrorMsg(err.message || "Failed to initiate Google Calendar connection.");
    }
  };

  const status = calendarData?.status || "DISCONNECTED";
  const needsConnect = status === "DISCONNECTED" || status === "REVOKED" || status === "EXPIRED";

  return (
    <div className="space-y-6">
      {errorMsg && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800 flex items-center gap-2.5">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {oauthNotConfigured && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800 flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <span>
            Google Calendar integration hasn&apos;t been configured for this deployment
            yet. Set <span className="font-mono">GOOGLE_CALENDAR_OAUTH_CLIENT_ID</span> and
            {" "}
            <span className="font-mono">GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET</span> on the
            backend, then reconnect.
          </span>
        </div>
      )}

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
              Refresh
            </Button>
          </div>
        </CardHeader>

        <CardContent className="pt-6 space-y-6">
          {status === "CONNECTED" && (
            <div className="space-y-4">
              <div className="flex items-start gap-4 p-4 rounded-xl bg-emerald-50 border border-emerald-200">
                <CheckCircle2 className="w-8 h-8 text-emerald-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <h3 className="text-sm font-bold text-emerald-950">
                    Google Calendar Connected
                  </h3>
                  <p className="text-xs text-emerald-800 leading-relaxed">
                    The scheduler can query your free/busy intervals and create the
                    confirmed interview event with a Google Meet link.
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
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleConnect}
                  isLoading={isConnecting}
                >
                  Re-authenticate
                </Button>
              </div>
            </div>
          )}

          {needsConnect && (
            <div className="space-y-4">
              <div className="flex items-start gap-4 p-4 rounded-xl bg-slate-50 border border-slate-200">
                {status === "DISCONNECTED" ? (
                  <CalendarX2 className="w-8 h-8 text-slate-400 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="w-8 h-8 text-amber-600 shrink-0 mt-0.5" />
                )}
                <div className="space-y-1">
                  <h3 className="text-sm font-bold text-slate-900">
                    {status === "DISCONNECTED"
                      ? "Google Calendar Not Connected"
                      : status === "REVOKED"
                      ? "Google Calendar Access Revoked"
                      : "Google Calendar Authorization Expired"}
                  </h3>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Connect your calendar so the scheduler can read your free/busy
                    commitments and create the confirmed interview event.
                  </p>
                </div>
              </div>
              <Button
                variant="primary"
                size="md"
                onClick={handleConnect}
                isLoading={isConnecting}
                className="gap-2"
              >
                <Calendar className="w-4 h-4" />
                <span>
                  {status === "DISCONNECTED" ? "Connect Google Calendar" : "Reconnect Google Calendar"}
                </span>
                <ExternalLink className="w-3.5 h-3.5 opacity-70" />
              </Button>
            </div>
          )}

          <div className="pt-4 border-t border-slate-100 flex items-start gap-2.5 text-xs text-slate-500">
            <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <p>
              Requests read-only free/busy access and event-creation permission for
              scheduled interviews only. Personal event details are never stored.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
