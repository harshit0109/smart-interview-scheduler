"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import {
  Calendar,
  LayoutDashboard,
  PlusCircle,
  Users,
  CalendarCheck,
  Settings,
  LogOut,
  Sparkles,
  UserCheck,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

export const Sidebar: React.FC<{ onCloseMobile?: () => void }> = ({
  onCloseMobile,
}) => {
  const pathname = usePathname();
  const { user, role, logout } = useAuth();

  // Navigation items strictly determined by the authenticated user's backend role
  const getNavItems = (): NavItem[] => {
    switch (role) {
      case "ADMIN":
        return [
          { label: "Overview", href: "/admin", icon: LayoutDashboard },
          { label: "All Interviews", href: "/admin/interviews", icon: Users },
          { label: "Create Interview", href: "/admin/interviews/new", icon: PlusCircle },
          { label: "Google Calendar", href: "/calendar", icon: Calendar },
          { label: "Settings", href: "/admin/settings", icon: Settings },
        ];
      case "PANELIST":
        return [
          { label: "Overview", href: "/panelist", icon: LayoutDashboard },
          { label: "My Interviews", href: "/panelist/interviews", icon: CalendarCheck },
          { label: "Google Calendar", href: "/panelist/calendar", icon: Calendar },
          { label: "Profile", href: "/panelist/settings", icon: Settings },
        ];
      case "CANDIDATE":
        return [
          { label: "Overview", href: "/candidate", icon: LayoutDashboard },
          { label: "My Interviews", href: "/candidate/interviews", icon: UserCheck },
          { label: "Profile", href: "/candidate/profile", icon: Settings },
        ];
      default:
        return [{ label: "Overview", href: "/", icon: LayoutDashboard }];
    }
  };

  const navItems = getNavItems();

  return (
    <aside className="w-64 bg-white text-slate-800 flex flex-col h-full shrink-0 border-r border-slate-200 select-none">
      {/* Brand Header */}
      <div className="p-5 border-b border-slate-200/80">
        <Link
          href="/"
          onClick={onCloseMobile}
          className="flex items-center gap-2.5 group"
        >
          <div className="w-9 h-9 rounded-lg bg-workday-blue flex items-center justify-center text-white font-bold shadow-xs">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <span className="text-[10px] font-bold tracking-widest text-slate-500 block uppercase">
              SMART INTERVIEW
            </span>
            <span className="text-sm font-bold tracking-tight text-slate-900 leading-tight block">
              Scheduler
            </span>
          </div>
        </Link>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 px-3 py-5 space-y-1 overflow-y-auto">
        <div className="px-3 pb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
          Navigation
        </div>
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            pathname === item.href ||
            (item.href !== "/admin" &&
              item.href !== "/panelist" &&
              item.href !== "/candidate" &&
              pathname.startsWith(item.href));

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onCloseMobile}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-xs font-semibold transition-all duration-150",
                isActive
                  ? "bg-workday-accent text-workday-blue font-bold shadow-xs border border-workday-blue/20"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              )}
            >
              <Icon className={cn("w-4 h-4", isActive ? "text-workday-blue" : "text-slate-400")} />
              <span>{item.label}</span>
              {isActive && <ChevronRight className="w-3.5 h-3.5 ml-auto text-workday-blue opacity-80" />}
            </Link>
          );
        })}
      </nav>

      {/* Real User Profile Footer */}
      <div className="p-4 border-t border-slate-200 bg-slate-50/70">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 rounded-full bg-workday-blue/10 text-workday-blue border border-workday-blue/20 flex items-center justify-center font-bold text-xs uppercase shrink-0">
            {user?.name ? user.name.slice(0, 2).toUpperCase() : "U"}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold text-slate-900 truncate">
              {user?.name || "Enterprise User"}
            </p>
            <span className="inline-block text-[10px] font-bold uppercase px-1.5 py-0.2 rounded bg-slate-200/80 text-slate-700">
              {role || "USER"}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => logout()}
          className="w-full flex items-center justify-center gap-2 px-3 py-1.5 text-xs text-slate-600 hover:text-red-600 hover:bg-red-50 rounded-md border border-slate-200 transition-colors font-medium"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>Sign Out</span>
        </button>
      </div>
    </aside>
  );
};
