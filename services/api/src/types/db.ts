/**
 * TypeScript row types mirroring db/schema.sql.
 * Column names match the SQL exactly (snake_case) so query rows map cleanly.
 */

export type UUID = string;
export type ISODate = string;

export type UserRole =
  | 'superadmin'
  | 'admin'
  | 'supervisor'
  | 'agent'
  | 'user';

export type DestType =
  | 'extension'
  | 'ivr'
  | 'queue'
  | 'ring_group'
  | 'ai_agent'
  | 'voicemail';

export type CallStatus =
  | 'ringing'
  | 'answered'
  | 'in-progress'
  | 'hold'
  | 'ended';

export type CallDirection = 'inbound' | 'outbound' | 'internal';

export interface TenantRow {
  id: UUID;
  name: string;
  slug: string;
  domain: string | null;
  plan: string;
  max_extensions: number;
  max_concurrent_calls: number;
  settings: Record<string, unknown>;
  is_active: boolean;
  created_at: ISODate;
  updated_at: ISODate;
}

export interface UserRow {
  id: UUID;
  tenant_id: UUID;
  email: string;
  password_hash: string | null;
  first_name: string | null;
  last_name: string | null;
  role: UserRole;
  mfa_secret: string | null;
  mfa_enabled: boolean;
  avatar_url: string | null;
  is_active: boolean;
  last_login_at: ISODate | null;
  created_at: ISODate;
  updated_at: ISODate;
}

export interface RefreshTokenRow {
  id: UUID;
  user_id: UUID;
  token_hash: string;
  user_agent: string | null;
  ip: string | null;
  expires_at: ISODate;
  revoked_at: ISODate | null;
  created_at: ISODate;
}

export interface AuditLogRow {
  id: string;
  tenant_id: UUID | null;
  user_id: UUID | null;
  action: string;
  entity: string | null;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  ip: string | null;
  created_at: ISODate;
}

export interface ExtensionRow {
  id: UUID;
  tenant_id: UUID;
  user_id: UUID | null;
  extension: string;
  display_name: string | null;
  sip_username: string;
  sip_password: string;
  type: string;
  transport: string;
  codecs: string[];
  voicemail_enabled: boolean;
  vm_pin: string | null;
  call_recording: string;
  dnd: boolean;
  forward_always: string | null;
  forward_busy: string | null;
  forward_noanswer: string | null;
  ring_timeout: number;
  max_contacts: number;
  settings: Record<string, unknown>;
  created_at: ISODate;
  updated_at: ISODate;
}

export interface EndpointStatusRow {
  sip_username: string;
  state: string;
  contact_uri: string | null;
  user_agent: string | null;
  last_seen: ISODate | null;
}

export interface TrunkRow {
  id: UUID;
  tenant_id: UUID;
  name: string;
  provider: string | null;
  host: string;
  port: number;
  transport: string;
  auth_type: string;
  username: string | null;
  secret: string | null;
  from_domain: string | null;
  from_user: string | null;
  register: boolean;
  codecs: string[];
  max_channels: number;
  caller_id: string | null;
  is_active: boolean;
  settings: Record<string, unknown>;
  created_at: ISODate;
  updated_at: ISODate;
}

export interface DidNumberRow {
  id: UUID;
  tenant_id: UUID;
  trunk_id: UUID | null;
  e164: string;
  label: string | null;
  dest_type: DestType;
  dest_id: string | null;
  cnam: string | null;
  is_active: boolean;
  created_at: ISODate;
}

export interface OutboundRouteRow {
  id: UUID;
  tenant_id: UUID;
  name: string;
  pattern: string;
  trunk_id: UUID;
  prepend: string | null;
  strip: number | null;
  caller_id: string | null;
  priority: number;
  created_at: ISODate;
}

export interface RingGroupRow {
  id: UUID;
  tenant_id: UUID;
  number: string;
  name: string;
  strategy: string;
  members: string[];
  ring_timeout: number;
  fail_dest_type: string | null;
  fail_dest_id: string | null;
  created_at: ISODate;
}

export interface QueueRow {
  id: UUID;
  tenant_id: UUID;
  number: string;
  name: string;
  strategy: string;
  music_on_hold: string;
  max_wait: number;
  max_callers: number;
  announce_position: boolean;
  announce_frequency: number;
  wrapup_time: number;
  service_level: number;
  timeout_dest_type: string | null;
  timeout_dest_id: string | null;
  settings: Record<string, unknown>;
  created_at: ISODate;
}

