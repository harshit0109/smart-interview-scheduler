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
  const { login, googleLogin, isLoading, isAuthenticated, role } = useAuth();

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

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

  const handleGoogleLogin = async () => {
    setErrorMsg(null);
    try {
      // Scopes: openid, email, profile ONLY. Calendar scope is never requested here.
      const user = await googleLogin("mock_google_id_token_jwt");
      if (redirectTarget) {
        router.replace(redirectTarget);
      } else if (user.role === "ADMIN") {
        router.replace("/admin");
      } else if (user.role === "PANELIST") {
        router.replace("/panelist");
      } else {
        router.replace("/candidate");
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Google sign-in could not be completed.");
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

          {/* Divider */}
          <div className="relative my-4">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-slate-50 px-3 text-slate-400 font-medium">
                Or Continue With
              </span>
            </div>
          </div>

          {/* Google Identity Button (Identity ONLY, no calendar scopes) */}
          <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-3 px-4 py-2.5 rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold transition-all duration-150 shadow-xs focus:outline-none focus:ring-2 focus:ring-slate-300 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
              />
            </svg>
            <span>Continue with Google</span>
          </button>

          <p className="text-[11px] text-slate-500 text-center leading-tight">
            Google Sign-in authenticates your identity only. Google Calendar integration is authorized separately under participant settings.
          </p>

          <div className="pt-2 text-center text-xs text-slate-500">
            Don&apos;t have an account?{" "}
            <Link
              href="/register"
              className="text-workday-blue font-semibold hover:underline"
            >
              Create enterprise account
            </Link>
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
