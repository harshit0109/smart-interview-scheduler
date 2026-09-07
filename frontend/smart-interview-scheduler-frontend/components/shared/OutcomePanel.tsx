"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { interviewsApi, usersApi, ApiClientError } from "@/lib/api-client";
import { InterviewRequest, InterviewOutcome, RoundType, User } from "@/lib/types";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertCircle, Trophy, XOctagon, UserX, ArrowRight, Archive } from "lucide-react";

const OUTCOMES: { key: InterviewOutcome; label: string; icon: React.ComponentType<{ className?: string }>; blurb: string }[] = [
  { key: "PASSED", label: "Passed — advance", icon: Trophy, blurb: "Candidate qualified for the next round." },
  { key: "REJECTED", label: "Rejected", icon: XOctagon, blurb: "Candidate did not qualify. History is kept." },
  { key: "NO_SHOW", label: "No-show", icon: UserX, blurb: "A required participant didn't join within the grace window." },
];

const ROUND_TYPES: RoundType[] = ["SCREENING", "TECHNICAL", "MANAGERIAL", "HR"];

/**
 * ADMIN-only surface for what happens *after* a booked interview:
 * record an outcome, spin up the next round for a PASSED candidate, and
 * archive a candidate who's leaving the pipeline. Renders nothing for
 * statuses where none of that applies.
 */
