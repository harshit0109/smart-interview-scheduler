import {
  AuthTokens,
  User,
  CalendarStatusResponse,
  InterviewRequest,
  CreateInterviewPayload,
  SubmitAvailabilityPayload,
  BookSlotPayload,
  InterviewEvent,
  RecommendationRun,
  PaginatedResponse,
  ApiErrorResponse,
  CandidateAvailability,
} from "./types";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000/api/v1";

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

// Token storage helpers
export function getStoredAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("sis_access_token");
}

export function getStoredRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("sis_refresh_token");
}

export function storeTokens(tokens: AuthTokens) {
  if (typeof window === "undefined") return;
  localStorage.setItem("sis_access_token", tokens.access_token);
  localStorage.setItem("sis_refresh_token", tokens.refresh_token);
}

export function clearStoredTokens() {
  if (typeof window === "undefined") return;
  localStorage.removeItem("sis_access_token");
  localStorage.removeItem("sis_refresh_token");
  localStorage.removeItem("sis_demo_user");
}

let isRefreshing = false;
let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = getStoredRefreshToken();
  if (!refreshToken) return null;

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

    const data: AuthTokens = await res.json();
    storeTokens(data);
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

    // Handle 401 Unauthorized with single token refresh retry
    if (res.status === 401 && retry) {
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
   DEMO MODE
   ─────────────────────────────────────────────────────────
   Activated only when NEXT_PUBLIC_DEMO_MODE="true" in the
   local environment. Provides synthetic auth responses so
   the UI can be explored without a running FastAPI backend.
   Scheduling, booking, and calendar APIs remain fully real
   (they will surface errors when backend is unavailable).
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
    role: "ADMIN" | "PANELIST" | "CANDIDATE";
    timezone: string;
  }): Promise<User> {
    if (IS_DEMO_MODE) {
      const user = buildDemoUser(payload.email, payload.name, payload.role);
      const tokens = buildDemoTokens(payload.role);
      storeTokens(tokens);
      if (typeof window !== "undefined") {
        localStorage.setItem("sis_demo_user", JSON.stringify(user));
      }
      return user;
    }
    return request<User>("/auth/register", {
      method: "POST",
      body: JSON.stringify(payload),
    });
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

  async googleLogin(idToken: string): Promise<AuthTokens> {
    if (IS_DEMO_MODE) {
      // Default Google demo sign-in to ADMIN role
      const user = buildDemoUser("admin@demo.local", "Demo Admin", "ADMIN");
      const tokens = buildDemoTokens("ADMIN");
      storeTokens(tokens);
      if (typeof window !== "undefined") {
        localStorage.setItem("sis_demo_user", JSON.stringify(user));
      }
      return tokens;
    }
    const tokens = await request<AuthTokens>("/auth/google", {
      method: "POST",
      body: JSON.stringify({ id_token: idToken }),
    });
    storeTokens(tokens);
    return tokens;
  },

  async logout(): Promise<void> {
    clearStoredTokens();
  },
};

/* =========================================================
   IN-MEMORY DEMO DATA (FOR STANDALONE FRONTEND EXECUTION)
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
        // Derive role from token shape as fallback
        const role: DemoRole = token.includes("admin")
          ? "ADMIN"
          : token.includes("panelist")
          ? "PANELIST"
          : "CANDIDATE";
        return buildDemoUser(`${role.toLowerCase()}@demo.local`, undefined, role);
      }
    }
    return request<User>("/users/me");
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
      return { authorization_url: "/calendar/callback?code=demo_code&state=demo_state" };
    }
    return request<{ authorization_url: string }>("/calendar/connect", {
      method: "POST",
    });
  },

  async handleCallback(code: string, state: string): Promise<CalendarStatusResponse> {
    if (IS_DEMO_MODE) {
      return {
        status: "CONNECTED",
        last_synced_at: new Date().toISOString(),
        panelist_name: "Demo User",
      };
    }
    return request<CalendarStatusResponse>(
      `/calendar/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`
    );
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
    return request<PaginatedResponse<InterviewRequest>>(
      `/interviews?page=${page}&size=${size}`
    );
  },

  async getById(id: string): Promise<InterviewRequest> {
    if (IS_DEMO_MODE) {
      const match = DEMO_INTERVIEWS.find((i) => i.id === id);
      if (match) return match;
      return DEMO_INTERVIEWS[0];
    }
    return request<InterviewRequest>(`/interviews/${id}`);
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
    return request<InterviewRequest>("/interviews", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  async update(id: string, payload: Partial<CreateInterviewPayload>): Promise<InterviewRequest> {
    if (IS_DEMO_MODE) {
      const existing = DEMO_INTERVIEWS.find((i) => i.id === id) || DEMO_INTERVIEWS[0];
      return existing;
    }
    return request<InterviewRequest>(`/interviews/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
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
    return request<CandidateAvailability>(
      `/interviews/${interviewId}/candidate-availability`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    );
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
    return request<CandidateAvailability>(`/interviews/${interviewId}/availability`);
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
    return request<InterviewEvent>(`/interviews/${interviewId}/book`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
};
