"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { invitationsApi, ApiClientError } from "@/lib/api-client";
import { useAuth, getDashboardRoute } from "@/lib/auth-context";
import { InvitationPublic, InvitationResponseValue } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Sparkles,
  Loader2,
  AlertCircle,
  CheckCircle2,
  XCircle,
  CalendarX2,
  ArrowRight,
  ShieldCheck,
} from "lucide-react";

/**
 * Public, unauthenticated page — no RoleGuard. The raw token in the URL is
 * the only credential; it resolves one participant_invitations row on the
 * backend (app/invitations/, GET/POST /invitations/{token}...).
 */
export default function InvitePage() {
  const params = useParams();
  const token = params.token as string;
  const { claimInvitationAccount, isLoading: authLoading } = useAuth();

  const [invitation, setInvitation] = React.useState<InvitationPublic | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const [reason, setReason] = React.useState("");
  const [isResponding, setIsResponding] = React.useState<InvitationResponseValue | null>(null);
  const [respondError, setRespondError] = React.useState<string | null>(null);

  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [claimError, setClaimError] = React.useState<string | null>(null);
  const [isClaiming, setIsClaiming] = React.useState(false);
  const [claimed, setClaimed] = React.useState(false);
  const dashboardRouteRef = React.useRef<string>("/login");

  const load = React.useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const data = await invitationsApi.getByToken(token);
      setInvitation(data);
    } catch (err: any) {
      setLoadError(err.message || "This invitation link could not be loaded.");
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  React.useEffect(() => {
    load();
  }, [load]);

  const handleRespond = async (response: InvitationResponseValue) => {
    setRespondError(null);
    setIsResponding(response);
    try {
      const updated = await invitationsApi.respond(token, {
        response,
        reason: reason.trim() || undefined,
      });
      setInvitation(updated);
    } catch (err: any) {
      setRespondError(err.message || "Failed to record your response. Please try again.");
    } finally {
      setIsResponding(null);
    }
  };

  const handleClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    setClaimError(null);
    if (password.length < 8) {
      setClaimError("Password must be at least 8 characters long.");
      return;
    }
    if (!/\d/.test(password)) {
      setClaimError("Password must contain at least one number.");
      return;
    }
    if (password !== confirmPassword) {
      setClaimError("Passwords do not match.");
      return;
    }
    setIsClaiming(true);
    try {
      const profile = await claimInvitationAccount(token, password);
      setClaimed(true);
      setInvitation((prev) =>
        prev ? { ...prev, account_claimed: true } : prev
      );
      // getDashboardRoute is used below for the post-claim link, sourced
      // from the freshly-returned profile so the tokens actually match it.
      dashboardRouteRef.current = getDashboardRoute(profile.role);
    } catch (err: any) {
      if (err instanceof ApiClientError && err.code === "ACCOUNT_ALREADY_CLAIMED") {
        setClaimError("This account already has a password set. Please sign in instead.");
      } else if (err instanceof ApiClientError && err.code === "INVITATION_EXPIRED") {
        setClaimError("This invitation has expired. Ask the recruiter to resend it.");
      } else {
        setClaimError(err.message || "Failed to set up your account. Please try again.");
      }
    } finally {
      setIsClaiming(false);
    }
  };

  if (isLoading) {
    return (
      <Centered>
        <Loader2 className="w-8 h-8 text-workday-blue animate-spin" />
        <p className="text-xs text-slate-500 mt-3">Loading your invitation…</p>
      </Centered>
    );
  }

  if (loadError || !invitation) {
    return (
      <Centered>
        <div className="w-14 h-14 rounded-full bg-rose-50 text-rose-500 flex items-center justify-center mx-auto">
          <AlertCircle className="w-7 h-7" />
        </div>
        <h1 className="text-lg font-bold text-slate-900 mt-4">Invitation Not Found</h1>
        <p className="text-sm text-slate-500 mt-1 max-w-sm">
          {loadError || "This invitation link is invalid."} If you believe this is a
          mistake, contact the person who invited you for a fresh link.
        </p>
      </Centered>
    );
  }

  const label = invitation.interview_title || `${invitation.round_type} Round`;
  const alreadyResponded = ["ACCEPTED", "DECLINED", "UNAVAILABLE"].includes(invitation.status);
  const needsClaim = invitation.requires_account_setup && !invitation.account_claimed;

  return (
    <div className="min-h-screen bg-workday-surface flex flex-col justify-center py-12 px-4 text-slate-900">
      <div className="mx-auto w-full max-w-lg space-y-6">
        <div className="text-center">
          <div className="w-9 h-9 rounded-lg bg-workday-blue flex items-center justify-center text-white mx-auto shadow-sm">
            <Sparkles className="w-4 h-4" />
          </div>
          <span className="text-xs font-bold uppercase tracking-widest text-slate-500 block mt-2">
            Interview Invitation
          </span>
        </div>

        <Card className="p-6 border-slate-200 shadow-enterprise space-y-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900">{label}</h1>
            <p className="text-xs text-slate-500 mt-1">
              You&apos;ve been invited as a{" "}
              <span className="font-semibold text-slate-700">
                {invitation.role === "CANDIDATE" ? "Candidate" : "Panelist"}
              </span>{" "}
              — {invitation.duration_minutes} minutes.
            </p>
          </div>

          {invitation.status === "EXPIRED" ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 flex items-start gap-3">
              <CalendarX2 className="w-5 h-5 text-slate-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-slate-800">This invitation has expired</p>
                <p className="text-xs text-slate-500 mt-1">
                  Ask the recruiter to resend it — resending issues a fresh link.
                </p>
              </div>
            </div>
          ) : (
            <>
              {alreadyResponded && (
                <div className="rounded-lg border border-sky-200 bg-sky-50/70 p-4 flex items-center gap-3">
                  <ResponseBadge status={invitation.status} />
                  <p className="text-xs text-slate-600">
                    You&apos;ve already responded to this invitation.
                  </p>
                </div>
              )}

              {!alreadyResponded && (
                <div className="space-y-3">
                  <div>
                    <Label htmlFor="reason" className="text-[11px]">
                      Reason (optional — shown if you decline or mark unavailable)
                    </Label>
                    <Input
                      id="reason"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="e.g. schedule conflict"
                    />
                  </div>

                  {respondError && (
                    <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                      <span>{respondError}</span>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <Button
                      variant="primary"
                      size="md"
                      onClick={() => handleRespond("ACCEPTED")}
                      isLoading={isResponding === "ACCEPTED"}
                      disabled={isResponding !== null}
                      className="bg-emerald-600 hover:bg-emerald-700"
                    >
                      Accept
                    </Button>
                    <Button
                      variant="outline"
                      size="md"
                      onClick={() => handleRespond("DECLINED")}
                      isLoading={isResponding === "DECLINED"}
                      disabled={isResponding !== null}
                      className="text-rose-600 border-rose-200 hover:bg-rose-50"
                    >
                      Decline
                    </Button>
                    <Button
                      variant="outline"
                      size="md"
                      onClick={() => handleRespond("UNAVAILABLE")}
                      isLoading={isResponding === "UNAVAILABLE"}
                      disabled={isResponding !== null}
                      className="text-amber-700 border-amber-200 hover:bg-amber-50"
                    >
                      Unavailable
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </Card>

        {invitation.status !== "EXPIRED" && needsClaim && !claimed && (
          <Card className="p-6 border-slate-200 shadow-enterprise space-y-4">
            <div>
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-workday-blue" />
                Set Up Your Account
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                Set a password so you can sign in later — for example, to submit
                availability or connect your calendar. This is separate from
                responding above.
              </p>
            </div>

            {claimError && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{claimError}</span>
              </div>
            )}

            <form onSubmit={handleClaim} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="password" required className="text-[11px]">
                    Password (min 8 &amp; 1 number)
                  </Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                  />
                </div>
                <div>
                  <Label htmlFor="confirmPassword" required className="text-[11px]">
                    Confirm Password
                  </Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                  />
                </div>
              </div>
              <Button type="submit" variant="workday" size="md" className="w-full" isLoading={isClaiming || authLoading}>
                Set Password
              </Button>
            </form>
          </Card>
        )}

        {invitation.status !== "EXPIRED" && invitation.requires_account_setup && invitation.account_claimed && !claimed && (
          <p className="text-center text-xs text-slate-500">
            This account already has a password.{" "}
            <Link href="/login" className="text-workday-blue font-semibold hover:underline">
              Sign in
            </Link>
            .
          </p>
        )}

        {claimed && (
          <Card className="p-5 border-emerald-200 bg-emerald-50/60 space-y-2">
            <div className="flex items-center gap-2 text-emerald-800 font-bold text-sm">
              <CheckCircle2 className="w-5 h-5" />
              Account set up — you&apos;re signed in
            </div>
            <p className="text-xs text-emerald-700">
              Your password was saved and you&apos;re now logged in on this device.
            </p>
            <Link href={dashboardRouteRef.current}>
              <Button variant="primary" size="sm" className="gap-1.5 mt-1">
                Go to your workspace
                <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            </Link>
          </Card>
        )}
      </div>
    </div>
  );
}

function ResponseBadge({ status }: { status: string }) {
  if (status === "ACCEPTED") {
    return (
      <Badge variant="success">
        <CheckCircle2 className="w-3 h-3" />
        <span>Accepted</span>
      </Badge>
    );
  }
  if (status === "DECLINED") {
    return (
      <Badge variant="danger">
        <XCircle className="w-3 h-3" />
        <span>Declined</span>
      </Badge>
    );
  }
  return (
    <Badge variant="warning">
      <CalendarX2 className="w-3 h-3" />
      <span>Unavailable</span>
    </Badge>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-workday-surface text-center px-6">
      {children}
    </div>
  );
}
