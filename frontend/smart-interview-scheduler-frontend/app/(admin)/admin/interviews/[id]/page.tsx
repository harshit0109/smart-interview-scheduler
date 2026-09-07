"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { interviewsApi, invitationsApi, ApiClientError } from "@/lib/api-client";
import {
  InterviewRequest,
  InvitationRecord,
  InvitationSummary,
  ParticipantResponseStatus,
  AuditEntry,
  NotificationLogEntry,
} from "@/lib/types";
import { useAuth } from "@/lib/auth-context";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { InterviewTimeline } from "@/components/shared/InterviewTimeline";
import { LifecycleActions } from "@/components/shared/LifecycleActions";
import { OutcomePanel } from "@/components/shared/OutcomePanel";
import { CopyButton } from "@/components/shared/CopyButton";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateTime, formatDateOnly, formatTimeRange } from "@/lib/utils";
import {
  Calendar,
  Clock,
  Sparkles,
  ArrowLeft,
  ArrowRight,
  Video,
  ExternalLink,
  Users,
  CheckCircle2,
  AlertCircle,
  Copy,
  CalendarCheck,
  Send,
  RefreshCw,
} from "lucide-react";

export default function AdminInterviewDetailPage() {
  const params = useParams();
  const { user } = useAuth();
  const id = params.id as string;

  const [interview, setInterview] = React.useState<InterviewRequest | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);

  const [invitations, setInvitations] = React.useState<InvitationRecord[]>([]);
  const [justIssued, setJustIssued] = React.useState<Record<string, InvitationSummary>>({});
  const [isIssuing, setIsIssuing] = React.useState(false);
  const [issueError, setIssueError] = React.useState<string | null>(null);

  const [audit, setAudit] = React.useState<AuditEntry[] | null>(null);
  const [auditOpen, setAuditOpen] = React.useState(false);

  const [notifications, setNotifications] = React.useState<NotificationLogEntry[]>([]);
  const [reminderBusy, setReminderBusy] = React.useState(false);
  const [reminderMsg, setReminderMsg] = React.useState<string | null>(null);

  const loadNotifications = React.useCallback(async () => {
    try {
      setNotifications(await interviewsApi.getNotifications(id));
    } catch {
      setNotifications([]);
    }
  }, [id]);

  const handleSendReminder = async () => {
    setReminderBusy(true);
    setReminderMsg(null);
    try {
      const r = await interviewsApi.sendReminder(id);
      setReminderMsg(
        r.delivery_status === "SENT"
          ? `Reminder email sent to ${r.to}.`
          : `Reminder ${r.delivery_status.toLowerCase()} (no email service configured) — recipient ${r.to}. Full body written to the backend log.`
      );
      await loadNotifications();
    } catch (err) {
      setReminderMsg(
        err instanceof ApiClientError ? err.message : "Could not send the reminder."
      );
    } finally {
      setReminderBusy(false);
    }
  };

  const loadInvitations = React.useCallback(async () => {
    try {
      const rows = await invitationsApi.list(id);
      setInvitations(rows);
    } catch {
      // No invitations issued yet (or a transient error) — the "Send
      // Invitations" card below handles the empty state either way.
      setInvitations([]);
    }
  }, [id]);

  const loadInterview = React.useCallback(async () => {
    try {
      const data = await interviewsApi.getById(id);
      setInterview(data);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  const loadAudit = React.useCallback(async () => {
    try {
      const res = await interviewsApi.getAudit(id);
      setAudit(res.items);
    } catch {
      setAudit([]);
    }
  }, [id]);

  React.useEffect(() => {
    loadInterview();
    loadInvitations();
    loadNotifications();
  }, [loadInterview, loadInvitations, loadNotifications]);

  const handleSendInvitations = async () => {
    setIsIssuing(true);
    setIssueError(null);
    try {
      const issued = await invitationsApi.issue(id);
      const byUser: Record<string, InvitationSummary> = {};
      for (const row of issued) byUser[row.user_id] = row;
      setJustIssued(byUser);
      await loadInvitations();
    } catch (err: any) {
      setIssueError(
        err instanceof ApiClientError
          ? err.message
          : "Failed to send invitations. Please try again."
      );
    } finally {
      setIsIssuing(false);
    }
  };

  if (isLoading) {
    return (
      <div className="py-16 text-center text-xs text-slate-500">
        Loading interview details...
      </div>
    );
  }

  if (!interview) {
    return (
      <div className="py-16 text-center space-y-3">
        <h3 className="text-base font-bold text-slate-800">Interview Not Found</h3>
        <Link href="/admin/interviews">
          <Button variant="outline" size="sm">Back to Interview List</Button>
        </Link>
      </div>
    );
  }

  const candidateLink =
    typeof window !== "undefined"
      ? `${window.location.origin}/candidate/interviews/${interview.id}/availability`
      : `/candidate/interviews/${interview.id}/availability`;

  return (
    <div className="space-y-8 max-w-5xl">
      {/* Top Breadcrumb & Actions */}
      <div className="flex items-center justify-between">
        <Link href="/admin/interviews">
          <Button variant="ghost" size="sm" className="text-xs -ml-2">
            <ArrowLeft className="w-3.5 h-3.5 mr-1" />
            Back to Interviews
          </Button>
        </Link>

        <div className="flex items-center gap-2">
          {(interview.status === "READY_FOR_SCHEDULING" ||
            interview.status === "RECOMMENDED") && (
            <Link href={`/admin/interviews/${interview.id}/recommendations`}>
              <Button variant="primary" size="sm" className="bg-indigo-600 hover:bg-indigo-700 text-white gap-1.5 shadow-sm">
                <Sparkles className="w-4 h-4" />
                <span>View Recommendations</span>
                <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
          )}
        </div>
      </div>

      {/* Header Banner */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-workday-blue">
              {interview.round_type} Round
            </span>
            <span className="text-xs text-slate-400">•</span>
            <span className="text-xs text-slate-500">
              Duration: {interview.duration_minutes}m (+{interview.buffer_minutes}m buffer)
            </span>
          </div>

          <h1 className="text-2xl font-bold text-slate-900 mt-1">
            Candidate: {interview.candidate_name}
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {interview.candidate_email} ({interview.candidate_timezone})
          </p>
          {(interview.company || interview.title) && (
            <p className="text-xs text-slate-600 mt-1 font-medium">
              {[interview.company, interview.title].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {(interview.round_number ?? 1) > 1 && (
            <Badge variant="outline">Round {interview.round_number}</Badge>
          )}
          {interview.outcome && (
            <Badge
              variant={
                interview.outcome === "PASSED"
                  ? "success"
                  : interview.outcome === "REJECTED"
                  ? "danger"
                  : "warning"
              }
            >
              {interview.outcome}
            </Badge>
          )}
          <StatusBadge status={interview.status} />
        </div>
      </div>

      {/* State timeline (Section 24) */}
      <Card className="p-6 bg-white border-slate-200 shadow-xs">
        <div className="mb-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Interview Lifecycle Progress
          </h3>
        </div>
        <InterviewTimeline status={interview.status} />
      </Card>

      {/* Booked / completed: the confirmed slot + link stay visible as history */}
      {interview.event &&
        ["BOOKED", "COMPLETED"].includes(interview.status) &&
        interview.event.status === "CONFIRMED" && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-6 space-y-4 shadow-sm">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 text-emerald-900 font-bold text-base">
              <CheckCircle2 className="w-6 h-6 text-emerald-600" />
              <span>
                {interview.status === "COMPLETED"
                  ? "Scheduled interview (completed)"
                  : interview.event.provider === "SIMULATED"
                  ? "Interview Booked (development mode)"
                  : "Interview Booked & Google Calendar Confirmed"}
              </span>
            </div>
            <span className="text-xs font-mono font-semibold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded">
              Event ID: {interview.event.calendar_event_id}
            </span>
          </div>

          {interview.event.provider === "SIMULATED" && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-800 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <span>
                Google Calendar OAuth isn&apos;t configured, so no real calendar
                event or Google Meet link was created. Set{" "}
                <span className="font-mono">GOOGLE_CALENDAR_OAUTH_CLIENT_ID</span> /{" "}
                <span className="font-mono">_SECRET</span> on the backend to make
                future bookings create a real event + Meet link for every participant.
              </span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-slate-700 pt-2 border-t border-emerald-200/60">
            <div>
              <span className="text-slate-500 font-medium block">Confirmed Date & Time:</span>
              <p className="text-sm font-bold text-slate-900 mt-0.5">
                {formatDateTime(interview.event.start_time, user?.timezone)}
              </p>
              <p className="text-slate-500 mt-0.5">
                Candidate local: {formatDateTime(interview.event.start_time, interview.candidate_timezone)}
              </p>
            </div>

            <div>
              <span className="text-slate-500 font-medium block">
                {interview.event.provider === "SIMULATED" ? "Video Link:" : "Google Meet Video Link:"}
              </span>
              {interview.event.meeting_link ? (
                <div className="mt-1 flex items-center gap-2">
                  <a
                    href={interview.event.meeting_link}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-md bg-emerald-600 text-white font-semibold text-xs hover:bg-emerald-700 transition-colors shadow-xs"
                  >
                    <Video className="w-4 h-4" />
                    <span>Join Google Meet</span>
                    <ExternalLink className="w-3 h-3 opacity-70" />
                  </a>
                  <CopyButton textToCopy={interview.event.meeting_link} label="Copy link" />
                </div>
              ) : (
                <p className="text-slate-400 mt-1">
                  {interview.event.provider === "SIMULATED"
                    ? "No video link — development booking (Google Calendar not configured)."
                    : "Calendar event created without video link."}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Candidate Availability Status & Share Link */}
      <Card className="border-slate-200 shadow-xs">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Candidate Availability Link</CardTitle>
          <CardDescription className="text-xs">
            Send this link to the candidate so they can submit their available times.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={candidateLink}
              className="flex-1 font-mono text-xs bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-slate-700 select-all"
            />
            <CopyButton textToCopy={candidateLink} />
          </div>

          {interview.availability ? (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800 flex items-center justify-between">
              <span className="flex items-center gap-1.5 font-medium">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                Candidate submitted {interview.availability.windows.length} availability window(s) in {interview.availability.timezone}
              </span>
              <span className="text-[11px] font-mono text-emerald-700">
                Submitted {formatDateOnly(interview.availability.submitted_at)}
              </span>
            </div>
          ) : (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-600 shrink-0" />
              <span>Awaiting candidate availability submission before recommendations can run.</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Panelists Card */}
      <Card className="border-slate-200 shadow-xs">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Assigned Interview Panel</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="divide-y divide-slate-100">
            {interview.panelists.map((pan) => (
              <div key={pan.id} className="py-3 flex items-center justify-between text-xs">
                <div>
                  <p className="font-semibold text-slate-900">{pan.name}</p>
                  <p className="text-slate-500">{pan.email} • {pan.timezone || "UTC"}</p>
                </div>
                <div>
                  {pan.calendar_status === "CONNECTED" ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                      <CalendarCheck className="w-3 h-3 text-emerald-600" />
                      Calendar Connected
                    </span>
                  ) : pan.calendar_status === "EXPIRED" || pan.calendar_status === "REVOKED" ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-800 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                      Calendar needs reconnect
                    </span>
                  ) : pan.calendar_status === "DISCONNECTED" ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-rose-800 bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
                      Calendar not connected
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 bg-slate-50 px-2 py-0.5 rounded border border-slate-200">
                      Calendar status unknown
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Invitations */}
      <Card className="border-slate-200 shadow-xs">
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-sm">Invitations</CardTitle>
            <CardDescription className="text-xs">
              Send or resend an interview invitation. Anyone who already responded keeps
              their response — resending only reaches people still pending or expired.
            </CardDescription>
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSendInvitations}
            isLoading={isIssuing}
            className="gap-1.5 shrink-0"
          >
            {invitations.length > 0 ? (
              <RefreshCw className="w-3.5 h-3.5" />
            ) : (
              <Send className="w-3.5 h-3.5" />
            )}
            {invitations.length > 0 ? "Resend All" : "Send Invitations"}
          </Button>
        </CardHeader>
        <CardContent>
          {issueError && (
            <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{issueError}</span>
            </div>
          )}

          {invitations.length === 0 ? (
            <p className="text-xs text-slate-400 py-2">
              No invitations sent yet. Sending does not affect the interview request itself.
            </p>
          ) : (
            <div className="divide-y divide-slate-100">
              {invitations.map((inv) => {
                const person =
                  inv.user_id === interview.candidate_id
                    ? { name: interview.candidate_name, email: interview.candidate_email }
                    : interview.panelists.find((p) => p.user_id === inv.user_id) ||
                      interview.panelists.find((p) => p.id === inv.user_id);
                // Authoritative — interview_participants.response_status. Unlike
                // the invitation row, resending never resets this, so it's the
                // one source of truth for "did this person actually respond."
                const responseStatus: ParticipantResponseStatus =
                  (inv.user_id === interview.candidate_id
                    ? interview.candidate_response_status
                    : interview.panelists.find((p) => p.user_id === inv.user_id)
                        ?.response_status) || "PENDING";
                const linkExpired = inv.status === "EXPIRED" && responseStatus === "PENDING";
                const fresh = justIssued[inv.user_id];
                return (
                  <div key={inv.id} className="py-3 space-y-2">
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <div>
                        <p className="font-semibold text-slate-900">
                          {person?.name || "Unknown"}{" "}
                          <span className="font-normal text-slate-400">({inv.role})</span>
                        </p>
                        <p className="text-slate-500">{person?.email}</p>
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-1.5 shrink-0">
                        <ResponseStatusBadge status={responseStatus} />
                        {linkExpired && <Badge variant="outline">Link Expired</Badge>}
                        <DeliveryStatusBadge status={inv.delivery_status} />
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-400">
                      Sent {inv.send_count}x • Link expires {formatDateOnly(inv.expires_at)}
                    </p>
                    {fresh && (
                      <div className="flex items-center gap-2 pt-1">
                        <input
                          readOnly
                          value={fresh.invite_url}
                          className="flex-1 font-mono text-[11px] bg-slate-50 border border-slate-200 rounded-md px-2.5 py-1.5 text-slate-700 select-all"
                        />
                        <CopyButton textToCopy={fresh.invite_url} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Email notifications (confirmation / reminder / lifecycle) */}
      {interview.event && (
        <Card className="border-slate-200 shadow-xs">
          <CardHeader className="pb-3 flex flex-row items-start justify-between gap-3">
            <div>
              <CardTitle className="text-sm">Email notifications</CardTitle>
              <CardDescription className="text-xs">
                Confirmation, reminder and lifecycle emails for this interview.
                {" "}
                {notifications.some((n) => n.status === "SIMULATED")
                  ? "SIMULATED = no email service is configured; the full message is written to the backend log, nothing was actually delivered."
                  : "SENT = delivered via the email provider."}
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleSendReminder}
              isLoading={reminderBusy}
              className="shrink-0"
            >
              Send reminder now
            </Button>
          </CardHeader>
          <CardContent>
            {reminderMsg && (
              <div className="mb-3 rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-sky-600 shrink-0" />
                <span>{reminderMsg}</span>
              </div>
            )}
            {notifications.length === 0 ? (
              <p className="text-xs text-slate-400 py-1">
                No emails yet. A confirmation is written when a slot is booked; use
                &ldquo;Send reminder now&rdquo; to preview the reminder.
              </p>
            ) : (
              <div className="divide-y divide-slate-100">
                {notifications.map((n) => (
                  <div key={n.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                    <div>
                      <span className="font-semibold text-slate-900">
                        {n.notification_type.replace(/_/g, " ")}
                      </span>
                      <span className="text-slate-500"> → {n.recipient}</span>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        {formatDateTime(n.sent_at, user?.timezone)}
                      </p>
                    </div>
                    <Badge
                      variant={
                        n.status === "SENT"
                          ? "success"
                          : n.status === "SIMULATED"
                          ? "outline"
                          : "danger"
                      }
                    >
                      {n.status === "SIMULATED" ? "Simulated (no email service)" : n.status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Lifecycle actions — cancel any non-terminal request, reschedule a booked one */}
      <LifecycleActions
        interview={interview}
        viewerRole="ADMIN"
        viewerId={user?.id}
        onDone={() => {
          loadInterview();
          loadInvitations();
          if (auditOpen) loadAudit();
        }}
      />

      {/* Outcome, next round, archive candidate */}
      <OutcomePanel
        interview={interview}
        onDone={() => {
          loadInterview();
          if (auditOpen) loadAudit();
        }}
      />

      {/* Audit trail */}
      <Card className="border-slate-200 shadow-xs">
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-sm">Audit log</CardTitle>
            <CardDescription className="text-xs">
              Every recorded state change for this interview request, newest first.
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const next = !auditOpen;
              setAuditOpen(next);
              if (next && audit === null) loadAudit();
            }}
          >
            {auditOpen ? "Hide" : "Show"}
          </Button>
        </CardHeader>
        {auditOpen && (
          <CardContent>
            {audit === null ? (
              <p className="text-xs text-slate-400 py-2">Loading audit entries…</p>
            ) : audit.length === 0 ? (
              <p className="text-xs text-slate-400 py-2">No audit entries recorded yet.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {audit.map((entry) => (
                  <div key={entry.id} className="py-2.5 text-xs">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-semibold text-slate-900">
                        {entry.action.replaceAll("_", " ")}
                      </span>
                      <span className="text-[11px] font-mono text-slate-400">
                        {formatDateTime(entry.created_at, user?.timezone)}
                      </span>
                    </div>
                    <p className="text-slate-500 mt-0.5">
                      by {entry.actor_role}
                      {entry.metadata && typeof entry.metadata.reason === "string"
                        ? ` — “${entry.metadata.reason}”`
                        : ""}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        )}
      </Card>
    </div>
  );
}

function ResponseStatusBadge({ status }: { status: ParticipantResponseStatus }) {
  const variant =
    status === "ACCEPTED"
      ? "success"
      : status === "DECLINED"
      ? "danger"
      : status === "UNAVAILABLE"
      ? "warning"
      : "info";
  return <Badge variant={variant}>{status}</Badge>;
}

function DeliveryStatusBadge({ status }: { status: string | null }) {
  if (!status) return null;
  const label =
    status === "SENT" ? "Email Sent" : status === "SIMULATED" ? "Simulated (no email service)" : "Delivery Failed";
  const variant = status === "SENT" ? "success" : status === "SIMULATED" ? "outline" : "danger";
  return <Badge variant={variant}>{label}</Badge>;
}
