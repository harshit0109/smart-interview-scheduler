import {
  AuthTokens,
  User,
  CalendarStatusResponse,
  InterviewRequest,
  InterviewParticipant,
  CreateInterviewPayload,
  SubmitAvailabilityPayload,
  BookSlotPayload,
  InterviewEvent,
  RecommendationRun,
  RecommendedSlot,
  PaginatedResponse,
  ApiErrorResponse,
  CandidateAvailability,
  ProvisionUserPayload,
  ProvisionedUser,
  InvitationRecord,
  InvitationSummary,
  InvitationPublic,
  InvitationRespondPayload,
  ClaimAccountPayload,
  LifecycleStatusResponse,
  AuditEntry,
  RecordOutcomePayload,
  NextRoundPayload,
  NotificationLogEntry,
} from "./types";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "/api/v1";

export class ApiClientError extends Error {
  public code: string;
  public field_errors?: Record<string, string[]> | null;
  public trace_id?: string;
  public statusCode: number;

  constructor(
    message: string,
    code = "UNKNOWN_ERROR",
    statusCode = 500,
    field_errors?: Record<string, string[]> | null,
    trace_id?: string
  ) {
    super(message);
    this.name = "ApiClientError";
    this.code = code;
    this.statusCode = statusCode;
    this.field_errors = field_errors;
    this.trace_id = trace_id;
  }
}

// ---------------------------------------------------------------------------
// Token storage helpers
// ---------------------------------------------------------------------------
export function getStoredAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("sis_access_token");
}

export function getStoredRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("sis_refresh_token");
}

/** Persist a full token pair (login / register-then-login). */
export function storeTokens(tokens: AuthTokens) {
  if (typeof window === "undefined") return;
  localStorage.setItem("sis_access_token", tokens.access_token);
  if (tokens.refresh_token) {
    localStorage.setItem("sis_refresh_token", tokens.refresh_token);
  }
}

/**
 * Persist ONLY a new access token. The backend `POST /auth/refresh` response is
 * `{ access_token, token_type }` with no refresh token — the existing refresh
 * token must survive untouched.
 */
export function storeAccessToken(accessToken: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem("sis_access_token", accessToken);
}

export function clearStoredTokens() {
  if (typeof window === "undefined") return;
  localStorage.removeItem("sis_access_token");
  localStorage.removeItem("sis_refresh_token");
  localStorage.removeItem("sis_demo_user");
  _selfCache = null;
  _directoryCache = null;
}

let isRefreshing = false;
let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = getStoredRefreshToken();
  if (!refreshToken || refreshToken === "undefined") return null;

  try {
    const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    if (!res.ok) {
      clearStoredTokens();
      return null;
    }

    const data: { access_token?: string } = await res.json();
    if (!data.access_token) {
      clearStoredTokens();
      return null;
    }
    // Update ONLY the access token; keep the existing refresh token.
    storeAccessToken(data.access_token);
    return data.access_token;
  } catch {
    clearStoredTokens();
    return null;
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  retry = true
): Promise<T> {
  const token = getStoredAccessToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const url = path.startsWith("http") ? path : `${API_BASE_URL}${path}`;

  try {
    const res = await fetch(url, { ...options, headers });

    // Handle 401 with a single token-refresh retry — but NOT for the auth
    // endpoints themselves: a 401 from /auth/login is "wrong credentials",
    // not an expired session, and must surface the backend's real message.
    const isAuthEndpoint = path.startsWith("/auth/");
    if (res.status === 401 && retry && !isAuthEndpoint) {
      if (!isRefreshing) {
        isRefreshing = true;
        refreshPromise = refreshAccessToken().finally(() => {
          isRefreshing = false;
          refreshPromise = null;
        });
      }

      const newToken = await refreshPromise;
      if (newToken) {
        return request<T>(path, options, false);
      } else {
        clearStoredTokens();
        if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
          window.location.href = "/login?expired=1";
        }
        throw new ApiClientError("Session expired. Please log in again.", "UNAUTHORIZED", 401);
      }
    }

    if (!res.ok) {
      let errorData: ApiErrorResponse | null = null;
      try {
        errorData = await res.json();
      } catch {
        // Response was not JSON
      }

      const errObj = errorData?.error;
      const message =
        errObj?.message ||
        (res.status === 404
          ? "The requested resource was not found."
          : res.status === 409
          ? "A scheduling conflict occurred or slot is no longer available."
          : res.status === 422
          ? "Validation failed. Please verify your inputs."
          : res.status === 429
          ? "You're doing that a little too quickly. Please wait a moment and try again."
          : res.status === 502
          ? "We couldn't reach Google Calendar. Please try again shortly."
          : "An unexpected server error occurred.");

      throw new ApiClientError(
        message,
        errObj?.code || `HTTP_${res.status}`,
        res.status,
        errObj?.field_errors,
        errObj?.trace_id
      );
    }

    if (res.status === 204) {
      return {} as T;
    }

    return (await res.json()) as T;
  } catch (error: any) {
    if (error instanceof ApiClientError) throw error;
    throw new ApiClientError(
      "We couldn't reach the scheduling service. Check your connection and try again.",
      "NETWORK_ERROR",
      0
    );
  }
}

