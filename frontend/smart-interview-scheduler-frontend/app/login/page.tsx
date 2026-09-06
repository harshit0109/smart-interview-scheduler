"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sparkles, CheckCircle2, AlertCircle, Info } from "lucide-react";

const IS_DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login, isLoading, isAuthenticated, role } = useAuth();

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  // Cosmetic only — the backend decides the real role from the account. This
  // just tailors the copy/links for the two audiences. Home page deep-links
  // here with ?as=staff / ?as=candidate.
  const [audience, setAudience] = React.useState<"staff" | "candidate">(
    searchParams.get("as") === "candidate" ? "candidate" : "staff"
  );

  const isExpired = searchParams.get("expired") === "1";
  const redirectTarget = searchParams.get("redirect");

  // Redirect if already authenticated
  React.useEffect(() => {
    if (isAuthenticated && role) {
      if (redirectTarget) {
        router.replace(redirectTarget);
      } else if (role === "ADMIN") {
        router.replace("/admin");
      } else if (role === "PANELIST") {
        router.replace("/panelist");
      } else if (role === "CANDIDATE") {
        router.replace("/candidate");
      }
    }
  }, [isAuthenticated, role, redirectTarget, router]);

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    try {
      const user = await login(email, password);
      if (redirectTarget) {
        router.replace(redirectTarget);
      } else if (user.role === "ADMIN") {
        router.replace("/admin");
      } else if (user.role === "PANELIST") {
        router.replace("/panelist");
      } else if (user.role === "CANDIDATE") {
        router.replace("/candidate");
      } else {
        router.replace("/");
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Invalid corporate credentials. Please verify your email and password.");
    }
  };

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-white text-slate-900">
      {/* Left Column: Brand & Product Value (Workday Enterprise inspired) */}
      <div className="w-full md:w-1/2 bg-slate-900 text-white p-8 md:p-16 flex flex-col justify-between relative overflow-hidden">
        <div>
          <Link href="/" className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-workday-blue flex items-center justify-center text-white shadow-xs">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <span className="text-[10px] font-bold tracking-widest text-slate-400 block uppercase">
                SMART INTERVIEW
              </span>
              <span className="text-base font-bold tracking-tight text-white leading-tight block">
                SCHEDULER
              </span>
            </div>
          </Link>

          <div className="mt-16 md:mt-24 max-w-lg">
            <span className="text-xs font-bold uppercase tracking-widest text-blue-300 bg-slate-800 px-3 py-1 rounded-full">
              Enterprise Hiring Platform
            </span>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight mt-4 leading-tight">
              Find the best time. <br />
              <span className="text-blue-400">Know why.</span>
            </h1>
            <p className="mt-6 text-slate-300 text-sm sm:text-base leading-relaxed">
              Coordinate candidates and interviewers across time zones, calendars, working hours, and scheduling constraints — without the endless back-and-forth.
            </p>
          </div>
        </div>

        {/* Value pillars */}
        <div className="mt-12 pt-8 border-t border-slate-800 space-y-3 text-xs text-slate-300">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>5-Factor Deterministic Scoring (Timezone, Comfort, Velocity, Workload, Buffers)</span>
          </div>
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>Decoupled Google Calendar OAuth with double-booking prevention</span>
          </div>
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>Automated Google Meet conferencing links generated on confirmation</span>
          </div>
        </div>
      </div>

      {/* Right Column: Workday-style Login Card */}
      <div className="w-full md:w-1/2 flex items-center justify-center p-6 sm:p-12 lg:p-16 bg-slate-50">
        <div className="w-full max-w-md space-y-6">
          <div className="text-left">
            <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
              Sign In to Your Workspace
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Enter your corporate credentials to access your interview dashboard.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setAudience("staff")}
              className={
                audience === "staff"
                  ? "rounded-md bg-white py-2 text-slate-900 shadow-xs"
                  : "rounded-md py-2 text-slate-500 hover:text-slate-700"
              }
            >
              Administrator / Interviewer
            </button>
            <button
              type="button"
              onClick={() => setAudience("candidate")}
              className={
                audience === "candidate"
                  ? "rounded-md bg-white py-2 text-slate-900 shadow-xs"
                  : "rounded-md py-2 text-slate-500 hover:text-slate-700"
              }
            >
              Candidate
            </button>
          </div>

          {isExpired && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>Your session has expired. Please sign in again.</span>
            </div>
          )}

          {errorMsg && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <form onSubmit={handlePasswordLogin} className="space-y-4">
            <div>
              <Label htmlFor="email" required>
                Email Address
              </Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
                required
                disabled={isLoading}
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <Label htmlFor="password" required className="mb-0">
                  Password
                </Label>
              </div>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                disabled={isLoading}
              />
            </div>

            <Button
              type="submit"
              variant="workday"
              size="lg"
              className="w-full"
              isLoading={isLoading}
            >
              Sign In
            </Button>
          </form>

          <div className="pt-2 text-center text-xs text-slate-500 space-y-1">
            {audience === "candidate" ? (
              <p>
                New candidate?{" "}
                <Link
                  href="/register"
                  className="text-workday-blue font-semibold hover:underline"
                >
                  Create a candidate account
                </Link>
              </p>
            ) : (
              <p className="text-slate-400">
                Administrators and panelists sign in with credentials provided by their organization.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <React.Suspense fallback={<div className="min-h-screen bg-slate-50" />}>
      <LoginForm />
    </React.Suspense>
  );
}
