"use client";

import * as React from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import {
  Menu,
  Globe,
  CalendarCheck2,
  CalendarX2,
  AlertTriangle,
  ChevronDown,
  User,
  LogOut,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface HeaderProps {
  onOpenMobileMenu?: () => void;
  title?: string;
  breadcrumbs?: { label: string; href?: string }[];
}

export const Header: React.FC<HeaderProps> = ({
  onOpenMobileMenu,
  title,
  breadcrumbs = [],
}) => {
  const { user, role, calendarStatus, logout } = useAuth();
  const [dropdownOpen, setDropdownOpen] = React.useState(false);

  return (
    <header className="h-16 border-b border-slate-200 bg-white px-6 flex items-center justify-between sticky top-0 z-30 shadow-xs">
      {/* Left: Mobile toggle + Breadcrumbs / Title */}
      <div className="flex items-center gap-4">
        {onOpenMobileMenu && (
          <button
            type="button"
            onClick={onOpenMobileMenu}
            className="md:hidden p-2 rounded-md text-slate-600 hover:bg-slate-100"
            aria-label="Open navigation menu"
          >
            <Menu className="w-5 h-5" />
          </button>
        )}

        <div>
          {breadcrumbs.length > 0 && (
            <nav className="flex items-center gap-1.5 text-xs text-slate-500 mb-0.5">
              {breadcrumbs.map((b, idx) => (
                <React.Fragment key={idx}>
                  {b.href ? (
                    <Link
                      href={b.href}
                      className="hover:text-workday-blue transition-colors"
                    >
                      {b.label}
                    </Link>
                  ) : (
                    <span className="font-medium text-slate-800">{b.label}</span>
                  )}
                  {idx < breadcrumbs.length - 1 && <span>/</span>}
                </React.Fragment>
              ))}
            </nav>
          )}
          {title && (
            <h1 className="text-base font-bold text-slate-900 leading-tight">
              {title}
            </h1>
          )}
        </div>
      </div>

      {/* Right: Timezone + Calendar Status + Profile */}
      <div className="flex items-center gap-3 sm:gap-4">
        {/* Timezone pill */}
        <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 border border-slate-200/80 text-xs text-slate-600 font-medium">
          <Globe className="w-3.5 h-3.5 text-slate-500" />
          <span>{user?.timezone || "UTC"}</span>
        </div>

        {/* Google Calendar Status pill (Section 70) */}
        {(role === "PANELIST" || role === "ADMIN") && (
          <Link
            href="/panelist/calendar"
            className={cn(
              "flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border transition-all duration-150",
              calendarStatus === "CONNECTED"
                ? "bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100"
                : calendarStatus === "REVOKED" || calendarStatus === "EXPIRED"
                ? "bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100"
                : "bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200"
            )}
            title="Google Calendar Integration Status"
          >
            {calendarStatus === "CONNECTED" ? (
              <>
                <CalendarCheck2 className="w-3.5 h-3.5 text-emerald-600" />
                <span className="hidden lg:inline">Calendar:</span>
                <span>Connected</span>
              </>
            ) : calendarStatus === "REVOKED" || calendarStatus === "EXPIRED" ? (
              <>
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                <span className="hidden lg:inline">Calendar:</span>
                <span>Needs Attention</span>
              </>
            ) : (
              <>
                <CalendarX2 className="w-3.5 h-3.5 text-slate-400" />
                <span className="hidden lg:inline">Calendar:</span>
                <span>Not Connected</span>
              </>
            )}
          </Link>
        )}

        {/* User profile dropdown */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-slate-100 text-slate-700 transition-colors focus:outline-none"
          >
            <div className="w-8 h-8 rounded-full bg-workday-blue/10 text-workday-blue border border-workday-blue/20 text-xs font-bold flex items-center justify-center">
              {user?.name ? user.name.slice(0, 2).toUpperCase() : "U"}
            </div>
            <span className="hidden md:block text-xs font-semibold text-slate-800">
              {user?.name || "User"}
            </span>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
          </button>

          {dropdownOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setDropdownOpen(false)}
              />
              <div className="absolute right-0 mt-2 w-56 rounded-lg border border-slate-200 bg-white p-2 shadow-enterprise-lg z-50 text-sm">
                <div className="px-3 py-2 border-b border-slate-100">
                  <p className="text-xs font-bold text-slate-900">{user?.name}</p>
                  <p className="text-xs text-slate-500 truncate">{user?.email}</p>
                  <p className="text-[10px] font-mono text-workday-blue font-semibold mt-1">
                    Role: {role}
                  </p>
                </div>

                <div className="py-1">
                  <Link
                    href="/admin/settings"
                    onClick={() => setDropdownOpen(false)}
                    className="flex items-center gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 rounded"
                  >
                    <User className="w-3.5 h-3.5 text-slate-400" />
                    <span>My Profile</span>
                  </Link>
                  <Link
                    href="/panelist/calendar"
                    onClick={() => setDropdownOpen(false)}
                    className="flex items-center gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 rounded"
                  >
                    <CalendarCheck2 className="w-3.5 h-3.5 text-slate-400" />
                    <span>Google Calendar Sync</span>
                  </Link>
                </div>

                <div className="pt-1 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => {
                      setDropdownOpen(false);
                      logout();
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-600 hover:bg-red-50 rounded font-medium"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Sign Out</span>
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
};
