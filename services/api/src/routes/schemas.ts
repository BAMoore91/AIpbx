import { z } from 'zod';

/** Zod schemas for create/update payloads, mirroring db/schema.sql columns. */

const destType = z.enum(['extension', 'ivr', 'queue', 'ring_group', 'ai_agent', 'voicemail']);

export const userCreate = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  // 'superadmin' is intentionally NOT assignable via the tenant user API — that
  // would be cross-tenant privilege escalation. Superadmins are created only via
  // the bootstrap/CLI (see bootstrap.ts).
  role: z.enum(['admin', 'supervisor', 'agent', 'user']).default('agent'),
  is_active: z.boolean().default(true),
});
export const userUpdate = z.object({
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  role: z.enum(['admin', 'supervisor', 'agent', 'user']).optional(),
  is_active: z.boolean().optional(),
  avatar_url: z.string().url().optional(),
  password: z.string().min(8).optional(),
  mfa_enabled: z.boolean().optional(),
});

export const extensionCreate = z.object({
  department_id: z.string().uuid().nullable().optional(),
  extension: z.string().min(1),
  display_name: z.string().optional(),
  sip_username: z.string().min(1),
  sip_password: z.string().min(6),
  user_id: z.string().uuid().optional(),
  type: z.enum(['softphone', 'webrtc', 'desk', 'ai_agent']).default('softphone'),
  transport: z.string().default('transport-udp'),
  codecs: z.array(z.string()).optional(),
  voicemail_enabled: z.boolean().default(true),
  vm_pin: z.string().optional(),
  call_recording: z.enum(['always', 'on-demand', 'never']).default('on-demand'),
  dnd: z.boolean().default(false),
  forward_always: z.string().optional(),
  forward_busy: z.string().optional(),
  forward_noanswer: z.string().optional(),
  ring_timeout: z.number().int().positive().default(25),
  max_contacts: z.number().int().positive().default(3),
});
export const extensionUpdate = extensionCreate.partial();

export const trunkCreate = z.object({
  name: z.string().min(1),
  provider: z.string().optional(),
  host: z.string().min(1),
  port: z.number().int().default(5060),
  transport: z.string().default('udp'),
  auth_type: z.enum(['userpass', 'ip']).default('userpass'),
  username: z.string().optional(),
  secret: z.string().optional(),
  from_domain: z.string().optional(),
  from_user: z.string().optional(),
  register: z.boolean().default(true),
  codecs: z.array(z.string()).optional(),
  max_channels: z.number().int().default(30),
  caller_id: z.string().optional(),
  is_active: z.boolean().default(true),
});
export const trunkUpdate = trunkCreate.partial();

export const didCreate = z.object({
  department_id: z.string().uuid().nullable().optional(),
  trunk_id: z.string().uuid().optional(),
  e164: z.string().min(2),
  label: z.string().optional(),
  dest_type: destType.default('extension'),
  dest_id: z.string().optional(),
  cnam: z.string().optional(),
  is_active: z.boolean().default(true),
});
export const didUpdate = didCreate.partial();

export const outboundRouteCreate = z.object({
  name: z.string().min(1),
  pattern: z.string().min(1),
  trunk_id: z.string().uuid(),
  prepend: z.string().default(''),
  strip: z.number().int().default(0),
  caller_id: z.string().optional(),
  priority: z.number().int().default(100),
});
export const outboundRouteUpdate = outboundRouteCreate.partial();

export const ringGroupCreate = z.object({
  department_id: z.string().uuid().nullable().optional(),
  number: z.string().min(1),
  name: z.string().min(1),
  strategy: z.enum(['ringall', 'hunt', 'memoryhunt', 'random']).default('ringall'),
  members: z.array(z.string()).default([]),
  ring_timeout: z.number().int().default(25),
  fail_dest_type: z.string().optional(),
  fail_dest_id: z.string().optional(),
});
export const ringGroupUpdate = ringGroupCreate.partial();

