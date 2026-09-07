"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { usersApi, interviewsApi, ApiClientError } from "@/lib/api-client";
import { User, ProvisionedUser, RoundType, InterviewRequest } from "@/lib/types";
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
  UserPlus,
  X,
  Search,
  Sparkles,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getSystemTimezone } from "@/lib/utils";

const STEPS = [
  { id: 1, label: "Interview Details", icon: Clock },
  { id: 2, label: "Candidate", icon: UserCheck },
  { id: 3, label: "Panelists", icon: Users },
  { id: 4, label: "Review & Create", icon: CheckCircle2 },
];

const COMMON_TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
];

/* =========================================================
   Inline "provision a new user" form — shared by the
   Candidate and Panelist steps. Always calls POST /users
   with a fixed role; ADMIN is never selectable here.
========================================================= */
function ProvisionInlineForm({
  role,
  onProvisioned,
  onCancel,
}: {
  role: "CANDIDATE" | "PANELIST";
  onProvisioned: (user: ProvisionedUser) => void;
  onCancel: () => void;
}) {
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [timezone, setTimezone] = React.useState(getSystemTimezone() || "UTC");
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);
    if (!name.trim() || !email.trim()) {
      setError("Name and email are required.");
      return;
    }
    setIsSubmitting(true);
    try {
      const user = await usersApi.provision({ name: name.trim(), email: email.trim(), role, timezone });
      onProvisioned(user);
    } catch (err: any) {
      if (err instanceof ApiClientError && err.code === "ROLE_CONFLICT") {
        setError(
          `${email} is already registered as a different role. Provisioning must match the existing account's role.`
        );
      } else {
        setError(err.message || "Failed to provision this account. Please try again.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="p-4 rounded-lg border border-workday-blue/30 bg-workday-accent/20 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-workday-navy flex items-center gap-1.5">
          <UserPlus className="w-3.5 h-3.5" />
          Add a new {role === "CANDIDATE" ? "candidate" : "panelist"}
        </span>
        <button
          type="button"
          onClick={onCancel}
          className="text-slate-400 hover:text-slate-600"
          aria-label="Cancel"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-2.5 text-[11px] text-rose-800 flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label htmlFor={`new-${role}-name`} required className="text-[11px]">
            Full Name
          </Label>
          <Input
            id={`new-${role}-name`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Jordan Lee"
          />
        </div>
        <div>
          <Label htmlFor={`new-${role}-email`} required className="text-[11px]">
            Email
          </Label>
          <Input
            id={`new-${role}-email`}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@company.com"
          />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor={`new-${role}-tz`} className="text-[11px]">
            Timezone
          </Label>
          <select
            id={`new-${role}-tz`}
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-workday-blue/40"
          >
            {!COMMON_TIMEZONES.includes(timezone) && (
              <option value={timezone}>{timezone}</option>
            )}
            {COMMON_TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </div>
      </div>

      <Button
        type="button"
        variant="primary"
        size="sm"
        onClick={handleSubmit}
        isLoading={isSubmitting}
        className="gap-1.5"
      >
        <UserPlus className="w-3.5 h-3.5" />
        Provision & Select
      </Button>
    </div>
  );
}

export default function CreateInterviewPage() {
  const router = useRouter();

  const [currentStep, setCurrentStep] = React.useState(1);
  const [candidates, setCandidates] = React.useState<User[]>([]);
  const [panelists, setPanelists] = React.useState<User[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = React.useState(true);
  const [loadUsersError, setLoadUsersError] = React.useState<string | null>(null);

  // Interview details
  const [title, setTitle] = React.useState("");
  const [company, setCompany] = React.useState("");
  const [roundType, setRoundType] = React.useState<RoundType>("TECHNICAL");
  const [durationMinutes, setDurationMinutes] = React.useState<number>(60);
  const [bufferMinutes, setBufferMinutes] = React.useState<number>(15);

  // Candidate selection
  const [selectedCandidateId, setSelectedCandidateId] = React.useState<string>("");
  const [candidateSearch, setCandidateSearch] = React.useState("");
  const [showNewCandidateForm, setShowNewCandidateForm] = React.useState(false);
  const [newlyProvisionedIds, setNewlyProvisionedIds] = React.useState<Set<string>>(new Set());

  // Panelist selection
  const [selectedPanelistIds, setSelectedPanelistIds] = React.useState<string[]>([]);
  const [panelistSearch, setPanelistSearch] = React.useState("");
  const [showNewPanelistForm, setShowNewPanelistForm] = React.useState(false);

  // Submission / Success states
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [createdInterview, setCreatedInterview] = React.useState<InterviewRequest | null>(null);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  const loadData = React.useCallback(async () => {
    setIsLoadingUsers(true);
    setLoadUsersError(null);
    try {
      const [cands, pans] = await Promise.all([
        usersApi.getCandidates(),
        usersApi.getPanelists(),
      ]);
      setCandidates(cands);
      setPanelists(pans);
    } catch (err: any) {
      setLoadUsersError(
        err.message || "Failed to load the candidate/panelist directory."
      );
    } finally {
      setIsLoadingUsers(false);
    }
  }, []);

  React.useEffect(() => {
    loadData();
  }, [loadData]);

  const selectedCandidate = candidates.find((c) => c.id === selectedCandidateId);
  const selectedPanelistsList = panelists.filter((p) =>
    selectedPanelistIds.includes(p.id)
  );

  const filteredCandidates = candidateSearch.trim()
    ? candidates.filter(
        (c) =>
          c.name.toLowerCase().includes(candidateSearch.toLowerCase()) ||
          c.email.toLowerCase().includes(candidateSearch.toLowerCase())
      )
    : candidates;

  const filteredPanelists = panelistSearch.trim()
    ? panelists.filter(
        (p) =>
          p.name.toLowerCase().includes(panelistSearch.toLowerCase()) ||
          p.email.toLowerCase().includes(panelistSearch.toLowerCase())
      )
    : panelists;

  const handleCandidateProvisioned = (user: ProvisionedUser) => {
    setCandidates((prev) => (prev.some((c) => c.id === user.id) ? prev : [...prev, user]));
    setSelectedCandidateId(user.id);
    if (user.created) {
      setNewlyProvisionedIds((prev) => new Set(prev).add(user.id));
    }
    setShowNewCandidateForm(false);
    setErrorMessage(null);
  };

  const handlePanelistProvisioned = (user: ProvisionedUser) => {
    setPanelists((prev) => (prev.some((p) => p.id === user.id) ? prev : [...prev, user]));
    setSelectedPanelistIds((prev) => (prev.includes(user.id) ? prev : [...prev, user.id]));
    if (user.created) {
      setNewlyProvisionedIds((prev) => new Set(prev).add(user.id));
    }
    setShowNewPanelistForm(false);
    setErrorMessage(null);
  };

  const togglePanelist = (panelistId: string) => {
    if (selectedPanelistIds.includes(panelistId)) {
      setSelectedPanelistIds(selectedPanelistIds.filter((id) => id !== panelistId));
    } else {
      setSelectedPanelistIds([...selectedPanelistIds, panelistId]);
    }
  };

  const removePanelist = (panelistId: string) => {
    setSelectedPanelistIds(selectedPanelistIds.filter((id) => id !== panelistId));
  };

  const handleNextStep = () => {
    setErrorMessage(null);
    if (currentStep === 2 && !selectedCandidateId) {
      setErrorMessage("Please select or add a candidate.");
      return;
    }
    // Panelists are optional — with none selected, you become the interviewer.
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
        title: title.trim() || undefined,
        company: company.trim() || undefined,
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

  const anyoneProvisionedThisSession =
    newlyProvisionedIds.has(selectedCandidateId) ||
    selectedPanelistIds.some((id) => newlyProvisionedIds.has(id));

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
            Interview Created Successfully
          </span>
          <h2 className="text-2xl font-bold text-slate-900">
            {createdInterview.title || `Interview Request #${createdInterview.id}`}
          </h2>
          {createdInterview.company && (
            <p className="text-xs font-medium text-slate-600">{createdInterview.company}</p>
          )}
          <p className="text-sm text-slate-600 max-w-md mx-auto">
            The interview request has been created
            {anyoneProvisionedThisSession
              ? ", and the new candidate/panelist accounts were provisioned"
              : ""}
            . Next step: open the interview and{" "}
            <strong>Send Invitations</strong> so {createdInterview.candidate_name} and the
            panel each get a personal link.
          </p>
          <p className="text-[11px] text-slate-400 max-w-md mx-auto">
            No invitations have been sent yet — sending them is a separate action on the
            interview detail page.
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
              <span>Open interview &amp; send invitations</span>
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
          Set up the role, assign a candidate and panel, and review before creating the request.
        </p>
      </div>

      {/* 4-Step Progress Indicator */}
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

      {loadUsersError && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800 flex items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            {loadUsersError}
          </span>
          <Button variant="outline" size="sm" onClick={loadData} className="gap-1.5 shrink-0">
            <RefreshCw className="w-3.5 h-3.5" />
            Retry
          </Button>
        </div>
      )}

      {/* STEP 1: INTERVIEW DETAILS */}
      {currentStep === 1 && (
        <Card className="p-6 border-slate-200 shadow-enterprise space-y-6">
          <div>
            <h3 className="text-lg font-bold text-slate-900">Step 1: Interview Details</h3>
            <p className="text-xs text-slate-500 mt-1">
              Name the role, then specify round type, duration, and interviewer buffer.
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <Label htmlFor="title">Job / Role / Interview Title</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Senior Backend Engineer — Technical Round"
                maxLength={200}
                className="mt-1"
              />
              <p className="text-[11px] text-slate-400 mt-1">Optional — helps identify this request in lists.</p>
            </div>

            <div>
              <Label htmlFor="company">Company</Label>
              <Input
                id="company"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="e.g. Acme Corp"
                maxLength={200}
                className="mt-1"
              />
              <p className="text-[11px] text-slate-400 mt-1">Optional — the hiring company shown to participants and in the calendar invite.</p>
            </div>

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

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-xs text-slate-600 flex items-start gap-2.5">
              <Info className="w-4 h-4 text-workday-blue shrink-0 mt-0.5" />
              <p>
                Buffer time gives interviewers breathing room before and after the interview and directly influences recommendation quality in the 5-factor scoring model.
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* STEP 2: CANDIDATE */}
      {currentStep === 2 && (
        <Card className="p-6 border-slate-200 shadow-enterprise space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold text-slate-900">Step 2: Candidate</h3>
              <p className="text-xs text-slate-500 mt-1">
                Select an existing candidate or provision a new one.
              </p>
            </div>
            {!showNewCandidateForm && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowNewCandidateForm(true)}
                className="gap-1.5 shrink-0"
              >
                <UserPlus className="w-3.5 h-3.5" />
                Add New
              </Button>
            )}
          </div>

          {showNewCandidateForm && (
            <ProvisionInlineForm
              role="CANDIDATE"
              onProvisioned={handleCandidateProvisioned}
              onCancel={() => setShowNewCandidateForm(false)}
            />
          )}

          {!showNewCandidateForm && (
            <div className="space-y-3">
              <Label required>Candidate</Label>

              {isLoadingUsers ? (
                <p className="text-xs text-slate-400">Loading candidates…</p>
              ) : candidates.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-5 text-center space-y-2">
                  <p className="text-xs text-slate-500">
                    No candidates exist yet. Add one to get started.
                  </p>
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    onClick={() => setShowNewCandidateForm(true)}
                    className="gap-1.5"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    Add a New Candidate
                  </Button>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <Input
                      value={candidateSearch}
                      onChange={(e) => setCandidateSearch(e.target.value)}
                      placeholder="Search by name or email…"
                      className="pl-8"
                    />
                  </div>
                  <div className="space-y-2 max-h-72 overflow-y-auto">
                    {filteredCandidates.map((cand) => (
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
                          <p className="font-semibold text-slate-900 text-sm flex items-center gap-1.5">
                            {cand.name}
                            {newlyProvisionedIds.has(cand.id) && (
                              <span className="inline-flex items-center gap-0.5 text-[10px] font-bold uppercase tracking-wide text-workday-blue bg-workday-accent px-1.5 py-0.5 rounded">
                                <Sparkles className="w-2.5 h-2.5" /> New
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-slate-500">{cand.email}</p>
                        </div>
                        <div className="text-right">
                          <span className="text-xs font-mono font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
                            {cand.timezone}
                          </span>
                        </div>
                      </div>
                    ))}
                    {filteredCandidates.length === 0 && (
                      <p className="text-xs text-slate-400 py-2">No candidates match your search.</p>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </Card>
      )}

      {/* STEP 3: PANELISTS */}
      {currentStep === 3 && (
        <Card className="p-6 border-slate-200 shadow-enterprise space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold text-slate-900">Step 3: Panelists (optional)</h3>
              <p className="text-xs text-slate-500 mt-1">
                Select interviewers, or leave this empty — with none selected,
                you are recorded as the interviewer and your connected Google
                Calendar is used.
              </p>
            </div>
            {!showNewPanelistForm && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowNewPanelistForm(true)}
                className="gap-1.5 shrink-0"
              >
                <UserPlus className="w-3.5 h-3.5" />
                Add New
              </Button>
            )}
          </div>

          {showNewPanelistForm && (
            <ProvisionInlineForm
              role="PANELIST"
              onProvisioned={handlePanelistProvisioned}
              onCancel={() => setShowNewPanelistForm(false)}
            />
          )}

          {selectedPanelistsList.length > 0 && (
            <div className="space-y-2">
              <Label className="text-[11px]">Selected Panelists ({selectedPanelistsList.length})</Label>
              <div className="flex flex-wrap gap-2">
                {selectedPanelistsList.map((p) => (
                  <span
                    key={p.id}
                    className="inline-flex items-center gap-1.5 bg-workday-accent/50 border border-workday-blue/30 text-workday-navy text-xs font-medium px-2.5 py-1 rounded-md"
                  >
                    {p.name}
                    {newlyProvisionedIds.has(p.id) && (
                      <Sparkles className="w-3 h-3 text-workday-blue" />
                    )}
                    <button
                      type="button"
                      onClick={() => removePanelist(p.id)}
                      className="text-workday-blue/60 hover:text-rose-600"
                      aria-label={`Remove ${p.name}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {!showNewPanelistForm && (
            <div className="space-y-3">
              {isLoadingUsers ? (
                <p className="text-xs text-slate-400">Loading panelists…</p>
              ) : panelists.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-5 text-center space-y-2">
                  <p className="text-xs text-slate-500">
                    No panelists exist yet. Add one to get started.
                  </p>
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    onClick={() => setShowNewPanelistForm(true)}
                    className="gap-1.5"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    Add a New Panelist
                  </Button>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <Input
                      value={panelistSearch}
                      onChange={(e) => setPanelistSearch(e.target.value)}
                      placeholder="Search by name or email…"
                      className="pl-8"
                    />
                  </div>
                  <div className="space-y-2.5 max-h-72 overflow-y-auto">
                    {filteredPanelists.map((pan) => {
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
                    {filteredPanelists.length === 0 && (
                      <p className="text-xs text-slate-400 py-2">No panelists match your search.</p>
                    )}
                  </div>
                </>
              )}

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-xs text-slate-600 flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                <p>
                  Each selected panelist must connect their Google Calendar before
                  recommendations can run. If any calendar is not connected, the
                  scheduling step will fail and name the panelist.
                </p>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* STEP 4: REVIEW & CREATE */}
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
                  Job / Role
                </span>
                <p className="text-slate-900 font-bold text-sm mt-0.5">
                  {title.trim() || <span className="text-slate-400 font-normal italic">No title provided</span>}
                </p>
              </div>
              <div>
                <span className="text-slate-500 font-semibold uppercase tracking-wider block text-[11px]">
                  Company
                </span>
                <p className="text-slate-900 font-bold text-sm mt-0.5">
                  {company.trim() || <span className="text-slate-400 font-normal italic">Not specified</span>}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 border-t border-slate-200">
              <div>
                <span className="text-slate-500 font-semibold uppercase tracking-wider block text-[11px]">
                  Candidate
                </span>
                <p className="text-slate-900 font-bold text-sm mt-0.5 flex items-center gap-1.5">
                  {selectedCandidate?.name}
                  {newlyProvisionedIds.has(selectedCandidateId) && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] font-bold uppercase tracking-wide text-workday-blue bg-workday-accent px-1.5 py-0.5 rounded">
                      <Sparkles className="w-2.5 h-2.5" /> New
                    </span>
                  )}
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
                {selectedPanelistsList.length === 0 ? (
                  <span className="text-slate-600">
                    None selected — you will be the interviewer (your connected
                    Google Calendar is used).
                  </span>
                ) : (
                  selectedPanelistsList.map((p) => (
                    <span
                      key={p.id}
                      className="inline-flex items-center gap-1 bg-white border border-slate-200 text-slate-800 px-3 py-1 rounded-md font-medium"
                    >
                      {p.name} ({p.timezone})
                      {newlyProvisionedIds.has(p.id) && (
                        <Sparkles className="w-3 h-3 text-workday-blue" />
                      )}
                    </span>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-xs text-slate-600 flex items-start gap-2.5">
            <Info className="w-4 h-4 text-workday-blue shrink-0 mt-0.5" />
            <p>
              Creating this request does not send any invitations or notifications yet.
              You&apos;ll get a candidate availability link to share manually.
            </p>
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
