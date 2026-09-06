"use client";

import * as React from "react";
import { useAuth } from "@/lib/auth-context";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { User, Mail, Globe, Save } from "lucide-react";

const USERS_KEY = "smart_interview_users";
const CURRENT_USER_KEY = "smart_interview_current_user";

export default function CandidateProfilePage() {
  const { user } = useAuth();

  const [name, setName] = React.useState("");
  const [timezone, setTimezone] = React.useState("");
  const [isSaved, setIsSaved] = React.useState(false);

  React.useEffect(() => {
    if (user) {
      setName(user.name || "");
      setTimezone(user.timezone || "");
    }
  }, [user]);

  const handleSave = () => {
    if (!user) return;

    const storedUsers = localStorage.getItem(USERS_KEY);

    if (storedUsers) {
      try {
        const users = JSON.parse(storedUsers);

        const updatedUsers = users.map((storedUser: any) => {
          if (storedUser.id === user.id) {
            return {
              ...storedUser,
              name: name.trim(),
              timezone,
            };
          }

          return storedUser;
        });

        localStorage.setItem(
          USERS_KEY,
          JSON.stringify(updatedUsers)
        );
      } catch (error) {
        console.error("Failed to update stored users:", error);
      }
    }

    const updatedCurrentUser = {
      ...user,
      name: name.trim(),
      timezone,
    };

    localStorage.setItem(
      CURRENT_USER_KEY,
      JSON.stringify(updatedCurrentUser)
    );

    setIsSaved(true);

    setTimeout(() => {
      setIsSaved(false);
    }, 2000);

    window.location.reload();
  };

  return (
    <div className="space-y-8 max-w-4xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          My Profile
        </h1>

        <p className="text-sm text-slate-500 mt-1">
          Manage your candidate profile information.
        </p>
      </div>

      {/* Profile Card */}
      <Card className="bg-white border-slate-200 shadow-enterprise">
        <CardHeader>
          <CardTitle className="text-base font-bold text-slate-900">
            Personal Information
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Name */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-600">
              Full Name
            </label>

            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />

              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full h-10 rounded-lg border border-slate-200 bg-white pl-10 pr-3 text-sm text-slate-900 outline-none focus:border-workday-blue focus:ring-2 focus:ring-workday-blue/10"
                placeholder="Enter your name"
              />
            </div>
          </div>

          {/* Email */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-600">
              Email Address
            </label>

            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />

              <input
                type="email"
                value={user?.email || ""}
                disabled
                className="w-full h-10 rounded-lg border border-slate-200 bg-slate-50 pl-10 pr-3 text-sm text-slate-500 cursor-not-allowed"
              />
            </div>

            <p className="text-xs text-slate-400">
              Your login email cannot be changed here.
            </p>
          </div>

          {/* Timezone */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-600">
              Timezone
            </label>

            <div className="relative">
              <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />

              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="w-full h-10 rounded-lg border border-slate-200 bg-white pl-10 pr-3 text-sm text-slate-900 outline-none focus:border-workday-blue focus:ring-2 focus:ring-workday-blue/10"
              >
                <option value="Asia/Kolkata">
                  India Standard Time (Asia/Kolkata)
                </option>

                <option value="America/New_York">
                  Eastern Time (America/New_York)
                </option>

                <option value="America/Chicago">
                  Central Time (America/Chicago)
                </option>

                <option value="America/Denver">
                  Mountain Time (America/Denver)
                </option>

                <option value="America/Los_Angeles">
                  Pacific Time (America/Los_Angeles)
                </option>

                <option value="Europe/London">
                  GMT / London (Europe/London)
                </option>

                <option value="Europe/Paris">
                  Central European Time (Europe/Paris)
                </option>

                <option value="Asia/Dubai">
                  Gulf Standard Time (Asia/Dubai)
                </option>

                <option value="Asia/Singapore">
                  Singapore Time (Asia/Singapore)
                </option>
              </select>
            </div>
          </div>

          {/* Save */}
          <div className="flex items-center gap-3 pt-2">
            <Button
              variant="primary"
              size="md"
              onClick={handleSave}
              className="gap-2"
            >
              <Save className="w-4 h-4" />
              Save Changes
            </Button>

            {isSaved && (
              <span className="text-xs font-semibold text-emerald-600">
                Changes saved successfully.
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}