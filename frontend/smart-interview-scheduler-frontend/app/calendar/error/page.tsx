"use client";

import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";

/**
 * Landing page for the Google Calendar OAuth failure redirect.
 *
 * The backend `GET /api/v1/calendar/callback` 302s here when the OAuth state is
 * invalid/expired, Google returned an error, or the token exchange failed. No
 * details are passed in the URL by design (no leaking of state/codes).
 */
export default function CalendarErrorPage() {
  return (
    <div className="min-h-screen bg-workday-surface flex items-center justify-center p-6 text-slate-900">
      <Card className="max-w-md w-full p-8 text-center space-y-6 shadow-enterprise border-slate-200">
        <div className="w-14 h-14 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center mx-auto">
          <AlertCircle className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-bold text-slate-900">
          Calendar Connection Failed
        </h2>
        <p className="text-xs text-rose-700 bg-rose-50 p-3 rounded-lg border border-rose-200 leading-relaxed">
          We couldn&apos;t connect your Google Calendar. The authorization may
          have been declined or expired. Please start the connection again.
        </p>
        <div className="pt-2 flex justify-center gap-3">
          <Link href="/panelist/calendar">
            <Button variant="primary" size="md">
              Try Connecting Again
            </Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
