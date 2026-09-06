"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ShieldCheck, AlertCircle, Globe } from "lucide-react";
import { getSystemTimezone } from "@/lib/utils";

/**
 * First-administrator setup. Convenience wrapper around
 * POST /api/v1/auth/bootstrap-admin — the backend is the source of truth and
 * enforces the shared-secret token and the "zero ADMIN users" guard. This page
 * is only useful on a fresh deployment where bootstrap is configured.
 */
export default function SetupPage() {
  const router = useRouter();
  const { bootstrapAdmin, isLoading } = useAuth();

  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [timezone, setTimezone] = React.useState("UTC");
  const [bootstrapToken, setBootstrapToken] = React.useState("");
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  React.useEffect(() => {
    const detected = getSystemTimezone();
    if (detected) setTimezone(detected);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

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
      await bootstrapAdmin({
        name,
        email,
        password,
        timezone,
        bootstrap_token: bootstrapToken.trim(),
      });
      router.push("/admin");
    } catch (err: any) {
      if (err?.code === "ADMIN_ALREADY_EXISTS" || err?.statusCode === 409) {
        setErrorMsg(
          "An administrator account already exists. Please sign in instead."
        );
      } else if (err?.statusCode === 404) {
        setErrorMsg(
          "First-admin setup is not enabled on this server, or the setup token is incorrect."
        );
      } else {
        setErrorMsg(err?.message || "Setup failed. Please verify your details.");
      }
    }
  };

  return (
    <div className="min-h-screen bg-workday-surface flex flex-col justify-center py-12 sm:px-6 lg:px-8 text-slate-900">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <Link href="/" className="inline-flex items-center gap-2 mb-4">
          <div className="w-8 h-8 rounded-lg bg-workday-blue flex items-center justify-center text-white shadow-sm">
            <ShieldCheck className="w-4 h-4 text-sky-200" />
          </div>
          <span className="text-sm font-bold tracking-tight text-slate-900 uppercase">
            Smart Interview Scheduler
          </span>
        </Link>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">
          Set up the first administrator
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Already set up?{" "}
          <Link href="/login" className="text-workday-blue hover:underline font-semibold">
            Sign in here
          </Link>
        </p>
      </div>

      <div className="mt-6 sm:mx-auto sm:w-full sm:max-w-lg">
        <div className="bg-white py-8 px-6 sm:px-10 shadow-enterprise rounded-xl border border-slate-200">
          <div className="mb-5 rounded-lg border border-sky-200 bg-sky-50/70 p-3 text-xs text-slate-700 flex items-start gap-2">
            <ShieldCheck className="w-4 h-4 text-workday-blue shrink-0 mt-0.5" />
            <span>
              This one-time page creates the first{" "}
              <span className="font-semibold">Administrator</span>. It requires
              the server setup token and is disabled once an administrator
              exists.
            </span>
          </div>

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

            <div>
              <div className="flex items-center justify-between mb-1">
                <Label htmlFor="timezone" required className="mb-0">
                  Timezone (IANA)
                </Label>
                <span className="text-[10px] text-slate-400 flex items-center gap-1">
                  <Globe className="w-3 h-3" /> Auto-detected
                </span>
              </div>
              <Input
                id="timezone"
                type="text"
                placeholder="e.g. America/New_York"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                required
              />
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

            <div>
              <Label htmlFor="bootstrapToken" required>
                Server setup token
              </Label>
              <Input
                id="bootstrapToken"
                type="password"
                placeholder="ADMIN_BOOTSTRAP_TOKEN"
                value={bootstrapToken}
                onChange={(e) => setBootstrapToken(e.target.value)}
                required
              />
              <p className="mt-1 text-[10px] text-slate-400">
                Provided to you by whoever deployed this server.
              </p>
            </div>

            <Button
              type="submit"
              variant="workday"
              size="lg"
              className="w-full mt-2"
              isLoading={isLoading}
            >
              Create Administrator
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
