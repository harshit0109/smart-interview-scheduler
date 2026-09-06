"use client";

import * as React from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { Role } from "@/lib/types";
import { Loader2 } from "lucide-react";

interface RoleGuardProps {
  allowedRole: Role | Role[];
  children: React.ReactNode;
}

export const RoleGuard: React.FC<RoleGuardProps> = ({
  allowedRole,
  children,
}) => {
  const { user, role, isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const allowedRoles = Array.isArray(allowedRole)
    ? allowedRole
    : [allowedRole];

  React.useEffect(() => {
    if (isLoading) return;

    // Not logged in
    if (!isAuthenticated || !user) {
      const redirectUrl =
        `/login?redirect=${encodeURIComponent(pathname)}`;

      router.replace(redirectUrl);
      return;
    }

    // Check whether current user's role is allowed
    if (!role || !allowedRoles.includes(role)) {
      if (role === "ADMIN") {
        router.replace("/admin");
      } else if (role === "PANELIST") {
        router.replace("/panelist");
      } else if (role === "CANDIDATE") {
        router.replace("/candidate");
      } else {
        router.replace("/login");
      }
    }
  }, [
    isAuthenticated,
    user,
    role,
    allowedRole,
    isLoading,
    router,
    pathname,
  ]);

  // Show loading / unauthorized state
  if (
    isLoading ||
    !isAuthenticated ||
    !role ||
    !allowedRoles.includes(role)
  ) {
    return (
      <div className="min-h-screen w-full flex flex-col items-center justify-center bg-slate-50 text-slate-500">
        <div className="flex flex-col items-center space-y-3">
          <Loader2 className="w-8 h-8 text-workday-blue animate-spin" />

          <p className="text-xs font-medium tracking-wide">
            Verifying enterprise permissions...
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};