/* =========================================================
   BACKEND RESPONSE SHAPES + ADAPTERS
   ─────────────────────────────────────────────────────────
   The FastAPI contracts differ from the enriched shapes the
   UI was built against. These adapters translate centrally
   so pages/components keep using the frontend `types.ts`
   models unchanged.
========================================================= */

interface BackendParticipant {
  user_id: string;
  role_in_interview: "CANDIDATE" | "PANELIST";
  response_status: "PENDING" | "ACCEPTED" | "DECLINED" | "UNAVAILABLE";
  /** PANELIST-only, ADMIN detail read only: CONNECTED / EXPIRED / REVOKED /
   * DISCONNECTED, or null when not enriched. */
  calendar_status?: string | null;
}

interface BackendInterviewEvent {
  id: string;
  interview_request_id: string;
  start_time: string;
  end_time: string;
  calendar_event_id: string;
  meeting_link: string | null;
  provider?: "GOOGLE" | "SIMULATED";
  status: string;
  created_at: string;
}

interface BackendInterview {
  id: string;
  candidate_id: string;
  created_by: string;
  title?: string | null;
  company?: string | null;
  round_type: InterviewRequest["round_type"];
  duration_minutes: number;
  buffer_minutes: number;
  status: InterviewRequest["status"];
  outcome?: InterviewRequest["outcome"];
  outcome_notes?: string | null;
  round_number?: number;
  parent_request_id?: string | null;
  created_at: string;
  participants: BackendParticipant[];
  recommended_slots?: RecommendedSlot[] | null;
  booked_event?: BackendInterviewEvent | null;
}

interface BackendAvailability {
  id: string;
  interview_request_id: string;
  candidate_id: string;
  timezone: string;
  submitted_at: string;
  windows: { start_time: string; end_time: string }[];
}

// Cached current profile + ADMIN user directory, used to enrich participant
// identity that the interview payloads themselves do not carry.
let _selfCache: User | null = null;
let _directoryCache: Record<string, User> | null = null;

export function setCachedProfile(user: User | null) {
  _selfCache = user;
}

async function loadDirectory(): Promise<Record<string, User>> {
  if (_directoryCache) return _directoryCache;
  try {
    const [candidates, panelists] = await Promise.all([
      request<User[]>("/users?role=CANDIDATE"),
      request<User[]>("/users?role=PANELIST"),
    ]);
    const map: Record<string, User> = {};
    for (const u of [...candidates, ...panelists]) map[u.id] = u;
    _directoryCache = map;
  } catch (err) {
    // Non-ADMIN callers get 403 here — enrichment falls back to the caller's own
    // profile plus generic labels, which is all a candidate/panelist can see.
    // Cache the empty result only for a definite 403; let transient failures retry.
    const empty: Record<string, User> = {};
    if (err instanceof ApiClientError && err.statusCode === 403) {
      _directoryCache = empty;
    }
    return empty;
  }
  return _directoryCache;
}

function resolveName(id: string, dir: Record<string, User>, fallback: string): string {
  return dir[id]?.name ?? (_selfCache?.id === id ? _selfCache.name : fallback);
}
function resolveEmail(id: string, dir: Record<string, User>): string {
  return dir[id]?.email ?? (_selfCache?.id === id ? _selfCache.email : "");
}
function resolveTimezone(id: string, dir: Record<string, User>): string {
  return dir[id]?.timezone ?? (_selfCache?.id === id ? _selfCache.timezone : "UTC");
}

function adaptEvent(e: BackendInterviewEvent): InterviewEvent {
  return {
    id: e.id,
    interview_id: e.interview_request_id,
    start_time: e.start_time,
    end_time: e.end_time,
    calendar_event_id: e.calendar_event_id,
    meeting_link: e.meeting_link,
    provider: e.provider ?? "GOOGLE",
    status: e.status === "CANCELLED" ? "CANCELLED" : "CONFIRMED",
    created_at: e.created_at,
  };
}

