"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Sparkles,
  Calendar,
  ShieldCheck,
  CheckCircle2,
  Clock,
  ArrowRight,
  Globe,
  Video,
  Layers,
  BarChart3,
} from "lucide-react";

export default function HomePage() {
  const router = useRouter();
  const { user, role, isAuthenticated } = useAuth();

  const handleOpenWorkspace = () => {
    if (!isAuthenticated || !role) {
      router.push("/login");
      return;
    }

    if (role === "ADMIN") {
      router.push("/admin");
    } else if (role === "PANELIST") {
      router.push("/panelist");
    } else if (role === "CANDIDATE") {
      router.push("/candidate");
    } else {
      router.push("/login");
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col text-slate-900">
      {/* Top Enterprise Navbar */}
      <header className="h-16 border-b border-slate-200 bg-white/95 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto h-full px-6 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-workday-blue flex items-center justify-center text-white font-bold shadow-xs">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div>
              <span className="text-[10px] font-bold tracking-widest text-slate-500 block uppercase">
                SMART INTERVIEW
              </span>
              <span className="text-sm font-bold text-slate-900 leading-none block">
                SCHEDULER
              </span>
            </div>
          </Link>

     
         <div className="flex items-center gap-3">
            {isAuthenticated ? (
              <Button
                variant="primary"
                size="sm"
                onClick={handleOpenWorkspace}
                className="gap-1.5"
              >
                <span>Go to Workspace</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            ) : (
              <>
                <Link href="/login">
                  <Button variant="outline" size="sm">
                    Sign In
                  </Button>
                </Link>
                <Link href="/register">
                  <Button variant="primary" size="sm">
                    Register
                  </Button>
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="pt-16 pb-20 px-6 max-w-5xl mx-auto text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 border border-blue-200 text-workday-blue text-xs font-semibold mb-6">
          <Sparkles className="w-3.5 h-3.5" />
          <span>Explainable Deterministic Scheduling Architecture</span>
        </div>

        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-slate-900 tracking-tight max-w-4xl mx-auto leading-[1.15]">
          Don&apos;t just schedule an interview.{" "}
          <span className="text-workday-blue underline decoration-sky-300 underline-offset-8">
            Explain why
          </span>{" "}
          this is the best slot.
        </h1>

        <p className="mt-6 text-base sm:text-lg text-slate-600 max-w-2xl mx-auto leading-relaxed">
          Coordinate candidates and interviewers across time zones, calendars, working hours, and scheduling constraints — without the endless back-and-forth. Powered by explainable, 5-factor scoring.
        </p>

        {/* Action CTAs */}
        {isAuthenticated ? (
          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <button
              onClick={handleOpenWorkspace}
              className="inline-flex items-center justify-center font-semibold text-sm px-6 py-3 rounded-md bg-workday-blue text-white hover:bg-workday-blue-hover shadow-xs transition-all duration-150 gap-2"
            >
              <span>Open Workspace</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl mx-auto">
            <div className="p-5 rounded-lg border border-slate-200 bg-white text-left space-y-2">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-workday-blue" />
                Administrator &amp; Interviewer
              </h3>
              <p className="text-xs text-slate-500">
                Sign in with credentials provided by your organization.
              </p>
              <Link href="/login?as=staff" className="block">
                <Button variant="workday" size="sm" className="w-full gap-1.5">
                  <span>Staff sign-in</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Button>
              </Link>
            </div>
            <div className="p-5 rounded-lg border border-slate-200 bg-white text-left space-y-2">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-workday-blue" />
                Candidate
              </h3>
              <p className="text-xs text-slate-500">
                Sign in, or create an account to submit your availability.
              </p>
              <div className="flex gap-2">
                <Link href="/login?as=candidate" className="flex-1">
                  <Button variant="outline" size="sm" className="w-full">
                    Sign in
                  </Button>
                </Link>
                <Link href="/register" className="flex-1">
                  <Button variant="workday" size="sm" className="w-full">
                    Register
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* 5 Deterministic Factors Feature Showcase */}
      <section className="py-16 px-6 bg-white border-y border-slate-200">
        <div className="max-w-6xl mx-auto">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <span className="text-xs font-bold uppercase tracking-wider text-workday-blue">
              The Explainability Engine
            </span>
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 mt-1">
              Deterministic, mathematical scoring
            </h2>
            <p className="text-slate-600 mt-2 text-xs sm:text-sm leading-relaxed">
              No black-box predictions. Every candidate-panelist interview slot is mathematically evaluated and transparently explained across five enterprise criteria:
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <Card className="p-5 border-slate-200 bg-white">
              <div className="w-8 h-8 rounded bg-sky-50 border border-sky-200 text-sky-800 flex items-center justify-center font-bold text-xs mb-3">
                30%
              </div>
              <h3 className="text-xs font-bold text-slate-900">Timezone Fairness</h3>
              <p className="text-[11px] text-slate-500 mt-1 leading-normal">
                Balances daytime comfort evenly between candidate and cross-globe interviewers.
              </p>
            </Card>

            <Card className="p-5 border-slate-200 bg-white">
              <div className="w-8 h-8 rounded bg-indigo-50 border border-indigo-200 text-indigo-800 flex items-center justify-center font-bold text-xs mb-3">
                20%
              </div>
              <h3 className="text-xs font-bold text-slate-900">Working-Hours Comfort</h3>
              <p className="text-[11px] text-slate-500 mt-1 leading-normal">
                Protects local business hours and eliminates unfeasible early mornings or late nights.
              </p>
            </Card>

            <Card className="p-5 border-slate-200 bg-white">
              <div className="w-8 h-8 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 flex items-center justify-center font-bold text-xs mb-3">
                20%
              </div>
              <h3 className="text-xs font-bold text-slate-900">Scheduling Proximity</h3>
              <p className="text-[11px] text-slate-500 mt-1 leading-normal">
                Minimizes hiring pipeline latency by prioritizing earlier viable interview dates.
              </p>
            </Card>

            <Card className="p-5 border-slate-200 bg-white">
              <div className="w-8 h-8 rounded bg-purple-50 border border-purple-200 text-purple-800 flex items-center justify-center font-bold text-xs mb-3">
                15%
              </div>
              <h3 className="text-xs font-bold text-slate-900">Workload Balance</h3>
              <p className="text-[11px] text-slate-500 mt-1 leading-normal">
                Prevents interviewer fatigue and avoids overloading the same senior engineering panelists.
              </p>
            </Card>

            <Card className="p-5 border-slate-200 bg-white">
              <div className="w-8 h-8 rounded bg-amber-50 border border-amber-200 text-amber-800 flex items-center justify-center font-bold text-xs mb-3">
                15%
              </div>
              <h3 className="text-xs font-bold text-slate-900">Buffer Quality</h3>
              <p className="text-[11px] text-slate-500 mt-1 leading-normal">
                Guarantees protected prep and debrief breathing room before and after each session.
              </p>
            </Card>
          </div>
        </div>
      </section>

      {/* Enterprise Architecture Highlights */}
      <section className="py-16 px-6 max-w-5xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="p-5 rounded-lg border border-slate-200 bg-white space-y-2">
            <div className="w-9 h-9 rounded-md bg-slate-100 text-slate-800 flex items-center justify-center">
              <Calendar className="w-4 h-4" />
            </div>
            <h4 className="font-bold text-slate-900 text-sm">Decoupled Google Calendar</h4>
            <p className="text-xs text-slate-600 leading-relaxed">
              Google Identity login uses openid and email scopes only. Calendar free/busy synchronization requires separate explicit authorization.
            </p>
          </div>

          <div className="p-5 rounded-lg border border-slate-200 bg-white space-y-2">
            <div className="w-9 h-9 rounded-md bg-slate-100 text-slate-800 flex items-center justify-center">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <h4 className="font-bold text-slate-900 text-sm">Double-Booking Safe</h4>
            <p className="text-xs text-slate-600 leading-relaxed">
              Pre-commit calendar revalidation and synchronization protect against conflicting schedule updates before booking confirmation.
            </p>
          </div>

          <div className="p-5 rounded-lg border border-slate-200 bg-white space-y-2">
            <div className="w-9 h-9 rounded-md bg-slate-100 text-slate-800 flex items-center justify-center">
              <Video className="w-4 h-4" />
            </div>
            <h4 className="font-bold text-slate-900 text-sm">Google Meet Integration</h4>
            <p className="text-xs text-slate-600 leading-relaxed">
              Automatic video conference generation returns joinable meeting links immediately upon final slot confirmation.
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="mt-auto border-t border-slate-200 bg-white py-6 px-6 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <p>
            Smart Interview Scheduler &copy; {new Date().getFullYear()}. Enterprise Edition.
          </p>
          <div className="flex items-center gap-4 text-xs font-medium text-slate-600">
            <Link href="/login" className="hover:underline">
              Sign In
            </Link>
            <Link href="/register" className="hover:underline">
              Register
            </Link>
            <Link href="/panelist/calendar" className="hover:underline">
              Google Calendar Sync
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
