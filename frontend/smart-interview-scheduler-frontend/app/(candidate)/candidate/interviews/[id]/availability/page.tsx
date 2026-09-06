"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { interviewsApi, availabilityApi } from "@/lib/api-client";
import { InterviewRequest } from "@/lib/types";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { getSystemTimezone, getShortTz, zonedWallTimeToISO } from "@/lib/utils";
import {
  Calendar,
  Clock,
  Plus,
  Trash2,
  Globe,
  CheckCircle2,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Info,
} from "lucide-react";

interface WindowRow {
  id: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  error?: string;
}

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

export default function CandidateAvailabilityPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const interviewId = params.id as string;

  const [interview, setInterview] = React.useState<InterviewRequest | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [submissionSuccess, setSubmissionSuccess] = React.useState(false);
  const [globalError, setGlobalError] = React.useState<string | null>(null);

  // Timezone state for this submission (defaults to detected or user timezone)
  const [timezone, setTimezone] = React.useState<string>("Asia/Kolkata");

  // Availability windows (1 to 10 rows)
  const [windows, setWindows] = React.useState<WindowRow[]>([]);

  React.useEffect(() => {
    const load = async () => {
      try {
        const data = await interviewsApi.getById(interviewId);
        setInterview(data);

        // Pre-fill timezone from candidate or browser
        const candidateTz = data.candidate_timezone || getSystemTimezone();
        setTimezone(candidateTz);

        // Pre-populate 2 default tomorrow slots
        const tomorrow = new Date(Date.now() + 86400000);
        const dayAfter = new Date(Date.now() + 86400000 * 2);
        const tomorrowStr = tomorrow.toISOString().split("T")[0];
        const dayAfterStr = dayAfter.toISOString().split("T")[0];

        setWindows([
          {
            id: "win-1",
            date: tomorrowStr,
            startTime: "09:00",
            endTime: "12:00",
          },
          {
            id: "win-2",
            date: dayAfterStr,
            startTime: "14:00",
            endTime: "17:00",
          },
        ]);
      } catch (err: any) {
        setGlobalError(err.message || "Could not load interview invitation details.");
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [interviewId]);

  const handleAddWindow = () => {
    if (windows.length >= 10) return;
    const nextDate = new Date(Date.now() + 86400000 * (windows.length + 1))
      .toISOString()
      .split("T")[0];

    setWindows([
      ...windows,
      {
        id: `win-${Date.now()}`,
        date: nextDate,
        startTime: "10:00",
        endTime: "13:00",
      },
    ]);
  };

  const handleRemoveWindow = (index: number) => {
    if (windows.length <= 1) {
      setGlobalError("Please provide at least one availability window.");
      return;
    }
    const updated = [...windows];
    updated.splice(index, 1);
    setWindows(updated);
  };

  const handleWindowChange = (
    index: number,
    field: "date" | "startTime" | "endTime",
    value: string
  ) => {
    const updated = [...windows];
    updated[index] = { ...updated[index], [field]: value, error: undefined };
    setWindows(updated);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setGlobalError(null);

    if (windows.length === 0) {
      setGlobalError("Please provide at least one availability window.");
      return;
    }

    if (windows.length > 10) {
      setGlobalError("Maximum 10 availability windows allowed.");
      return;
    }

    // Validate each window: end > start, future date
    const validatedWindows: { start_time: string; end_time: string }[] = [];
    let hasValidationError = false;
    const newWindows = [...windows];

    for (let i = 0; i < newWindows.length; i++) {
      const row = newWindows[i];
      if (!row.date || !row.startTime || !row.endTime) {
        row.error = "All date and time fields are required.";
        hasValidationError = true;
        continue;
      }

      // Anchor the typed wall-clock times to the selected timezone, then send
      // offset-aware UTC ISO8601 (what the backend validates and stores).
      const startIso = zonedWallTimeToISO(row.date, row.startTime, timezone);
      const endIso = zonedWallTimeToISO(row.date, row.endTime, timezone);

      if (new Date(endIso) <= new Date(startIso)) {
        row.error = "End time must be later than start time.";
        hasValidationError = true;
        continue;
      }

      validatedWindows.push({
        start_time: startIso,
        end_time: endIso,
      });
    }

    setWindows(newWindows);
    if (hasValidationError) {
      setGlobalError("Please correct the errors on the highlighted availability windows.");
      return;
    }

    setIsSubmitting(true);
    try {
      await availabilityApi.submit(interviewId, {
        timezone,
        windows: validatedWindows,
      });
      setSubmissionSuccess(true);
    } catch (err: any) {
      if (err.statusCode === 409) {
        setGlobalError("This interview isn't currently waiting for availability.");
      } else if (err.statusCode === 403) {
        setGlobalError("You are not authorized to submit availability for this request.");
      } else {
        setGlobalError(err.message || "Failed to submit availability. Please try again.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="py-16 text-center text-xs text-slate-500">
        Loading interview availability request...
      </div>
    );
  }

  if (submissionSuccess) {
    return (
      <Card className="max-w-xl mx-auto p-8 text-center space-y-6 shadow-enterprise border-slate-200">
        <div className="w-16 h-16 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
          <CheckCircle2 className="w-10 h-10" />
        </div>

        <div className="space-y-2">
          <h2 className="text-2xl font-bold text-slate-900">
            Availability Submitted Successfully
          </h2>
          <p className="text-sm text-slate-600 leading-relaxed max-w-md mx-auto">
            Thanks! We&apos;ve received your availability windows. Our explainability engine will now intersect your preferences with panelist calendars to find optimal interview slots.
          </p>
        </div>

        <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700 text-left space-y-1.5">
          <p className="font-semibold text-slate-900">Submission Summary:</p>
          <p>• Timezone: <span className="font-medium">{timezone} ({getShortTz(timezone)})</span></p>
          <p>• Available Windows: <span className="font-medium">{windows.length} intervals provided</span></p>
        </div>

        <div className="pt-2 flex justify-center gap-3">
          <Link href="/candidate">
            <Button variant="outline" size="md">
              Back to Candidate Portal
            </Button>
          </Link>
          <Link href={`/candidate/interviews/${interviewId}/recommendations`}>
            <Button variant="primary" size="md" className="gap-1.5">
              <span>View Recommended Times</span>
              <ArrowRight className="w-4 h-4" />
            </Button>
          </Link>
        </div>
      </Card>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      {/* Top Breadcrumb */}
      <div>
        <Link href="/candidate">
          <Button variant="ghost" size="sm" className="text-xs -ml-2 mb-2">
            <ArrowLeft className="w-3.5 h-3.5 mr-1" />
            Back to Invitations
          </Button>
        </Link>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          You&apos;re scheduling your interview
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Please tell us when you&apos;re available. We&apos;ll compare your availability with the interview panel&apos;s calendars to find the best possible interview slot.
        </p>
      </div>

      {/* Interview Details Banner */}
      {interview && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-workday-blue">
              {interview.round_type} Round
            </span>
            <h3 className="text-lg font-bold text-slate-900 mt-0.5">
              Technical Interview ({interview.duration_minutes} minutes)
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Panelists: {interview.panelists.map((p) => p.name).join(", ")}
            </p>
          </div>

          {/* Prominent Candidate Timezone (Section 25) */}
          <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-left sm:text-right shrink-0">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
              Your Submission Timezone
            </span>
            <div className="flex items-center sm:justify-end gap-1.5 mt-0.5 font-semibold text-slate-900 text-sm">
              <Globe className="w-4 h-4 text-workday-blue" />
              <span>{timezone}</span>
              <span className="text-xs text-slate-500">({getShortTz(timezone)})</span>
            </div>
          </div>
        </div>
      )}

      {globalError && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800 flex items-center gap-2.5">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{globalError}</span>
        </div>
      )}

      {/* Main Submission Form */}
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Timezone Override Control (Section 25) */}
        <Card className="p-5 border-slate-200 bg-white shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <Label htmlFor="tz-select" className="text-xs font-bold uppercase tracking-wider">
                Select Your Active Timezone
              </Label>
              <p className="text-xs text-slate-500">
                All availability times below will be interpreted in this timezone.
              </p>
            </div>
            <select
              id="tz-select"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-workday-blue/40 max-w-xs"
            >
              {!COMMON_TIMEZONES.includes(timezone) && (
                <option value={timezone}>{timezone} (Detected)</option>
              )}
              {COMMON_TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </div>
        </Card>

        {/* Availability Windows Card (Sections 26 & 27) */}
        <Card className="border-slate-200 shadow-enterprise overflow-hidden">
          <CardHeader className="bg-slate-50/70 border-b border-slate-200/80 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Availability Windows</CardTitle>
                <CardDescription className="text-xs mt-0.5">
                  Add 1 to 10 time intervals when you are free to interview.
                </CardDescription>
              </div>
              <span className="text-xs font-mono font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                {windows.length} / 10 added
              </span>
            </div>
          </CardHeader>

          <CardContent className="p-6 space-y-4">
            {windows.map((w, idx) => (
              <div
                key={w.id}
                className="p-4 rounded-lg border border-slate-200 bg-slate-50/40 hover:bg-slate-50 transition-colors space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Window #{idx + 1}
                  </span>
                  {windows.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveWindow(idx)}
                      className="text-xs text-rose-600 hover:text-rose-800 flex items-center gap-1"
                      aria-label="Remove time window"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Remove</span>
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <Label className="text-[11px]">Date</Label>
                    <Input
                      type="date"
                      value={w.date}
                      onChange={(e) =>
                        handleWindowChange(idx, "date", e.target.value)
                      }
                      required
                    />
                  </div>

                  <div>
                    <Label className="text-[11px]">Start Time</Label>
                    <Input
                      type="time"
                      value={w.startTime}
                      onChange={(e) =>
                        handleWindowChange(idx, "startTime", e.target.value)
                      }
                      required
                    />
                  </div>

                  <div>
                    <Label className="text-[11px]">End Time</Label>
                    <Input
                      type="time"
                      value={w.endTime}
                      onChange={(e) =>
                        handleWindowChange(idx, "endTime", e.target.value)
                      }
                      required
                    />
                  </div>
                </div>

                {w.error && (
                  <p className="text-xs text-red-600 font-medium pt-1">
                    {w.error}
                  </p>
                )}
              </div>
            ))}

            {windows.length < 10 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddWindow}
                className="w-full border-dashed border-slate-300 hover:border-workday-blue text-slate-700 hover:text-workday-blue py-2.5"
              >
                <Plus className="w-4 h-4 mr-1.5" />
                <span>+ Add another time window</span>
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Action Controls */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <Link href="/candidate">
            <Button type="button" variant="outline" disabled={isSubmitting}>
              Cancel
            </Button>
          </Link>

          <Button
            type="submit"
            variant="primary"
            size="lg"
            isLoading={isSubmitting}
            className="px-6 font-semibold"
          >
            {isSubmitting ? "Checking your availability..." : "Submit Availability Windows"}
          </Button>
        </div>
      </form>
    </div>
  );
}
