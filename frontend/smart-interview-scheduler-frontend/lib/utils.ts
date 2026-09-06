import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, parseISO } from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDateTime(isoString: string, timeZone?: string): string {
  try {
    const date = parseISO(isoString);
    if (!timeZone || typeof Intl === "undefined") {
      return format(date, "EEEE, MMMM d, yyyy 'at' h:mm a");
    }
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    return dtf.format(date);
  } catch {
    return isoString;
  }
}

export function formatDateOnly(isoString: string, timeZone?: string): string {
  try {
    const date = parseISO(isoString);
    if (!timeZone || typeof Intl === "undefined") {
      return format(date, "EEEE, MMMM d, yyyy");
    }
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
    return dtf.format(date);
  } catch {
    return isoString;
  }
}

export function formatTimeOnly(isoString: string, timeZone?: string): string {
  try {
    const date = parseISO(isoString);
    if (!timeZone || typeof Intl === "undefined") {
      return format(date, "h:mm a");
    }
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    return dtf.format(date);
  } catch {
    return isoString;
  }
}

export function formatTimeRange(
  startIso: string,
  endIso: string,
  timeZone?: string
): string {
  try {
    const start = formatTimeOnly(startIso, timeZone);
    const end = formatTimeOnly(endIso, timeZone);
    const tzSuffix = timeZone ? ` (${getShortTz(timeZone)})` : "";
    return `${start} – ${end}${tzSuffix}`;
  } catch {
    return `${startIso} - ${endIso}`;
  }
}

export function getShortTz(timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "short",
    }).formatToParts(new Date());
    const tz = parts.find((p) => p.type === "timeZoneName");
    return tz ? tz.value : timeZone;
  } catch {
    return timeZone;
  }
}

export function getSystemTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function formatScorePercent(score: number): number {
  return Math.round(score * 100);
}
