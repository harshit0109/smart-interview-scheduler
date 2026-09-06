"use client";

import * as React from "react";
import { AppShell } from "@/components/shared/AppShell";
import { RoleGuard } from "@/components/shared/RoleGuard";

export default function CandidateLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <RoleGuard allowedRole="CANDIDATE">
      <AppShell
        title="Candidate Portal"
        breadcrumbs={[{ label: "Candidate", href: "/candidate" }]}
      >
        {children}
      </AppShell>
    </RoleGuard>
  );
}