export interface QueueMemberRow {
  id: UUID;
  queue_id: UUID;
  extension: string;
  penalty: number;
  paused: boolean;
  created_at: ISODate;
}

export interface IvrMenuRow {
  id: UUID;
  tenant_id: UUID;
  number: string;
  name: string;
  greeting_type: string;
  greeting_text: string | null;
  greeting_audio: string | null;
  timeout: number;
  max_retries: number;
  invalid_dest_type: string | null;
  invalid_dest_id: string | null;
  timeout_dest_type: string | null;
  timeout_dest_id: string | null;
  options: Record<string, { type: DestType; id: string }>;
  created_at: ISODate;
}

export interface TimeConditionRow {
  id: UUID;
  tenant_id: UUID;
  name: string;
  timezone: string;
  rules: Array<{ days: string[]; start: string; end: string }>;
  match_dest_type: string | null;
  match_dest_id: string | null;
  nomatch_dest_type: string | null;
  nomatch_dest_id: string | null;
  holidays: unknown[];
  created_at: ISODate;
}

export interface AiAgentRow {
  id: UUID;
  tenant_id: UUID;
  name: string;
  number: string | null;
  role: string;
  model: string;
  system_prompt: string;
  greeting: string | null;
  voice_id: string | null;
  stt_provider: string | null;
  tts_provider: string | null;
  language: string;
  temperature_effort: string;
  interruptible: boolean;
  max_turns: number;
  end_keywords: string[] | null;
  tools: unknown[];
  knowledge_base_id: UUID | null;
  fallback_dest_type: string | null;
  fallback_dest_id: string | null;
  is_active: boolean;
  settings: Record<string, unknown>;
  created_at: ISODate;
  updated_at: ISODate;
}

export interface KnowledgeBaseRow {
  id: UUID;
  tenant_id: UUID;
  name: string;
  description: string | null;
  created_at: ISODate;
}

export interface KbDocumentRow {
  id: UUID;
  kb_id: UUID;
  title: string | null;
  source: string | null;
  content: string;
  chunk_index: number;
  embedding: number[] | null;
  created_at: ISODate;
}

export interface CallRow {
  id: UUID;
  tenant_id: UUID;
  channel_id: string | null;
  linkedid: string | null;
  direction: CallDirection;
  from_number: string | null;
  from_name: string | null;
  to_number: string | null;
  did: string | null;
  status: CallStatus;
  disposition: string | null;
  handled_by: string | null;
  ai_agent_id: UUID | null;
  queue_id: UUID | null;
  started_at: ISODate;
  answered_at: ISODate | null;
  ended_at: ISODate | null;
  ring_seconds: number | null;
  talk_seconds: number | null;
  hold_seconds: number;
  hangup_cause: string | null;
  recording_id: UUID | null;
  sentiment: string | null;
  sentiment_score: number | null;
  summary: string | null;
  tags: string[] | null;
  cost: number | null;
  metadata: Record<string, unknown>;
  created_at: ISODate;
}

export interface RecordingRow {
  id: UUID;
  tenant_id: UUID;
  call_id: UUID | null;
  s3_key: string;
  format: string;
  duration: number | null;
  size_bytes: number | null;
  transcribed: boolean;
  created_at: ISODate;
}

export interface TranscriptRow {
  id: UUID;
  call_id: UUID;
  turns: Array<{ role: string; ts: number; text: string; speaker?: string }>;
  full_text: string | null;
  language: string | null;
  created_at: ISODate;
}

export interface VoicemailRow {
  id: UUID;
  tenant_id: UUID;
  extension: string;
  call_id: UUID | null;
  from_number: string | null;
  s3_key: string;
  duration: number | null;
  transcription: string | null;
  is_read: boolean;
  created_at: ISODate;
}

export interface MessageRow {
  id: UUID;
  tenant_id: UUID;
  channel: string;
  direction: string | null;
  from_addr: string | null;
  to_addr: string | null;
  body: string | null;
  status: string | null;
  metadata: Record<string, unknown>;
  created_at: ISODate;
}

export interface WebhookRow {
  id: UUID;
  tenant_id: UUID;
  url: string;
  events: string[];
  secret: string | null;
  is_active: boolean;
  created_at: ISODate;
}
