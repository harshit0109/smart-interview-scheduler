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

/**
 * Convert a wall-clock date + time typed by the user, interpreted in `timeZone`,
 * into a UTC ISO8601 string (with offset). The backend stores availability
 * windows as offset-aware instants plus a separate timezone label, so the wall
 * time must be anchored to the *selected* zone — not the browser's zone.
 *
 * ponytail: uses the standard Intl offset trick; may be off by up to the DST
 * gap for a time that falls inside a spring-forward/fall-back transition hour.
 */
export function zonedWallTimeToISO(
  dateStr: string,
  timeStr: string,
  timeZone: string
): string {
  const guess = new Date(`${dateStr}T${timeStr}:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
    .formatToParts(guess)
    .reduce<Record<string, string>>((acc, p) => {
      if (p.type !== "literal") acc[p.type] = p.value;
      return acc;
    }, {});
  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour === "24" ? "0" : parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  const offset = asUTC - guess.getTime();
  return new Date(guess.getTime() - offset).toISOString();
}
