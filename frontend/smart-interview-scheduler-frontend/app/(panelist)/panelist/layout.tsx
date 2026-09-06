"use client";

import * as React from "react";
import { AppShell } from "@/components/shared/AppShell";
import { RoleGuard } from "@/components/shared/RoleGuard";

export default function PanelistLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <RoleGuard allowedRole="PANELIST">
      <AppShell
        title="Panelist Workspace"
        breadcrumbs={[{ label: "Panelist", href: "/panelist" }]}
      >
        {children}
      </AppShell>
    </RoleGuard>
  );
}
