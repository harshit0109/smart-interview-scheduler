"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { interviewsApi } from "@/lib/api-client";
import { RecommendedSlot, InterviewRequest } from "@/lib/types";
import { RecommendationCard } from "@/components/shared/RecommendationCard";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Clock, Info } from "lucide-react";

export default function CandidateRecommendationsPage() {
  const params = useParams();
  const interviewId = params.id as string;

  const [interview, setInterview] = React.useState<InterviewRequest | null>(null);
  const [slots, setSlots] = React.useState<RecommendedSlot[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    const load = async () => {
      try {
        // Read-only for the candidate: the latest recommendation run is exposed
        // on the interview detail payload. Do NOT POST /recommendations here —
        // that re-runs the scheduling engine.
        const inv = await interviewsApi.getById(interviewId);
        setInterview(inv);
        setSlots(inv.latest_recommendations ?? []);
      } catch (err) {
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [interviewId]);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Link href="/candidate">
        <Button variant="ghost" size="sm" className="text-xs -ml-2">
          <ArrowLeft className="w-3.5 h-3.5 mr-1" />
          Back to Candidate Portal
        </Button>
      </Link>

      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          Recommended Interview Times
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Your recruiter and hiring panel will review these mathematical matches and confirm the final time.
        </p>
      </div>

      {/* Notice box: Read-only for candidate */}
      <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-xs text-slate-700 flex items-center gap-3">
        <Info className="w-4 h-4 text-workday-blue shrink-0" />
        <p>
          <span className="font-semibold text-slate-900">Read-only preview:</span> Your hiring coordinator will review these top-ranked options and confirm the final calendar booking. You will automatically receive a Google Calendar invitation and Google Meet link.
        </p>
      </div>

      {isLoading ? (
        <div className="py-16 text-center text-xs text-slate-500">
          Loading recommended times...
        </div>
      ) : slots.length > 0 ? (
        <div className="space-y-4">
          {slots.map((slot) => (
            <RecommendationCard
              key={slot.id}
              slot={slot}
              isReadOnly={true}
              displayTimezone={interview?.candidate_timezone}
            />
          ))}
        </div>
      ) : (
        <div className="p-8 text-center bg-white rounded-xl border border-slate-200 text-slate-500 text-xs">
          No recommendations available yet.
        </div>
      )}
    </div>
  );
}
