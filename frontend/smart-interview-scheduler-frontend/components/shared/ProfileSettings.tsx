"use client";

import * as React from "react";
import { useAuth } from "@/lib/auth-context";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { User, Calendar, LogOut } from "lucide-react";

export const ProfileSettings: React.FC = () => {
  const { user, role, calendarStatus, logout } = useAuth();

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          Profile & Account Settings
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Review your enterprise account details, role permissions, and active integrations.
        </p>
      </div>

      <Card className="border-slate-200 shadow-xs">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <User className="w-4 h-4 text-workday-blue" />
            <span>Profile Information</span>
          </CardTitle>
          <CardDescription className="text-xs">
            Personal identity credentials stored in enterprise directory.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label>Full Name</Label>
              <Input readOnly value={user?.name || ""} className="bg-slate-50 mt-1" />
            </div>

            <div>
              <Label>Corporate Email</Label>
              <Input readOnly value={user?.email || ""} className="bg-slate-50 mt-1" />
            </div>

            <div>
              <Label>Account Role</Label>
              <Input readOnly value={role || "USER"} className="bg-slate-50 mt-1 uppercase font-bold text-workday-blue" />
            </div>

            <div>
              <Label>Default Timezone</Label>
              <Input readOnly value={user?.timezone || "UTC"} className="bg-slate-50 mt-1" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-xs">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Calendar className="w-4 h-4 text-workday-blue" />
            <span>Integrations & Synchronization</span>
          </CardTitle>
          <CardDescription className="text-xs">
            External calendar connections and OAuth synchronization.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-xs">
          <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between">
            <div className="space-y-0.5">
              <span className="font-bold text-slate-900 block text-xs">Google Calendar Integration</span>
              <p className="text-slate-500 text-[11px]">
                Enables automated free/busy scheduling lookups and Google Meet link generation.
              </p>
            </div>
            <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
              calendarStatus === "CONNECTED"
                ? "bg-emerald-100 text-emerald-800"
                : "bg-slate-200 text-slate-700"
            }`}>
              {calendarStatus}
            </span>
          </div>

          <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between">
            <div className="space-y-0.5">
              <span className="font-bold text-slate-900 block text-xs">Authentication Identity</span>
              <p className="text-slate-500 text-[11px]">
                Bearer Token JWT session with automatic token refresh (scopes: openid, email, profile).
              </p>
            </div>
            <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
              Active
            </span>
          </div>
        </CardContent>
      </Card>

      <div className="pt-2 flex justify-end">
        <Button variant="danger" size="md" onClick={() => logout()} className="gap-2">
          <LogOut className="w-4 h-4" />
          <span>Sign Out of Application</span>
        </Button>
      </div>
    </div>
  );
};