export const queueCreate = z.object({
  department_id: z.string().uuid().nullable().optional(),
  number: z.string().min(1),
  name: z.string().min(1),
  strategy: z.enum(['ringall', 'leastrecent', 'fewestcalls', 'rrmemory', 'linear']).default('rrmemory'),
  music_on_hold: z.string().default('default'),
  max_wait: z.number().int().default(300),
  max_callers: z.number().int().default(50),
  announce_position: z.boolean().default(true),
  announce_frequency: z.number().int().default(30),
  wrapup_time: z.number().int().default(10),
  service_level: z.number().int().default(60),
  timeout_dest_type: z.string().optional(),
  timeout_dest_id: z.string().optional(),
});
export const queueUpdate = queueCreate.partial();

export const queueMemberCreate = z.object({
  extension: z.string().min(1),
  penalty: z.number().int().default(0),
  paused: z.boolean().default(false),
});

export const ivrCreate = z.object({
  department_id: z.string().uuid().nullable().optional(),
  number: z.string().min(1),
  name: z.string().min(1),
  greeting_type: z.enum(['tts', 'upload', 'ai']).default('tts'),
  greeting_text: z.string().optional(),
  greeting_audio: z.string().optional(),
  timeout: z.number().int().default(5),
  max_retries: z.number().int().default(3),
  invalid_dest_type: z.string().optional(),
  invalid_dest_id: z.string().optional(),
  timeout_dest_type: z.string().optional(),
  timeout_dest_id: z.string().optional(),
  options: z.record(z.object({ type: destType, id: z.string() })).default({}),
});
export const ivrUpdate = ivrCreate.partial();

export const timeConditionCreate = z.object({
  name: z.string().min(1),
  timezone: z.string().default('UTC'),
  rules: z.array(z.object({ days: z.array(z.string()), start: z.string(), end: z.string() })).default([]),
  match_dest_type: z.string().optional(),
  match_dest_id: z.string().optional(),
  nomatch_dest_type: z.string().optional(),
  nomatch_dest_id: z.string().optional(),
  holidays: z.array(z.string()).default([]),
});
export const timeConditionUpdate = timeConditionCreate.partial();

export const aiAgentCreate = z.object({
  department_id: z.string().uuid().nullable().optional(),
  name: z.string().min(1),
  number: z.string().optional(),
  role: z.enum(['receptionist', 'sales', 'support', 'survey', 'outbound']).default('receptionist'),
  model: z.string().default('claude-opus-4-8'),
  system_prompt: z.string().min(1),
  greeting: z.string().optional(),
  voice_id: z.string().optional(),
  stt_provider: z.string().default('deepgram'),
  tts_provider: z.string().default('elevenlabs'),
  language: z.string().default('en'),
  temperature_effort: z.enum(['low', 'medium', 'high']).default('low'),
  interruptible: z.boolean().default(true),
  max_turns: z.number().int().default(40),
  end_keywords: z.array(z.string()).optional(),
  tools: z.array(z.unknown()).default([]),
  knowledge_base_id: z.string().uuid().optional(),
  fallback_dest_type: z.string().optional(),
  fallback_dest_id: z.string().optional(),
  is_active: z.boolean().default(true),
});
export const aiAgentUpdate = aiAgentCreate.partial();

export const knowledgeBaseCreate = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
});
export const knowledgeBaseUpdate = knowledgeBaseCreate.partial();

export const kbDocumentCreate = z.object({
  title: z.string().optional(),
  source: z.string().optional(),
  content: z.string().min(1),
  chunk_index: z.number().int().default(0),
});

export const webhookCreate = z.object({
  url: z.string().url(),
  events: z.array(z.string()).default([]),
  secret: z.string().optional(),
  is_active: z.boolean().default(true),
});
export const webhookUpdate = webhookCreate.partial();

export const messageCreate = z.object({
  channel: z.enum(['sms', 'chat']).default('sms'),
  direction: z.enum(['inbound', 'outbound']).default('outbound'),
  from_addr: z.string().optional(),
  to_addr: z.string().min(1),
  body: z.string().min(1),
});
