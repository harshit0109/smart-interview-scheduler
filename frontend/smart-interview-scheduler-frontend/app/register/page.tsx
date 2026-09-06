"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { Role } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sparkles, CheckCircle2, AlertCircle, Globe } from "lucide-react";
import { getSystemTimezone } from "@/lib/utils";

const COMMON_TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "UTC",
];

export default function RegisterPage() {
  const router = useRouter();
  const { register, isLoading } = useAuth();

  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [role, setRole] = React.useState<Role>("ADMIN");
  const [timezone, setTimezone] = React.useState("UTC");
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  React.useEffect(() => {
    const detected = getSystemTimezone();
    if (detected) setTimezone(detected);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    // Validation per prompt Section 6
    if (password.length < 8) {
      setErrorMsg("Password must be at least 8 characters long.");
      return;
    }
    if (!/\d/.test(password)) {
      setErrorMsg("Password must contain at least one number.");
      return;
    }
    if (password !== confirmPassword) {
      setErrorMsg("Passwords do not match.");
      return;
    }

    try {
      await register({
        name,
        email,
        password,
        role,
        timezone,
      });
      if (role === "ADMIN") router.push("/admin");
      else if (role === "PANELIST") router.push("/panelist");
      else router.push("/candidate");
    } catch (err: any) {
      setErrorMsg(err.message || "Registration failed. Please verify your details.");
    }
  };

  return (
    <div className="min-h-screen bg-workday-surface flex flex-col justify-center py-12 sm:px-6 lg:px-8 text-slate-900">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <Link href="/" className="inline-flex items-center gap-2 mb-4">
          <div className="w-8 h-8 rounded-lg bg-workday-blue flex items-center justify-center text-white shadow-sm">
            <Sparkles className="w-4 h-4 text-sky-200" />
          </div>
          <span className="text-sm font-bold tracking-tight text-slate-900 uppercase">
            Smart Interview Scheduler
          </span>
        </Link>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">
          Create enterprise account
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Already registered?{" "}
          <Link href="/login" className="text-workday-blue hover:underline font-semibold">
            Sign in here
          </Link>
        </p>
      </div>

      <div className="mt-6 sm:mx-auto sm:w-full sm:max-w-lg">
        <div className="bg-white py-8 px-6 sm:px-10 shadow-enterprise rounded-xl border border-slate-200">
          {errorMsg && (
            <div className="mb-5 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="name" required>
                Full Name
              </Label>
              <Input
                id="name"
                type="text"
                placeholder="e.g. Alex Morgan"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            <div>
              <Label htmlFor="email" required>
                Email Address
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="name@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            {/* Role Selection with Explanations (Section 10) */}
            <div>
              <Label required>Account Role</Label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mt-1">
                <button
                  type="button"
                  onClick={() => setRole("ADMIN")}
                  className={`p-3 rounded-lg border text-left transition-colors ${
                    role === "ADMIN"
                      ? "border-workday-blue bg-workday-accent/50 text-workday-blue font-semibold"
                      : "border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
                  }`}
                >
                  <p className="text-xs font-bold">Admin</p>
                  <p className="text-[10px] text-slate-500 mt-0.5 leading-tight">
                    Recruiter / Hiring Manager creating requests
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setRole("PANELIST")}
                  className={`p-3 rounded-lg border text-left transition-colors ${
                    role === "PANELIST"
                      ? "border-workday-blue bg-workday-accent/50 text-workday-blue font-semibold"
                      : "border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
                  }`}
                >
                  <p className="text-xs font-bold">Panelist</p>
                  <p className="text-[10px] text-slate-500 mt-0.5 leading-tight">
                    Interviewer connecting Google Calendar
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setRole("CANDIDATE")}
                  className={`p-3 rounded-lg border text-left transition-colors ${
                    role === "CANDIDATE"
                      ? "border-workday-blue bg-workday-accent/50 text-workday-blue font-semibold"
                      : "border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
                  }`}
                >
                  <p className="text-xs font-bold">Candidate</p>
                  <p className="text-[10px] text-slate-500 mt-0.5 leading-tight">
                    Applicant submitting availability
                  </p>
                </button>
              </div>
            </div>

            {/* Timezone Selector with IANA Names (Section 10) */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <Label htmlFor="timezone" required className="mb-0">
                  Timezone (IANA)
                </Label>
                <span className="text-[10px] text-slate-400 flex items-center gap-1">
                  <Globe className="w-3 h-3" /> Auto-detected
                </span>
              </div>
              <select
                id="timezone"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-workday-blue/40"
              >
                {!COMMON_TIMEZONES.includes(timezone) && (
                  <option value={timezone}>{timezone} (Current)</option>
                )}
                {COMMON_TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="password" required>
                  Password (min 8 & 1 number)
                </Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>

              <div>
                <Label htmlFor="confirmPassword" required>
                  Confirm Password
                </Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </div>
            </div>

            <Button
              type="submit"
              variant="workday"
              size="lg"
              className="w-full mt-2"
              isLoading={isLoading}
            >
              Create Account
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
