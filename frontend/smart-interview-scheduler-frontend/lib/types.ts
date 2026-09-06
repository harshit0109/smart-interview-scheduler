export type Role = "ADMIN" | "PANELIST" | "CANDIDATE";

export type RoundType = "SCREENING" | "TECHNICAL" | "MANAGERIAL" | "HR";

export type InterviewStatus =
  | "DRAFT"
  | "AWAITING_CANDIDATE_AVAILABILITY"
  | "READY_FOR_SCHEDULING"
  | "RECOMMENDED"
  | "BOOKED"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "RESCHEDULING";

export type CalendarStatus = "CONNECTED" | "EXPIRED" | "REVOKED" | "DISCONNECTED";

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  timezone: string;
  avatar_url?: string;
  calendar_status?: CalendarStatus;
}

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  token_type: string;
  user: {
    id: string;
    role: Role;
    email?: string;
    name?: string;
  };
}

export interface CalendarStatusResponse {
  status: CalendarStatus;
  last_synced_at: string | null;
  panelist_name?: string;
}

export interface ScoreBreakdown {
  timezone_fairness: number; // weight: 0.30
  working_hours_comfort: number; // weight: 0.20
  scheduling_proximity: number; // weight: 0.20
  workload_balance: number; // weight: 0.15
  buffer_quality: number; // weight: 0.15
}

export interface RecommendedSlot {
  id: string;
  start_time: string; // ISO8601
  end_time: string; // ISO8601
  total_score: number; // 0.0 - 1.0
  score_breakdown: ScoreBreakdown;
  explanation: string;
  rank: number;
}

export interface RecommendationRun {
  recommendation_run_id: string;
  // Backend RecommendationResponse returns only { recommendation_run_id, slots }.
  // These are kept optional for the demo fixtures / future use.
  interview_id?: string;
  created_at?: string;
  slots: RecommendedSlot[];
}

export interface AvailabilityWindow {
  id?: string;
  start_time: string; // ISO8601
  end_time: string; // ISO8601
}

export interface CandidateAvailability {
  id: string;
  interview_id: string;
  timezone: string;
  windows: AvailabilityWindow[];
  submitted_at: string;
}

export type ParticipantResponseStatus = "PENDING" | "ACCEPTED" | "DECLINED" | "UNAVAILABLE";

export interface InterviewParticipant {
  id: string;
  user_id: string;
  name: string;
  email: string;
  role: Role;
  timezone?: string;
  calendar_status?: CalendarStatus;
  response_status?: ParticipantResponseStatus;
}

export interface InterviewEvent {
  id: string;
  interview_id?: string;
  start_time: string;
  end_time: string;
  calendar_event_id: string;
  meeting_link?: string | null;
  status: "CONFIRMED" | "CANCELLED";
  created_at?: string;
}

export interface InterviewRequest {
  id: string;
  candidate_id: string;
  candidate_name: string;
  candidate_email: string;
  candidate_timezone: string;
  candidate_response_status?: ParticipantResponseStatus;
  title?: string | null;
  company?: string | null;
  round_type: RoundType;
  duration_minutes: number;
  buffer_minutes: number;
  status: InterviewStatus;
  panelists: InterviewParticipant[];
  created_at: string;
  updated_at?: string;
  availability?: CandidateAvailability | null;
  latest_recommendations?: RecommendedSlot[] | null;
  event?: InterviewEvent | null;
}

export interface CreateInterviewPayload {
  candidate_id: string;
  title?: string;
  company?: string;
  round_type: RoundType;
  duration_minutes: number;
  buffer_minutes: number;
  panelist_ids: string[];
}

/** Response of POST /interviews/{id}/decline|reschedule|cancel (Phase 9). */
export interface LifecycleStatusResponse {
  interview_request_status: string;
}

/** One row of GET /interviews/{id}/audit (ADMIN). */
export interface AuditEntry {
  id: string;
  actor_id: string | null;
  actor_role: string;
  action: string;
  entity_type: string;
  entity_id: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ProvisionUserPayload {
  email: string;
  name: string;
  role: "CANDIDATE" | "PANELIST";
  timezone: string;
}

export interface ProvisionedUser extends User {
  created: boolean;
}

export type InvitationStatus = "PENDING" | "ACCEPTED" | "DECLINED" | "UNAVAILABLE" | "EXPIRED";
export type InvitationDeliveryStatus = "SENT" | "SIMULATED" | "FAILED";
export type InvitationResponseValue = "ACCEPTED" | "DECLINED" | "UNAVAILABLE";

/** What GET /interviews/{id}/invitations returns per participant — no
 * invite_url; the link is only ever recoverable at issuance/resend time. */
export interface InvitationRecord {
  id: string;
  user_id: string;
  role: Role;
  status: InvitationStatus;
  requires_account_setup: boolean;
  delivery_status: InvitationDeliveryStatus | null;
  send_count: number;
  expires_at: string;
  responded_at: string | null;
}

/** What POST /interviews/{id}/invitations returns — carries invite_url once. */
export interface InvitationSummary extends Omit<InvitationRecord, "responded_at"> {
  invite_url: string;
}

/** What an unauthenticated recipient sees at GET /invitations/{token}. */
export interface InvitationPublic {
  role: Role;
  status: InvitationStatus;
  requires_account_setup: boolean;
  account_claimed: boolean;
  interview_title: string | null;
  round_type: RoundType;
  duration_minutes: number;
}

export interface InvitationRespondPayload {
  response: InvitationResponseValue;
  reason?: string;
}

export interface ClaimAccountPayload {
  password: string;
}

export interface SubmitAvailabilityPayload {
  timezone: string;
  windows: {
    start_time: string;
    end_time: string;
  }[];
}

export interface BookSlotPayload {
  recommended_slot_id: string;
}

export interface ApiErrorDetail {
  code: string;
  message: string;
  field_errors?: Record<string, string[]> | null;
  trace_id?: string;
}

export interface ApiErrorResponse {
  error: ApiErrorDetail;
}

export interface PaginatedResponse<T> {
  items: T[];
  page: number;
  size: number;
  total: number;
}
