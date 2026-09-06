"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { Loader2 } from "lucide-react";

export default function AuthCallbackPage() {
  const router = useRouter();
  const { role } = useAuth();

  React.useEffect(() => {
    const timer = setTimeout(() => {
      if (role === "PANELIST") router.push("/panelist");
      else if (role === "CANDIDATE") router.push("/candidate");
      else router.push("/admin");
    }, 400);
    return () => clearTimeout(timer);
  }, [role, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-workday-surface">
      <div className="text-center space-y-3">
        <Loader2 className="w-8 h-8 text-workday-blue animate-spin mx-auto" />
        <p className="text-xs text-slate-500 font-medium">
          Completing sign in and redirecting...
        </p>
      </div>
    </div>
  );
}