export function OutcomePanel({
  interview,
  onDone,
}: {
  interview: InterviewRequest;
  onDone: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pickedOutcome, setPickedOutcome] = React.useState<InterviewOutcome | null>(null);
  const [notes, setNotes] = React.useState("");

  // next-round form
  const [showNextRound, setShowNextRound] = React.useState(false);
  const [nrRound, setNrRound] = React.useState<RoundType>("MANAGERIAL");
  const [nrDuration, setNrDuration] = React.useState(45);
  const [panelists, setPanelists] = React.useState<User[]>([]);
  const [nrPanel, setNrPanel] = React.useState<string[]>([]);

  const isBooked = interview.status === "BOOKED";
  const isCompleted = interview.status === "COMPLETED";
  const passed = isCompleted && interview.outcome === "PASSED";

  React.useEffect(() => {
    if (showNextRound && panelists.length === 0) {
      usersApi.getPanelists().then(setPanelists).catch(() => setPanelists([]));
    }
  }, [showNextRound, panelists.length]);

  if (!isBooked && !isCompleted) return null;

  const recordOutcome = async () => {
    if (!pickedOutcome) return;
    setBusy("outcome");
    setError(null);
    try {
      await interviewsApi.recordOutcome(interview.id, {
        outcome: pickedOutcome,
        notes: notes.trim() || undefined,
      });
      setPickedOutcome(null);
      setNotes("");
      onDone();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not record the outcome.");
    } finally {
      setBusy(null);
    }
  };

  const createNextRound = async () => {
    if (nrPanel.length === 0) {
      setError("Pick at least one interviewer for the next round.");
      return;
    }
    setBusy("nextRound");
    setError(null);
    try {
      const child = await interviewsApi.nextRound(interview.id, {
        round_type: nrRound,
        duration_minutes: nrDuration,
        panelist_ids: nrPanel,
      });
      router.push(`/admin/interviews/${child.id}`);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not create the next round.");
    } finally {
      setBusy(null);
    }
  };

  const archiveCandidate = async () => {
    setBusy("archive");
    setError(null);
    try {
      await usersApi.archive(interview.candidate_id);
      onDone();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not archive the candidate.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="border-slate-200 shadow-xs">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Outcome &amp; next steps</CardTitle>
        <CardDescription className="text-xs">
          {isCompleted
            ? `Recorded outcome: ${interview.outcome ?? "—"}`
            : "Record how this round went once the interview has happened."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Record / re-record an outcome */}
        {(isBooked || isCompleted) && (
          <div className="space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {OUTCOMES.map((o) => {
                const Icon = o.icon;
                const active = pickedOutcome === o.key;
                return (
                  <button
                    key={o.key}
                    type="button"
                    onClick={() => setPickedOutcome(active ? null : o.key)}
                    className={
                      "rounded-lg border px-3 py-2 text-xs font-semibold flex items-center gap-2 " +
                      (active
                        ? "border-workday-blue bg-workday-blue/5 text-slate-900"
                        : "border-slate-200 text-slate-600 hover:bg-slate-50")
                    }
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    {o.label}
                  </button>
                );
              })}
            </div>
            {pickedOutcome && (
              <div className="space-y-2 rounded-lg border border-slate-100 bg-slate-50/60 p-3">
                <p className="text-[11px] text-slate-500">
                  {OUTCOMES.find((o) => o.key === pickedOutcome)?.blurb}
                </p>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  maxLength={2000}
                  placeholder="Notes (optional) — kept on the interview record"
                  className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-workday-blue/40"
                />
                <Button variant="primary" size="sm" isLoading={busy === "outcome"} onClick={recordOutcome}>
                  Save outcome
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Next round — only for a PASSED, completed round */}
        {passed && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 space-y-2">
            <button
              type="button"
              onClick={() => setShowNextRound((v) => !v)}
              className="w-full flex items-center gap-2 text-xs font-semibold text-emerald-900"
            >
              <ArrowRight className="w-4 h-4" />
              Schedule round {(interview.round_number ?? 1) + 1}
            </button>
            {showNextRound && (
              <div className="space-y-3 pt-1">
                <div>
                  <p className="text-[11px] font-semibold text-slate-500 mb-1">Round type</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                    {ROUND_TYPES.map((rt) => (
                      <button
                        key={rt}
                        type="button"
                        onClick={() => setNrRound(rt)}
                        className={
                          "rounded-md border px-2 py-1.5 text-[11px] font-semibold " +
                          (nrRound === rt
                            ? "border-workday-blue bg-white text-slate-900"
                            : "border-slate-200 text-slate-500 hover:bg-white")
                        }
                      >
                        {rt}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="w-32">
                  <p className="text-[11px] font-semibold text-slate-500 mb-1">Duration (min)</p>
                  <Input
                    type="number"
                    min={15}
                    step={15}
                    value={nrDuration}
                    onChange={(e) => setNrDuration(Number(e.target.value) || 45)}
                  />
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-slate-500 mb-1">Interviewers</p>
                  {panelists.length === 0 ? (
                    <p className="text-[11px] text-slate-400">No interviewers available yet.</p>
                  ) : (
                    <div className="space-y-1 max-h-40 overflow-y-auto">
                      {panelists.map((p) => (
                        <label key={p.id} className="flex items-center gap-2 text-xs text-slate-700">
                          <input
                            type="checkbox"
                            checked={nrPanel.includes(p.id)}
                            onChange={(e) =>
                              setNrPanel((cur) =>
                                e.target.checked
                                  ? [...cur, p.id]
                                  : cur.filter((x) => x !== p.id)
                              )
                            }
                          />
                          <span>{p.name}</span>
                          <span className="text-slate-400">{p.email}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  isLoading={busy === "nextRound"}
                  onClick={createNextRound}
                  className="bg-emerald-700 hover:bg-emerald-800"
                >
                  Create next round
                </Button>
                <p className="text-[10px] text-slate-500">
                  Company &amp; role carry forward automatically. The new round starts by
                  asking {interview.candidate_name} for fresh availability.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Archive candidate */}
        {isCompleted && (
          <div className="rounded-lg border border-slate-200">
            <button
              type="button"
              onClick={archiveCandidate}
              disabled={busy === "archive"}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 rounded-lg disabled:opacity-50"
            >
              <Archive className="w-4 h-4 text-slate-500" />
              Remove {interview.candidate_name} from the pipeline (reversible)
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
