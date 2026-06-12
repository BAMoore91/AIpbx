// ─── Core / Tenant ───────────────────────────────────────────────────────────

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  domain: string;
  plan: string;
  max_extensions: number;
  max_concurrent_calls: number;
  settings: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// ─── Auth ────────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  tenant_id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: 'superadmin' | 'admin' | 'supervisor' | 'agent' | 'viewer';
  mfa_enabled: boolean;
  avatar_url?: string;
  is_active: boolean;
  last_login_at?: string;
  created_at: string;
  updated_at: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  user: User;
}

// ─── Extensions ──────────────────────────────────────────────────────────────

export type ExtensionType = 'sip' | 'webrtc' | 'virtual';
export type RecordingMode = 'disabled' | 'on_demand' | 'always';

export interface Extension {
  id: string;
  tenant_id: string;
  user_id?: string;
  extension: string;
  display_name: string;
  sip_username: string;
  sip_password: string;
  type: ExtensionType;
  transport: string;
  codecs: string[];
  voicemail_enabled: boolean;
  vm_pin?: string;
  call_recording: RecordingMode;
  dnd: boolean;
  forward_always?: string;
  forward_busy?: string;
  forward_noanswer?: string;
  ring_timeout: number;
  max_contacts: number;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// ─── Trunks ──────────────────────────────────────────────────────────────────

export type TrunkAuthType = 'userpass' | 'ip' | 'none';

export interface Trunk {
  id: string;
  tenant_id: string;
  name: string;
  provider: string;
  host: string;
  port: number;
  transport: string;
  auth_type: TrunkAuthType;
  username?: string;
  secret?: string;
  from_domain?: string;
  from_user?: string;
  register: boolean;
  codecs: string[];
  max_channels: number;
  caller_id?: string;
  is_active: boolean;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// ─── DID Numbers ─────────────────────────────────────────────────────────────

export type DestType = 'extension' | 'ring_group' | 'queue' | 'ivr_menu' | 'time_condition' | 'ai_agent' | 'voicemail' | 'external';

export interface DIDNumber {
  id: string;
  tenant_id: string;
  trunk_id?: string;
  e164: string;
  label?: string;
  dest_type: DestType;
  dest_id?: string;
  cnam?: string;
  is_active: boolean;
  created_at: string;
}

// ─── Outbound Routes ─────────────────────────────────────────────────────────

export interface OutboundRoute {
  id: string;
  tenant_id: string;
  name: string;
  pattern: string;
  trunk_id: string;
  prepend?: string;
  strip: number;
  caller_id?: string;
  priority: number;
  created_at: string;
}

// ─── Ring Groups ─────────────────────────────────────────────────────────────

export type RingStrategy = 'ringall' | 'roundrobin' | 'leastrecent' | 'fewestcalls' | 'random';

export interface RingGroup {
  id: string;
  tenant_id: string;
  number: string;
  name: string;
  strategy: RingStrategy;
  members: string[];
  ring_timeout: number;
  fail_dest_type?: DestType;
  fail_dest_id?: string;
  created_at: string;
}

// ─── Queues ──────────────────────────────────────────────────────────────────

export interface Queue {
  id: string;
  tenant_id: string;
  number: string;
  name: string;
  strategy: RingStrategy;
  music_on_hold?: string;
  max_wait: number;
  max_callers: number;
  announce_position: boolean;
  announce_frequency: number;
  wrapup_time: number;
  service_level: number;
  timeout_dest_type?: DestType;
  timeout_dest_id?: string;
  settings: Record<string, unknown>;
  created_at: string;
}

export interface QueueMember {
  id: string;
  queue_id: string;
  extension_id: string;
  penalty: number;
  paused: boolean;
  created_at: string;
}

export interface QueueStats {
  queue_id: string;
  waiting: number;
  active: number;
  agents_available: number;
  agents_paused: number;
  calls_today: number;
  answered_today: number;
  abandoned_today: number;
  avg_wait_seconds: number;
  avg_talk_seconds: number;
  service_level_pct: number;
}

// ─── IVR Menus ───────────────────────────────────────────────────────────────

export type GreetingType = 'tts' | 'file';

export interface IVROption {
  key: string;
  dest_type: DestType;
  dest_id: string;
  label?: string;
}

export interface IVRMenu {
  id: string;
  tenant_id: string;
  number: string;
  name: string;
  greeting_type: GreetingType;
  greeting_text?: string;
  greeting_audio?: string;
  timeout: number;
  max_retries: number;
  invalid_dest_type?: DestType;
  invalid_dest_id?: string;
  timeout_dest_type?: DestType;
  timeout_dest_id?: string;
  options: IVROption[];
  created_at: string;
}

// ─── Time Conditions ─────────────────────────────────────────────────────────

export interface TimeRule {
  days: number[];
  start_time: string;
  end_time: string;
}

export interface TimeCondition {
  id: string;
  tenant_id: string;
  name: string;
  timezone: string;
  rules: TimeRule[];
  match_dest_type?: DestType;
  match_dest_id?: string;
  nomatch_dest_type?: DestType;
  nomatch_dest_id?: string;
  holidays: string[];
  created_at: string;
}

// ─── AI Agents ───────────────────────────────────────────────────────────────

export type AIModel = 'claude-opus-4-8' | 'claude-haiku-4-5' | 'claude-sonnet-4-6';
export type STTProvider = 'deepgram' | 'whisper' | 'google';
export type TTSProvider = 'elevenlabs' | 'deepgram' | 'google' | 'aws';

export interface AIAgentTools {
  lookup_caller: boolean;
  book_appointment: boolean;
  send_sms: boolean;
  transfer_call: boolean;
  take_message: boolean;
  check_availability: boolean;
}

export interface AIAgent {
  id: string;
  tenant_id: string;
  name: string;
  number?: string;
  role: string;
  model: AIModel;
  system_prompt: string;
  greeting: string;
  voice_id?: string;
  stt_provider: STTProvider;
  tts_provider: TTSProvider;
  language: string;
  temperature_effort: number;
  interruptible: boolean;
  max_turns: number;
  end_keywords: string[];
  tools: AIAgentTools;
  knowledge_base_id?: string;
  fallback_dest_type?: DestType;
  fallback_dest_id?: string;
  is_active: boolean;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// ─── Knowledge Bases ─────────────────────────────────────────────────────────

export interface KnowledgeBase {
  id: string;
  tenant_id: string;
  name: string;
  description?: string;
  created_at: string;
}

export interface KBDocument {
  id: string;
  kb_id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  status: 'pending' | 'processing' | 'ready' | 'error';
  created_at: string;
}

// ─── Calls (CDR) ─────────────────────────────────────────────────────────────

export type CallDirection = 'inbound' | 'outbound' | 'internal';
export type CallStatus = 'ringing' | 'answered' | 'no_answer' | 'busy' | 'failed' | 'voicemail';
export type CallDisposition = 'answered' | 'no_answer' | 'busy' | 'failed' | 'voicemail';
export type SentimentLabel = 'positive' | 'neutral' | 'negative';

export interface Call {
  id: string;
  tenant_id: string;
  channel_id?: string;
  linkedid?: string;
  direction: CallDirection;
  from_number: string;
  from_name?: string;
  to_number: string;
  did?: string;
  status: CallStatus;
  disposition: CallDisposition;
  handled_by?: string;
  ai_agent_id?: string;
  queue_id?: string;
  started_at: string;
  answered_at?: string;
  ended_at?: string;
  ring_seconds?: number;
  talk_seconds?: number;
  hold_seconds?: number;
  hangup_cause?: string;
  recording_id?: string;
  sentiment?: SentimentLabel;
  sentiment_score?: number;
  summary?: string;
  tags: string[];
  cost?: number;
  metadata: Record<string, unknown>;
  created_at: string;
}

// ─── Recordings ──────────────────────────────────────────────────────────────

export interface Recording {
  id: string;
  tenant_id: string;
  call_id: string;
  s3_key: string;
  format: string;
  duration: number;
  size_bytes: number;
  transcribed: boolean;
  created_at: string;
  // Joined
  download_url?: string;
}

// ─── Transcripts ─────────────────────────────────────────────────────────────

export interface TranscriptTurn {
  role: 'caller' | 'agent' | 'ai';
  text: string;
  start_time: number;
  end_time?: number;
  sentiment?: SentimentLabel;
}

export interface Transcript {
  id: string;
  call_id: string;
  turns: TranscriptTurn[];
  full_text: string;
  language: string;
  created_at: string;
}

// ─── Voicemails ──────────────────────────────────────────────────────────────

export interface Voicemail {
  id: string;
  tenant_id: string;
  extension: string;
  call_id?: string;
  from_number: string;
  s3_key: string;
  duration: number;
  transcription?: string;
  is_read: boolean;
  created_at: string;
  // Joined
  download_url?: string;
}

// ─── Messages ────────────────────────────────────────────────────────────────

export interface Message {
  id: string;
  tenant_id: string;
  channel: string;
  direction: 'inbound' | 'outbound';
  from_addr: string;
  to_addr: string;
  body: string;
  status: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

// ─── Webhooks ────────────────────────────────────────────────────────────────

export interface Webhook {
  id: string;
  tenant_id: string;
  url: string;
  events: string[];
  secret?: string;
  is_active: boolean;
  created_at: string;
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

export interface DashboardStats {
  active_calls: number;
  calls_today: number;
  answered_today: number;
  missed_today: number;
  avg_handle_time: number;
  queue_sla_pct: number;
  sentiment_breakdown: {
    positive: number;
    neutral: number;
    negative: number;
  };
  calls_by_hour: Array<{ hour: string; calls: number; answered: number }>;
  top_queues: Array<{ name: string; waiting: number; sla: number }>;
}

// ─── Live WebSocket Events ────────────────────────────────────────────────────

export interface WSEvent {
  type: 'call.started' | 'call.updated' | 'call.ended' | 'presence.changed' | 'queue.stats';
  payload: unknown;
}

export interface LiveCall {
  id: string;
  channel_id: string;
  direction: CallDirection;
  from_number: string;
  from_name?: string;
  to_number: string;
  status: CallStatus;
  started_at: string;
  answered_at?: string;
  queue_id?: string;
  extension_id?: string;
  duration_seconds: number;
}

export interface PresenceEvent {
  extension_id: string;
  extension: string;
  status: 'available' | 'busy' | 'dnd' | 'away' | 'offline';
}

// ─── Pagination ──────────────────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

export interface ListParams {
  page?: number;
  per_page?: number;
  search?: string;
  sort_by?: string;
  sort_dir?: 'asc' | 'desc';
  [key: string]: unknown;
}

// ─── Reports ─────────────────────────────────────────────────────────────────

export interface ReportRow {
  label: string;
  value: number | string;
  change?: number;
}

export interface Report {
  id: string;
  title: string;
  period: string;
  rows: ReportRow[];
  generated_at: string;
}
