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
    created_at: new Date().toISOString(),
  };
}

function buildDemoTokens(role: DemoRole): AuthTokens {
  return {
    access_token: `demo_access_${role.toLowerCase()}`,
    refresh_token: `demo_refresh_${role.toLowerCase()}`,
    token_type: "bearer",
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
    return request<User[]>("/users?role=CANDIDATE");
  },

  async getPanelists(): Promise<User[]> {
    return request<User[]>("/users?role=PANELIST");
  },
};

/* =========================================================
   CALENDAR API
========================================================= */
export const calendarApi = {
  async getStatus(): Promise<CalendarStatusResponse> {
    return request<CalendarStatusResponse>("/calendar/status");
  },

  async connect(): Promise<{ authorization_url: string }> {
    return request<{ authorization_url: string }>("/calendar/connect", {
      method: "POST",
    });
  },

  async handleCallback(code: string, state: string): Promise<CalendarStatusResponse> {
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
    return request<PaginatedResponse<InterviewRequest>>(
      `/interviews?page=${page}&size=${size}`
    );
  },

  async getById(id: string): Promise<InterviewRequest> {
    return request<InterviewRequest>(`/interviews/${id}`);
  },

  async create(payload: CreateInterviewPayload): Promise<InterviewRequest> {
    return request<InterviewRequest>("/interviews", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  async update(id: string, payload: Partial<CreateInterviewPayload>): Promise<InterviewRequest> {
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
    return request<CandidateAvailability>(
      `/interviews/${interviewId}/candidate-availability`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    );
  },

  async get(interviewId: string): Promise<CandidateAvailability> {
    return request<CandidateAvailability>(`/interviews/${interviewId}/availability`);
  },
};

/* =========================================================
   SCHEDULING RECOMMENDATIONS API
========================================================= */
export const schedulingApi = {
  async getRecommendations(interviewId: string): Promise<RecommendationRun> {
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
    return request<InterviewEvent>(`/interviews/${interviewId}/book`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
};