function adaptAvailability(a: BackendAvailability): CandidateAvailability {
  return {
    id: a.id,
    interview_id: a.interview_request_id,
    timezone: a.timezone,
    submitted_at: a.submitted_at,
    windows: a.windows.map((w) => ({
      start_time: w.start_time,
      end_time: w.end_time,
    })),
  };
}

function adaptInterview(
  raw: BackendInterview,
  dir: Record<string, User>
): InterviewRequest {
  const panelists: InterviewParticipant[] = raw.participants
    .filter((p) => p.role_in_interview === "PANELIST")
    .map((p) => ({
      id: p.user_id,
      user_id: p.user_id,
      name: resolveName(p.user_id, dir, "Panelist"),
      email: resolveEmail(p.user_id, dir),
      role: "PANELIST",
      timezone: dir[p.user_id]?.timezone,
      calendar_status: (p.calendar_status as InterviewParticipant["calendar_status"]) ?? undefined,
      response_status: p.response_status,
    }));
  const candidateParticipant = raw.participants.find(
    (p) => p.role_in_interview === "CANDIDATE"
  );

  return {
    id: raw.id,
    candidate_id: raw.candidate_id,
    candidate_name: resolveName(raw.candidate_id, dir, "Candidate"),
    candidate_email: resolveEmail(raw.candidate_id, dir),
    candidate_timezone: resolveTimezone(raw.candidate_id, dir),
    candidate_response_status: candidateParticipant?.response_status,
    title: raw.title ?? null,
    company: raw.company ?? null,
    round_type: raw.round_type,
    duration_minutes: raw.duration_minutes,
    buffer_minutes: raw.buffer_minutes,
    status: raw.status,
    outcome: raw.outcome ?? null,
    outcome_notes: raw.outcome_notes ?? null,
    round_number: raw.round_number ?? 1,
    parent_request_id: raw.parent_request_id ?? null,
    panelists,
    created_at: raw.created_at,
    latest_recommendations: raw.recommended_slots ?? null,
    event: raw.booked_event ? adaptEvent(raw.booked_event) : null,
  };
}

/* =========================================================
   DEMO MODE
   ─────────────────────────────────────────────────────────
   Activated only when NEXT_PUBLIC_DEMO_MODE="true". Provides
   synthetic auth + data so the UI runs with no backend.
========================================================= */
const IS_DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

type DemoRole = "ADMIN" | "PANELIST" | "CANDIDATE";

function demoRoleFromEmail(email: string): DemoRole {
  const lower = email.toLowerCase();
  if (lower.includes("admin")) return "ADMIN";
  if (lower.includes("panelist") || lower.includes("panel")) return "PANELIST";
  return "CANDIDATE";
}

