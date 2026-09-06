"use client";

import * as React from "react";
import { interviewsApi, ApiClientError } from "@/lib/api-client";
import { InterviewRequest, Role } from "@/lib/types";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, CalendarX, XCircle, RotateCcw } from "lucide-react";

type Kind = "decline" | "reschedule" | "cancel";

const TERMINAL = new Set(["CANCELLED", "COMPLETED"]);

const COPY: Record<
  Kind,
  { label: string; icon: React.ComponentType<{ className?: string }>; blurb: string; cta: string }
> = {
  decline: {
    label: "Decline this interview",
    icon: CalendarX,
    blurb:
      "You will be removed as a panelist. If the interview is already booked, the calendar event is cancelled and the recruiter is prompted to re-schedule.",
    cta: "Confirm decline",
  },
  reschedule: {
    label: "Request a reschedule",
    icon: RotateCcw,
    blurb:
      "The confirmed slot and its calendar event are released, and the scheduling engine re-runs to produce fresh recommendations.",
    cta: "Confirm reschedule",
  },
  cancel: {
    label: "Cancel this interview",
    icon: XCircle,
    blurb:
      "The interview request is cancelled. Any confirmed calendar event is deleted and participants are notified. This cannot be undone.",
    cta: "Confirm cancellation",
  },
};

/**
 * Role-aware surface for the Phase 9 lifecycle endpoints
 * (POST /interviews/{id}/decline|reschedule|cancel). Renders nothing when the
 * viewer has no available action for the current status.
 */
export function LifecycleActions({
  interview,
  viewerRole,
  viewerId,
  onDone,
}: {
  interview: InterviewRequest;
  viewerRole: Role;
  viewerId: string | undefined;
  onDone: () => void;
}) {
  const [open, setOpen] = React.useState<Kind | null>(null);
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const isTerminal = TERMINAL.has(interview.status);
  const isBooked = interview.status === "BOOKED";
  const myPanelResponse = interview.panelists.find(
    (p) => p.user_id === viewerId
  )?.response_status;

  const actions: Kind[] = [];
  if (viewerRole === "ADMIN") {
    if (!isTerminal) actions.push("cancel");
    if (isBooked) actions.push("reschedule");
  } else if (viewerRole === "CANDIDATE") {
    if (isBooked) actions.push("reschedule");
  } else if (viewerRole === "PANELIST") {
    if (!isTerminal && myPanelResponse !== "DECLINED") actions.push("decline");
  }

  if (actions.length === 0) return null;

  const run = async (kind: Kind) => {
    setBusy(true);
    setError(null);
    try {
      if (kind === "decline") await interviewsApi.decline(interview.id, reason);
      else if (kind === "reschedule") await interviewsApi.reschedule(interview.id, reason);
      else await interviewsApi.cancel(interview.id, reason);
      setOpen(null);
      setReason("");
      onDone();
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : "The action could not be completed. Please try again."
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-slate-200 shadow-xs">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Interview actions</CardTitle>
        <CardDescription className="text-xs">
          {viewerRole === "PANELIST"
            ? "Let the recruiter know if you can no longer take this interview."
            : viewerRole === "CANDIDATE"
            ? "Ask your recruiter to find a new time for the confirmed interview."
            : "Cancel the request, or release a booked slot to re-schedule."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {actions.map((kind) => {
          const c = COPY[kind];
          const Icon = c.icon;
          const expanded = open === kind;
          return (
            <div key={kind} className="rounded-lg border border-slate-200">
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setOpen(expanded ? null : kind);
                }}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 rounded-lg"
              >
                <Icon className="w-4 h-4 text-slate-500" />
                <span>{c.label}</span>
              </button>
              {expanded && (
                <div className="px-3 pb-3 pt-1 space-y-2 border-t border-slate-100">
                  <p className="text-[11px] text-slate-500">{c.blurb}</p>
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Reason (optional) — shared with the recruiter and in the audit log"
                    rows={2}
                    maxLength={1000}
                    className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-workday-blue/40"
                  />
                  <div className="flex gap-2">
                    <Button
                      variant="primary"
                      size="sm"
                      isLoading={busy}
                      onClick={() => run(kind)}
                      className="bg-rose-600 hover:bg-rose-700"
                    >
                      {c.cta}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setOpen(null);
                        setReason("");
                      }}
                    >
                      Keep interview
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
