"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { usersApi, interviewsApi } from "@/lib/api-client";
import { User, RoundType, InterviewRequest } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { CopyButton } from "@/components/shared/CopyButton";
import {
  UserCheck,
  Clock,
  Users,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
  Info,
} from "lucide-react";
import { cn } from "@/lib/utils";

const STEPS = [
  { id: 1, label: "Candidate", icon: UserCheck },
  { id: 2, label: "Interview Details", icon: Clock },
  { id: 3, label: "Panelists", icon: Users },
  { id: 4, label: "Review & Submit", icon: CheckCircle2 },
];

export default function CreateInterviewPage() {
  const router = useRouter();

  const [currentStep, setCurrentStep] = React.useState(1);
  const [candidates, setCandidates] = React.useState<User[]>([]);
  const [panelists, setPanelists] = React.useState<User[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = React.useState(true);

  // Form states
  const [selectedCandidateId, setSelectedCandidateId] = React.useState<string>("");
  const [roundType, setRoundType] = React.useState<RoundType>("TECHNICAL");
  const [durationMinutes, setDurationMinutes] = React.useState<number>(60);
  const [bufferMinutes, setBufferMinutes] = React.useState<number>(15);
  const [selectedPanelistIds, setSelectedPanelistIds] = React.useState<string[]>([]);

  // Submission / Success states
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [createdInterview, setCreatedInterview] = React.useState<InterviewRequest | null>(null);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  React.useEffect(() => {
    const loadData = async () => {
      try {
        const [cands, pans] = await Promise.all([
          usersApi.getCandidates(),
          usersApi.getPanelists(),
        ]);
        setCandidates(cands);
        setPanelists(pans);
        if (cands.length > 0) setSelectedCandidateId(cands[0].id);
        if (pans.length > 0) setSelectedPanelistIds([pans[0].id]);
      } catch (err) {
        console.error("Failed to load candidates/panelists:", err);
      } finally {
        setIsLoadingUsers(false);
      }
    };
    loadData();
  }, []);

  const selectedCandidate = candidates.find((c) => c.id === selectedCandidateId);
  const selectedPanelistsList = panelists.filter((p) =>
    selectedPanelistIds.includes(p.id)
  );

  const togglePanelist = (panelistId: string) => {
    if (selectedPanelistIds.includes(panelistId)) {
      if (selectedPanelistIds.length === 1) {
        setErrorMessage("At least one panelist is mandatory.");
        return;
      }
      setSelectedPanelistIds(selectedPanelistIds.filter((id) => id !== panelistId));
    } else {
      setSelectedPanelistIds([...selectedPanelistIds, panelistId]);
    }
  };

  const handleNextStep = () => {
    setErrorMessage(null);
    if (currentStep === 1 && !selectedCandidateId) {
      setErrorMessage("Please select a candidate.");
      return;
    }
    if (currentStep === 3 && selectedPanelistIds.length === 0) {
      setErrorMessage("Please select at least one panelist.");
      return;
    }
    setCurrentStep((prev) => Math.min(prev + 1, 4));
  };

  const handlePrevStep = () => {
    setErrorMessage(null);
    setCurrentStep((prev) => Math.max(prev - 1, 1));
  };

  const handleCreateInterview = async () => {
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const res = await interviewsApi.create({
        candidate_id: selectedCandidateId,
        round_type: roundType,
        duration_minutes: durationMinutes,
        buffer_minutes: bufferMinutes,
        panelist_ids: selectedPanelistIds,
      });
      setCreatedInterview(res);
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to create interview request.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // If created, render the post-creation link share card (Section 20 & 62)
  if (createdInterview) {
    const candidateLink =
      typeof window !== "undefined"
        ? `${window.location.origin}/candidate/interviews/${createdInterview.id}/availability`
        : `/candidate/interviews/${createdInterview.id}/availability`;

    return (
      <Card className="max-w-2xl mx-auto p-8 text-center space-y-6 shadow-enterprise border-slate-200">
        <div className="w-16 h-16 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
          <CheckCircle2 className="w-10 h-10" />
        </div>

        <div className="space-y-2">
          <span className="text-xs font-bold uppercase tracking-widest text-emerald-700 bg-emerald-100/70 px-3 py-1 rounded-full">
            Request Created
          </span>
          <h2 className="text-2xl font-bold text-slate-900">
            Interview Request #{createdInterview.id}
          </h2>
          <p className="text-sm text-slate-600 max-w-md mx-auto">
            The interview request has been created. Next, share the availability link with{" "}
            <strong>{createdInterview.candidate_name}</strong> to receive their preferred windows.
          </p>
        </div>

        {/* Candidate Link Copy Box (Section 62) */}
        <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 text-left space-y-2">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500 block">
            Candidate Availability Link
          </span>
          <div className="flex items-center gap-2">
            <Input
              readOnly
              value={candidateLink}
              className="font-mono text-xs bg-white select-all text-slate-700"
            />
            <CopyButton textToCopy={candidateLink} size="md" className="shrink-0" />
          </div>
          <p className="text-[11px] text-slate-400">
            Candidates can open this link directly to input their timezone and availability windows.
          </p>
        </div>

        <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link href="/admin/interviews">
            <Button variant="outline" size="md">
              View All Interviews
            </Button>
          </Link>
          <Link href={`/admin/interviews/${createdInterview.id}`}>
            <Button variant="primary" size="md" className="gap-2">
              <span>View Request Details</span>
              <ArrowRight className="w-4 h-4" />
            </Button>
          </Link>
        </div>
      </Card>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <Link href="/admin/interviews">
          <Button variant="ghost" size="sm" className="text-xs -ml-2 mb-2">
            <ArrowLeft className="w-3.5 h-3.5 mr-1" />
            Back to Interviews
          </Button>
        </Link>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          Create Interview Request
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Set up candidate requirements, round specifications, and assign panel interviewers.
        </p>
      </div>

      {/* 4-Step Progress Indicator (Section 16) */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-4">
        {STEPS.map((s) => {
          const Icon = s.icon;
          const isCurrent = currentStep === s.id;
          const isPassed = currentStep > s.id;

          return (
            <div
              key={s.id}
              className="flex items-center gap-2.5 text-xs font-semibold select-none"
            >
              <div
                className={cn(
                  "w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs transition-colors",
                  isCurrent
                    ? "bg-workday-blue text-white shadow-xs"
                    : isPassed
                    ? "bg-emerald-600 text-white"
                    : "bg-slate-100 text-slate-400"
                )}
              >
                {isPassed ? <CheckCircle2 className="w-4 h-4" /> : s.id}
              </div>
              <span
                className={cn(
                  "hidden sm:inline",
                  isCurrent
                    ? "text-workday-navy font-bold"
                    : isPassed
                    ? "text-slate-800"
                    : "text-slate-400"
                )}
              >
                {s.label}
              </span>
            </div>
          );
        })}
      </div>

      {errorMessage && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* STEP 1: CANDIDATE (Section 17) */}
      {currentStep === 1 && (
        <Card className="p-6 border-slate-200 shadow-enterprise space-y-6">
          <div>
            <h3 className="text-lg font-bold text-slate-900">Step 1: Select Candidate</h3>
            <p className="text-xs text-slate-500 mt-1">
              Select the registered candidate for this interview pipeline.
            </p>
          </div>

          <div className="space-y-3">
            <Label required>Candidate</Label>
            <div className="space-y-2">
              {candidates.map((cand) => (
                <div
                  key={cand.id}
                  onClick={() => setSelectedCandidateId(cand.id)}
                  className={cn(
                    "p-4 rounded-lg border cursor-pointer transition-all duration-150 flex items-center justify-between",
                    selectedCandidateId === cand.id
                      ? "border-workday-blue bg-workday-accent/50 shadow-xs"
                      : "border-slate-200 bg-white hover:bg-slate-50"
                  )}
                >
                  <div>
                    <p className="font-semibold text-slate-900 text-sm">{cand.name}</p>
                    <p className="text-xs text-slate-500">{cand.email}</p>
                  </div>
                  <div className="text-right">
                    <span className="text-xs font-mono font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
                      {cand.timezone}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}

      {/* STEP 2: INTERVIEW DETAILS (Section 18) */}
      {currentStep === 2 && (
        <Card className="p-6 border-slate-200 shadow-enterprise space-y-6">
          <div>
            <h3 className="text-lg font-bold text-slate-900">Step 2: Interview Details</h3>
            <p className="text-xs text-slate-500 mt-1">
              Specify round type, total duration, and interviewer breathing buffer.
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <Label required>Round Type</Label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-1">
                {(["SCREENING", "TECHNICAL", "MANAGERIAL", "HR"] as RoundType[]).map(
                  (type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setRoundType(type)}
                      className={cn(
                        "p-3 rounded-lg border text-center font-semibold text-xs transition-colors capitalize",
                        roundType === type
                          ? "border-workday-blue bg-workday-blue text-white shadow-xs"
                          : "border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
                      )}
                    >
                      {type.toLowerCase()}
                    </button>
                  )
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label required>Duration (Minutes)</Label>
                <div className="grid grid-cols-4 gap-2 mt-1">
                  {[30, 45, 60, 90].map((dur) => (
                    <button
                      key={dur}
                      type="button"
                      onClick={() => setDurationMinutes(dur)}
                      className={cn(
                        "py-2 rounded-md border text-xs font-semibold transition-colors",
                        durationMinutes === dur
                          ? "border-workday-blue bg-workday-accent text-workday-blue"
                          : "border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
                      )}
                    >
                      {dur}m
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <Label required>Buffer Before/After (Minutes)</Label>
                <Input
                  type="number"
                  min={0}
                  max={60}
                  value={bufferMinutes}
                  onChange={(e) => setBufferMinutes(Number(e.target.value))}
                  className="mt-1"
                />
              </div>
            </div>

            {/* Buffer Explanation Notice (Section 18) */}
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-xs text-slate-600 flex items-start gap-2.5">
              <Info className="w-4 h-4 text-workday-blue shrink-0 mt-0.5" />
              <p>
                Buffer time gives interviewers breathing room before and after the interview and directly influences recommendation quality in the 5-factor scoring model.
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* STEP 3: PANELISTS (Section 19) */}
      {currentStep === 3 && (
        <Card className="p-6 border-slate-200 shadow-enterprise space-y-6">
          <div>
            <h3 className="text-lg font-bold text-slate-900">Step 3: Assign Panelists</h3>
            <p className="text-xs text-slate-500 mt-1">
              Select one or more interviewers. At least one panelist is mandatory.
            </p>
          </div>

          <div className="space-y-3">
            <Label required>Panelists ({selectedPanelistIds.length} Selected)</Label>
            <div className="space-y-2.5">
              {panelists.map((pan) => {
                const isSelected = selectedPanelistIds.includes(pan.id);

                return (
                  <div
                    key={pan.id}
                    onClick={() => togglePanelist(pan.id)}
                    className={cn(
                      "p-4 rounded-lg border cursor-pointer transition-all duration-150 flex flex-col sm:flex-row sm:items-center justify-between gap-3",
                      isSelected
                        ? "border-workday-blue bg-workday-accent/40 shadow-xs"
                        : "border-slate-200 bg-white hover:bg-slate-50"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {}}
                        className="rounded text-workday-blue focus:ring-workday-blue h-4 w-4 pointer-events-none"
                      />
                      <div>
                        <p className="font-semibold text-slate-900 text-sm">{pan.name}</p>
                        <p className="text-xs text-slate-500">{pan.email} ({pan.timezone})</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-xs text-slate-600 flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
              <p>
                Each selected panelist must connect their Google Calendar before
                recommendations can run. If any calendar is not connected, the
                scheduling step will fail and name the panelist.
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* STEP 4: REVIEW & SUBMIT (Section 20) */}
      {currentStep === 4 && (
        <Card className="p-6 border-slate-200 shadow-enterprise space-y-6">
          <div>
            <h3 className="text-lg font-bold text-slate-900">Step 4: Review & Create Request</h3>
            <p className="text-xs text-slate-500 mt-1">
              Verify the interview parameters before creating the request.
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-5 space-y-4 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <span className="text-slate-500 font-semibold uppercase tracking-wider block text-[11px]">
                  Candidate
                </span>
                <p className="text-slate-900 font-bold text-sm mt-0.5">
                  {selectedCandidate?.name}
                </p>
                <p className="text-slate-500">
                  {selectedCandidate?.email} ({selectedCandidate?.timezone})
                </p>
              </div>

              <div>
                <span className="text-slate-500 font-semibold uppercase tracking-wider block text-[11px]">
                  Round Details
                </span>
                <p className="text-slate-900 font-bold text-sm capitalize mt-0.5">
                  {roundType.toLowerCase()} Interview
                </p>
                <p className="text-slate-500">
                  Duration: {durationMinutes} mins • Buffer: {bufferMinutes} mins
                </p>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-200">
              <span className="text-slate-500 font-semibold uppercase tracking-wider block text-[11px] mb-1">
                Assigned Interview Panel ({selectedPanelistsList.length})
              </span>
              <div className="flex flex-wrap gap-2">
                {selectedPanelistsList.map((p) => (
                  <span
                    key={p.id}
                    className="bg-white border border-slate-200 text-slate-800 px-3 py-1 rounded-md font-medium"
                  >
                    {p.name} ({p.timezone})
                  </span>
                ))}
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Stepper Navigation Buttons */}
      <div className="flex items-center justify-between pt-2">
        {currentStep > 1 ? (
          <Button variant="outline" size="md" onClick={handlePrevStep} disabled={isSubmitting}>
            <ArrowLeft className="w-4 h-4 mr-1.5" />
            Previous
          </Button>
        ) : (
          <div />
        )}

        {currentStep < 4 ? (
          <Button variant="primary" size="md" onClick={handleNextStep}>
            Continue
            <ArrowRight className="w-4 h-4 ml-1.5" />
          </Button>
        ) : (
          <Button
            variant="workday"
            size="lg"
            onClick={handleCreateInterview}
            isLoading={isSubmitting}
            className="px-6 shadow-sm"
          >
            Create Interview Request
          </Button>
        )}
      </div>
    </div>
  );
}