function buildDemoUser(email: string, name?: string, role?: DemoRole): User {
  const resolvedRole = role ?? demoRoleFromEmail(email);
  const displayName =
    name ??
    email
      .split("@")[0]
      .replace(/[._-]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  return {
    id: `demo_${resolvedRole.toLowerCase()}_001`,
    email,
    name: displayName,
    role: resolvedRole,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    calendar_status: undefined,
  };
}

function buildDemoTokens(role: DemoRole, email = `${role.toLowerCase()}@demo.local`): AuthTokens {
  return {
    access_token: `demo_access_${role.toLowerCase()}`,
    refresh_token: `demo_refresh_${role.toLowerCase()}`,
    token_type: "bearer",
    user: {
      id: `demo_${role.toLowerCase()}_001`,
      role,
      email,
      name: `Demo ${role}`,
    },
  };
}

/* =========================================================
   AUTHENTICATION API
========================================================= */
export const authApi = {
  async register(payload: {
    email: string;
    password: string;
    name: string;
    timezone: string;
  }): Promise<{ id: string; email: string; name: string; role: string }> {
    if (IS_DEMO_MODE) {
      const user = buildDemoUser(payload.email, payload.name, "CANDIDATE");
      return { id: user.id, email: user.email, name: user.name, role: user.role };
    }
    // Backend creates a CANDIDATE regardless of any role hint and returns no
    // token — the caller logs in immediately afterwards.
    return request<{ id: string; email: string; name: string; role: string }>(
      "/auth/register",
      { method: "POST", body: JSON.stringify(payload) }
    );
  },

  /**
   * First-ADMIN web bootstrap. Sends the shared secret in the X-Bootstrap-Token
   * header. The backend only allows this while zero ADMIN users exist and 404s
   * when ADMIN_BOOTSTRAP_TOKEN is unset — the frontend just surfaces the error.
   */
  async bootstrapAdmin(payload: {
    email: string;
    password: string;
    name: string;
    timezone: string;
    bootstrap_token: string;
  }): Promise<AuthTokens> {
    if (IS_DEMO_MODE) {
      const tokens = buildDemoTokens("ADMIN", payload.email);
      storeTokens(tokens);
      if (typeof window !== "undefined") {
        localStorage.setItem(
          "sis_demo_user",
          JSON.stringify(buildDemoUser(payload.email, payload.name, "ADMIN"))
        );
      }
      return tokens;
    }
    const { bootstrap_token, ...body } = payload;
    const tokens = await request<AuthTokens>("/auth/bootstrap-admin", {
      method: "POST",
      headers: { "X-Bootstrap-Token": bootstrap_token },
      body: JSON.stringify(body),
    });
    storeTokens(tokens);
    return tokens;
  },

  async login(payload: { email: string; password: string }): Promise<AuthTokens> {
    if (IS_DEMO_MODE) {
      const role = demoRoleFromEmail(payload.email);
      const user = buildDemoUser(payload.email, undefined, role);
      const tokens = buildDemoTokens(role);
      storeTokens(tokens);
      if (typeof window !== "undefined") {
        localStorage.setItem("sis_demo_user", JSON.stringify(user));
      }
      return tokens;
    }
    const tokens = await request<AuthTokens>("/auth/login", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    storeTokens(tokens);
    return tokens;
  },

  async logout(): Promise<void> {
    clearStoredTokens();
  },
};

/* =========================================================
   INVITATIONS API

   No demo-mode fallback: this feature has no offline fixture data and is
   implemented directly against the real backend contract (app/invitations/,
   backend commit `415cf18`). Every call below hits the live API.
========================================================= */
export const invitationsApi = {
  /** ADMIN. Issues one invitation per current participant, or rotates
   * (resends) the token for anyone who already has one. */
  async issue(requestId: string): Promise<InvitationSummary[]> {
    return request<InvitationSummary[]>(`/interviews/${requestId}/invitations`, {
      method: "POST",
    });
  },

  /** ADMIN. Current invitation state per participant — no invite_url, per
   * the backend's own design (the link isn't recoverable outside a resend). */
  async list(requestId: string): Promise<InvitationRecord[]> {
    return request<InvitationRecord[]>(`/interviews/${requestId}/invitations`);
  },

  /** Public — no auth. The token itself is the credential. */
  async getByToken(token: string): Promise<InvitationPublic> {
    return request<InvitationPublic>(`/invitations/${encodeURIComponent(token)}`);
  },

  /** Public — no auth. */
  async respond(
    token: string,
    payload: InvitationRespondPayload
  ): Promise<InvitationPublic> {
    return request<InvitationPublic>(
      `/invitations/${encodeURIComponent(token)}/respond`,
      { method: "POST", body: JSON.stringify(payload) }
    );
  },

  /** Public — no auth beyond the token. Stores the returned tokens exactly
   * like authApi.login/bootstrapAdmin so the existing refresh/session flow
   * picks them up unchanged. */
  async claimAccount(token: string, payload: ClaimAccountPayload): Promise<AuthTokens> {
    const tokens = await request<AuthTokens>(
      `/invitations/${encodeURIComponent(token)}/claim-account`,
      { method: "POST", body: JSON.stringify(payload) }
    );
    storeTokens(tokens);
    return tokens;
  },
};

/* =========================================================
   IN-MEMORY DEMO DATA (STANDALONE FRONTEND EXECUTION)
========================================================= */
const DEMO_USERS: User[] = [
  {
    id: "demo_candidate_001",
    name: "Alex Rivera",
    email: "alex.rivera@example.com",
    role: "CANDIDATE",
    timezone: "America/New_York",
  },
  {
    id: "demo_candidate_002",
    name: "Samantha Chen",
    email: "samantha.chen@example.com",
    role: "CANDIDATE",
    timezone: "America/Los_Angeles",
  },
  {
    id: "demo_panelist_001",
    name: "Devon Vance",
    email: "devon.vance@workday.internal",
    role: "PANELIST",
    timezone: "America/New_York",
    calendar_status: "CONNECTED",
  },
  {
    id: "demo_panelist_002",
    name: "Marcus Aurelius",
    email: "marcus.aurelius@workday.internal",
    role: "PANELIST",
    timezone: "America/Chicago",
    calendar_status: "CONNECTED",
  },
  {
    id: "demo_admin_001",
    name: "Sarah Jenkins (Admin)",
    email: "admin@demo.local",
    role: "ADMIN",
    timezone: "America/New_York",
  },
];

let DEMO_INTERVIEWS: InterviewRequest[] = [
  {
    id: "int-101",
    candidate_id: "demo_candidate_001",
    candidate_name: "Alex Rivera",
    candidate_email: "alex.rivera@example.com",
    candidate_timezone: "America/New_York",
    round_type: "TECHNICAL",
    duration_minutes: 60,
    buffer_minutes: 15,
    status: "READY_FOR_SCHEDULING",
    panelists: [
      {
        id: "p-1",
        user_id: "demo_panelist_001",
        name: "Devon Vance",
        email: "devon.vance@workday.internal",
        role: "PANELIST",
        calendar_status: "CONNECTED",
      },
      {
        id: "p-2",
        user_id: "demo_panelist_002",
        name: "Marcus Aurelius",
        email: "marcus.aurelius@workday.internal",
        role: "PANELIST",
        calendar_status: "CONNECTED",
      },
    ],
    created_at: new Date(Date.now() - 172800000).toISOString(),
    availability: {
      id: "avail-1",
      interview_id: "int-101",
      timezone: "America/New_York",
      submitted_at: new Date().toISOString(),
      windows: [
        {
          id: "win-1",
          start_time: new Date(Date.now() + 86400000).toISOString(),
          end_time: new Date(Date.now() + 100800000).toISOString(),
        },
      ],
    },
    latest_recommendations: [
      {
        id: "rec-slot-1",
        start_time: new Date(Date.now() + 90000000).toISOString(),
        end_time: new Date(Date.now() + 93600000).toISOString(),
        total_score: 0.94,
        rank: 1,
        explanation: "Optimal panelist overlap, buffer safety intact, minimal fatigue.",
        score_breakdown: {
          timezone_fairness: 0.95,
          working_hours_comfort: 0.92,
          scheduling_proximity: 0.96,
          workload_balance: 0.91,
          buffer_quality: 0.97,
        },
      },
      {
        id: "rec-slot-2",
        start_time: new Date(Date.now() + 97200000).toISOString(),
        end_time: new Date(Date.now() + 100800000).toISOString(),
        total_score: 0.88,
        rank: 2,
        explanation: "Comfortable slot with full panel availability.",
        score_breakdown: {
          timezone_fairness: 0.89,
          working_hours_comfort: 0.85,
          scheduling_proximity: 0.9,
          workload_balance: 0.86,
          buffer_quality: 0.92,
        },
      },
    ],
  },
  {
    id: "int-102",
    candidate_id: "demo_candidate_002",
    candidate_name: "Samantha Chen",
    candidate_email: "samantha.chen@example.com",
    candidate_timezone: "America/Los_Angeles",
    round_type: "MANAGERIAL",
    duration_minutes: 45,
    buffer_minutes: 15,
    status: "BOOKED",
    panelists: [
      {
        id: "p-3",
        user_id: "demo_panelist_001",
        name: "Devon Vance",
        email: "devon.vance@workday.internal",
        role: "PANELIST",
        calendar_status: "CONNECTED",
      },
    ],
    event: {
      id: "evt-102",
      interview_id: "int-102",
      calendar_event_id: "cal-evt-google-102",
      start_time: new Date(Date.now() + 172800000).toISOString(),
      end_time: new Date(Date.now() + 175500000).toISOString(),
      meeting_link: "https://meet.google.com/abc-defg-hij",
      status: "CONFIRMED",
    },
    created_at: new Date(Date.now() - 259200000).toISOString(),
  },
];

/* =========================================================
   USERS API
========================================================= */
export const usersApi = {
  async getMe(): Promise<User> {
    if (IS_DEMO_MODE) {
      const token = getStoredAccessToken();
      if (token?.startsWith("demo_")) {
        if (typeof window !== "undefined") {
          const stored = localStorage.getItem("sis_demo_user");
          if (stored) {
            try {
              return JSON.parse(stored) as User;
            } catch {
              // fall through
            }
          }
        }
        const role: DemoRole = token.includes("admin")
          ? "ADMIN"
          : token.includes("panelist")
          ? "PANELIST"
          : "CANDIDATE";
        return buildDemoUser(`${role.toLowerCase()}@demo.local`, undefined, role);
      }
    }
    const me = await request<User>("/users/me");
    _selfCache = me;
    return me;
  },

  async getCandidates(): Promise<User[]> {
    if (IS_DEMO_MODE) {
      return DEMO_USERS.filter((u) => u.role === "CANDIDATE");
    }
    return request<User[]>("/users?role=CANDIDATE");
  },

  async getPanelists(): Promise<User[]> {
    if (IS_DEMO_MODE) {
      return DEMO_USERS.filter((u) => u.role === "PANELIST");
    }
    return request<User[]>("/users?role=PANELIST");
  },

  /** ADMIN-only: archive / restore a CANDIDATE. Reversible; history is kept and
   * the account is hidden from pickers + blocked from login while archived. */
  async archive(userId: string): Promise<void> {
    await request(`/users/${userId}/archive`, { method: "POST" });
    _directoryCache = null; // the candidate list changed
  },
  async unarchive(userId: string): Promise<void> {
    await request(`/users/${userId}/unarchive`, { method: "POST" });
    _directoryCache = null;
  },

  /** ADMIN-only: POST /users. Idempotent on (email, role); throws ApiClientError
   * with code ROLE_CONFLICT (422) if the email exists under a different role. */
  async provision(payload: ProvisionUserPayload): Promise<ProvisionedUser> {
    if (IS_DEMO_MODE) {
      const existing = DEMO_USERS.find(
        (u) => u.email.toLowerCase() === payload.email.toLowerCase()
      );
      if (existing) {
        if (existing.role !== payload.role) {
          throw new ApiClientError(
            `${payload.email} already exists as ${existing.role}.`,
            "ROLE_CONFLICT",
            422
          );
        }
        return { ...existing, created: false };
      }
      const newUser: ProvisionedUser = {
        id: `demo_${payload.role.toLowerCase()}_${Date.now()}`,
        email: payload.email,
        name: payload.name,
        role: payload.role,
        timezone: payload.timezone,
        created: true,
      };
      DEMO_USERS.push(newUser);
      return newUser;
    }
    const result = await request<ProvisionedUser>("/users", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    // Keep the interview-detail enrichment directory in sync so a POST /interviews
    // that immediately follows resolves this person's name/email instead of
    // falling back to a generic label (the directory only refetches on cache miss).
    if (_directoryCache) {
      _directoryCache[result.id] = {
        id: result.id,
        email: result.email,
        name: result.name,
        role: result.role,
        timezone: result.timezone,
      };
    }
    return result;
  },
};

/* =========================================================
   CALENDAR API
========================================================= */
export const calendarApi = {
  async getStatus(): Promise<CalendarStatusResponse> {
    if (IS_DEMO_MODE) {
      return {
        status: "CONNECTED",
        last_synced_at: new Date().toISOString(),
        panelist_name: "Demo User",
      };
    }
    return request<CalendarStatusResponse>("/calendar/status");
  },

  async connect(): Promise<{ authorization_url: string }> {
    if (IS_DEMO_MODE) {
      return { authorization_url: "/calendar/connected" };
    }
    return request<{ authorization_url: string }>("/calendar/connect", {
      method: "POST",
    });
  },
};

/* =========================================================
   INTERVIEWS API
========================================================= */
export const interviewsApi = {
  async list(page = 0, size = 20): Promise<PaginatedResponse<InterviewRequest>> {
    if (IS_DEMO_MODE) {
      return {
        items: DEMO_INTERVIEWS,
        page,
        size,
        total: DEMO_INTERVIEWS.length,
      };
    }
    const [raw, dir] = await Promise.all([
      request<PaginatedResponse<BackendInterview>>(
        `/interviews?page=${page}&size=${size}`
      ),
      loadDirectory(),
    ]);
    return {
      ...raw,
      items: raw.items.map((i) => adaptInterview(i, dir)),
    };
  },

  async getById(id: string): Promise<InterviewRequest> {
    if (IS_DEMO_MODE) {
      const match = DEMO_INTERVIEWS.find((i) => i.id === id);
      return match || DEMO_INTERVIEWS[0];
    }
    const [raw, dir] = await Promise.all([
      request<BackendInterview>(`/interviews/${id}`),
      loadDirectory(),
    ]);
    const interview = adaptInterview(raw, dir);
    // Candidate availability lives on its own endpoint (404 before submission).
    try {
      const avail = await request<BackendAvailability>(
        `/interviews/${id}/availability`
      );
      interview.availability = adaptAvailability(avail);
    } catch {
      interview.availability = null;
    }
    return interview;
  },

  async create(payload: CreateInterviewPayload): Promise<InterviewRequest> {
    if (IS_DEMO_MODE) {
      const candidate = DEMO_USERS.find((u) => u.id === payload.candidate_id) || DEMO_USERS[0];
      const selectedPanels = DEMO_USERS.filter((u) => payload.panelist_ids.includes(u.id)).map((p, idx) => ({
        id: `p-${idx + 10}`,
        user_id: p.id,
        name: p.name,
        email: p.email,
        role: p.role,
        calendar_status: p.calendar_status,
      }));

      const newInterview: InterviewRequest = {
        id: `int-${Date.now().toString().slice(-4)}`,
        candidate_id: candidate.id,
        candidate_name: candidate.name,
        candidate_email: candidate.email,
        candidate_timezone: candidate.timezone,
        title: payload.title ?? null,
        company: payload.company ?? null,
        round_type: payload.round_type,
        duration_minutes: payload.duration_minutes,
        buffer_minutes: payload.buffer_minutes,
        status: "AWAITING_CANDIDATE_AVAILABILITY",
        panelists: selectedPanels,
        created_at: new Date().toISOString(),
      };
      DEMO_INTERVIEWS = [newInterview, ...DEMO_INTERVIEWS];
      return newInterview;
    }
    const [raw, dir] = await Promise.all([
      request<BackendInterview>("/interviews", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
      loadDirectory(),
    ]);
    return adaptInterview(raw, dir);
  },

  async update(id: string, payload: Partial<CreateInterviewPayload>): Promise<InterviewRequest> {
    if (IS_DEMO_MODE) {
      const existing = DEMO_INTERVIEWS.find((i) => i.id === id) || DEMO_INTERVIEWS[0];
      return existing;
    }
    const [raw, dir] = await Promise.all([
      request<BackendInterview>(`/interviews/${id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),
      loadDirectory(),
    ]);
    return adaptInterview(raw, dir);
  },

  // --- Phase 9 lifecycle (live backend only; no demo fixtures) --------------
  // POST /interviews/{id}/decline  — an assigned PANELIST withdraws.
  async decline(id: string, reason?: string): Promise<LifecycleStatusResponse> {
    return request<LifecycleStatusResponse>(`/interviews/${id}/decline`, {
      method: "POST",
      body: JSON.stringify({ reason: reason || null }),
    });
  },

  // POST /interviews/{id}/reschedule  — ADMIN or the owning CANDIDATE; requires BOOKED.
  async reschedule(id: string, reason?: string): Promise<LifecycleStatusResponse> {
    return request<LifecycleStatusResponse>(`/interviews/${id}/reschedule`, {
      method: "POST",
      body: JSON.stringify({ reason: reason || null }),
    });
  },

  // POST /interviews/{id}/cancel  — ADMIN; any non-terminal request.
  async cancel(id: string, reason?: string): Promise<LifecycleStatusResponse> {
    return request<LifecycleStatusResponse>(`/interviews/${id}/cancel`, {
      method: "POST",
      body: JSON.stringify({ reason: reason || null }),
    });
  },

  // GET /interviews/{id}/audit  — ADMIN; newest first.
  async getAudit(id: string, page = 0, size = 50): Promise<PaginatedResponse<AuditEntry>> {
    return request<PaginatedResponse<AuditEntry>>(
      `/interviews/${id}/audit?page=${page}&size=${size}`
    );
  },

  // POST /interviews/{id}/outcome  — ADMIN; PASSED / REJECTED / NO_SHOW.
  async recordOutcome(id: string, payload: RecordOutcomePayload): Promise<InterviewRequest> {
    const [raw, dir] = await Promise.all([
      request<BackendInterview>(`/interviews/${id}/outcome`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
      loadDirectory(),
    ]);
    return adaptInterview(raw, dir);
  },

  // POST /interviews/{id}/next-round  — ADMIN; parent must be COMPLETED + PASSED.
  async nextRound(id: string, payload: NextRoundPayload): Promise<InterviewRequest> {
    const [raw, dir] = await Promise.all([
      request<BackendInterview>(`/interviews/${id}/next-round`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
      loadDirectory(),
    ]);
    return adaptInterview(raw, dir);
  },

  // GET /interviews/{id}/notifications  — ADMIN; confirmation/reminder/lifecycle emails.
  async getNotifications(id: string): Promise<NotificationLogEntry[]> {
    return request<NotificationLogEntry[]>(`/interviews/${id}/notifications`);
  },

  // POST /interviews/{id}/send-reminder  — ADMIN; demo-friendly reminder trigger.
  async sendReminder(id: string): Promise<{ delivery_status: string; to: string; cc: string[] }> {
    return request(`/interviews/${id}/send-reminder`, { method: "POST" });
  },
};

/* =========================================================
   CANDIDATE AVAILABILITY API
========================================================= */
export const availabilityApi = {
  async submit(
    interviewId: string,
    payload: SubmitAvailabilityPayload
  ): Promise<CandidateAvailability> {
    if (IS_DEMO_MODE) {
      const avail: CandidateAvailability = {
        id: `avail-${Date.now()}`,
        interview_id: interviewId,
        timezone: payload.timezone,
        windows: payload.windows.map((w, idx) => ({ id: `win-${idx}`, ...w })),
        submitted_at: new Date().toISOString(),
      };
      const interview = DEMO_INTERVIEWS.find((i) => i.id === interviewId);
      if (interview) {
        interview.availability = avail;
        interview.status = "READY_FOR_SCHEDULING";
      }
      return avail;
    }
    const raw = await request<BackendAvailability>(
      `/interviews/${interviewId}/candidate-availability`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    );
    return adaptAvailability(raw);
  },

  async get(interviewId: string): Promise<CandidateAvailability> {
    if (IS_DEMO_MODE) {
      const interview = DEMO_INTERVIEWS.find((i) => i.id === interviewId);
      if (interview?.availability) return interview.availability;
      return {
        id: "demo_avail",
        interview_id: interviewId,
        timezone: "America/New_York",
        submitted_at: new Date().toISOString(),
        windows: [
          {
            start_time: new Date(Date.now() + 86400000).toISOString(),
            end_time: new Date(Date.now() + 100800000).toISOString(),
          },
        ],
      };
    }
    const raw = await request<BackendAvailability>(
      `/interviews/${interviewId}/availability`
    );
    return adaptAvailability(raw);
  },
};

/* =========================================================
   SCHEDULING RECOMMENDATIONS API
========================================================= */
export const schedulingApi = {
  async getRecommendations(interviewId: string): Promise<RecommendationRun> {
    if (IS_DEMO_MODE) {
      const interview = DEMO_INTERVIEWS.find((i) => i.id === interviewId);
      const slots = interview?.latest_recommendations || [
        {
          id: "slot-rec-1",
          start_time: new Date(Date.now() + 90000000).toISOString(),
          end_time: new Date(Date.now() + 93600000).toISOString(),
          total_score: 0.94,
          rank: 1,
          explanation: "Optimal panelist overlap, buffer safety intact, minimal fatigue.",
          score_breakdown: {
            timezone_fairness: 0.95,
            working_hours_comfort: 0.92,
            scheduling_proximity: 0.96,
            workload_balance: 0.91,
            buffer_quality: 0.97,
          },
        },
      ];
      return {
        recommendation_run_id: `rec-run-${Date.now()}`,
        interview_id: interviewId,
        created_at: new Date().toISOString(),
        slots,
      };
    }
    // Backend response is { recommendation_run_id, slots: SlotOut[] } — SlotOut
    // matches RecommendedSlot exactly, so no per-slot adaptation is needed.
    return request<RecommendationRun>(`/interviews/${interviewId}/recommendations`, {
      method: "POST",
    });
  },
};

/* =========================================================
   BOOKING API
========================================================= */
export const bookingApi = {
  async bookSlot(interviewId: string, payload: BookSlotPayload): Promise<InterviewEvent> {
    if (IS_DEMO_MODE) {
      const interview = DEMO_INTERVIEWS.find((i) => i.id === interviewId);
      const slot = interview?.latest_recommendations?.find((s) => s.id === payload.recommended_slot_id);
      const event: InterviewEvent = {
        id: `evt-${Date.now()}`,
        interview_id: interviewId,
        start_time: slot?.start_time || new Date().toISOString(),
        end_time: slot?.end_time || new Date().toISOString(),
        calendar_event_id: `google-meet-evt-${Date.now()}`,
        meeting_link: "https://meet.google.com/demo-meet-link",
        status: "CONFIRMED",
        created_at: new Date().toISOString(),
      };
      if (interview) {
        interview.status = "BOOKED";
        interview.event = event;
      }
      return event;
    }
    const raw = await request<BackendInterviewEvent>(
      `/interviews/${interviewId}/book`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    );
    return adaptEvent(raw);
  },
};
