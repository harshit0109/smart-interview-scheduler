"use client";

import * as React from "react";
import { AppShell } from "@/components/shared/AppShell";
import { RoleGuard } from "@/components/shared/RoleGuard";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <RoleGuard allowedRole="ADMIN">
      <AppShell
        title="Admin Workspace"
        breadcrumbs={[{ label: "Admin", href: "/admin" }]}
      >
        {children}
      </AppShell>
    </RoleGuard>
  );
}
