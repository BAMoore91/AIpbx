-- =============================================================================
-- AIpbx — Initial Database Seed
-- =============================================================================
-- Run this AFTER the schema migrations have been applied.
--
-- Usage (from host, inside DEPLOY_DIR):
--   docker compose exec -T postgres psql \
--     -U ${POSTGRES_USER} -d ${POSTGRES_DB} \
--     -f /path/to/seed.sql
--
-- Or from inside the postgres container:
--   psql -U aipbx -d aipbx -f /docker-entrypoint-initdb.d/seed.sql
--
-- This script is idempotent — safe to run multiple times.
-- =============================================================================

-- Default tenant is already created by schema.sql:
--   id  = '00000000-0000-0000-0000-000000000001'
--   name = 'Default'
--   slug = 'default'

-- =============================================================================
-- Default Admin User
-- =============================================================================
-- IMPORTANT: The password_hash below is a PLACEHOLDER.
--
-- It is NOT a valid argon2id hash and will NOT authenticate.
--
-- After seeding, set the admin password using one of these methods:
--
--   Method A (API — recommended):
--     POST /api/auth/reset-password  { "email": "admin@pbx.example.com" }
--     (triggers an email with a reset link)
--
--   Method B (direct DB update — use openssl or the API service to generate):
--     UPDATE users
--       SET password_hash = '<real argon2id hash>'
--     WHERE email = 'admin@pbx.example.com';
--
--   Method C (CLI — if argon2 is installed on host):
--     echo -n "YourPassword" | argon2 "$(openssl rand -hex 16)" \
--       -id -v 19 -k 65536 -t 3 -p 4 -e
--
-- Replace "admin@pbx.example.com" with your actual admin email address.
-- =============================================================================
INSERT INTO users (
    id,
    tenant_id,
    email,
    password_hash,
    first_name,
    last_name,
    role,
    is_active,
    created_at,
    updated_at
)
VALUES (
    gen_random_uuid(),
    '00000000-0000-0000-0000-000000000001',
    'admin@pbx.example.com',
    -- !! PLACEHOLDER — NOT A REAL HASH — RESET THIS IMMEDIATELY !!
    '$argon2id$v=19$m=65536,t=3,p=4$PLACEHOLDER_RESET_VIA_API$PLACEHOLDER_RESET_VIA_API',
    'Admin',
    'User',
    'admin',
    true,
    now(),
    now()
)
ON CONFLICT (tenant_id, email) DO NOTHING;


-- =============================================================================
-- Demo Extensions
-- =============================================================================
-- NOTE: sip_password values below are PLAINTEXT PLACEHOLDERS.
-- In production, the API service encrypts SIP passwords with AES-256-GCM
-- before storing them.  If you insert via this seed, the application will
-- not be able to decrypt these values.
--
-- Use the API to create/update extensions so passwords are properly encrypted:
--   POST /api/extensions  { "extension": "1001", "display_name": "...", ... }
--
-- The entries below are provided so the seed does not leave the database empty.
-- =============================================================================

-- Extension 1001 — WebRTC softphone (e.g. for the admin user)
INSERT INTO extensions (
    id,
    tenant_id,
    user_id,
    extension,
    display_name,
    sip_username,
    sip_password,
    type,
    transport,
    codecs,
    voicemail_enabled,
    vm_pin,
    call_recording,
    dnd,
    forward_always,
    forward_busy,
    forward_noanswer,
    ring_timeout,
    max_contacts,
    settings,
    created_at,
    updated_at
)
SELECT
    gen_random_uuid(),
    '00000000-0000-0000-0000-000000000001',
    u.id,
    '1001',
    'Admin User',
    'ext1001',
    -- !! PLACEHOLDER — use API to set real encrypted password !!
    'CHANGEME_ENCRYPTED_BY_API',
    'webrtc',
    'wss',
    ARRAY['opus', 'ulaw', 'alaw'],
    true,
    '1234',
    'on-demand',
    false,
    NULL,
    NULL,
    NULL,
    30,
    5,
    '{}',
    now(),
    now()
FROM users u
WHERE u.email = 'admin@pbx.example.com'
  AND u.tenant_id = '00000000-0000-0000-0000-000000000001'
ON CONFLICT DO NOTHING;

-- Extension 1002 — standard softphone
INSERT INTO extensions (
    id,
    tenant_id,
    user_id,
    extension,
    display_name,
    sip_username,
    sip_password,
    type,
    transport,
    codecs,
    voicemail_enabled,
    vm_pin,
    call_recording,
    dnd,
    forward_always,
    forward_busy,
    forward_noanswer,
    ring_timeout,
    max_contacts,
    settings,
    created_at,
    updated_at
)
VALUES (
    gen_random_uuid(),
    '00000000-0000-0000-0000-000000000001',
    NULL,           -- not yet assigned to a user
    '1002',
    'Demo Phone 1002',
    'ext1002',
    -- !! PLACEHOLDER — use API to set real encrypted password !!
    'CHANGEME_ENCRYPTED_BY_API',
    'softphone',
    'udp',
    ARRAY['ulaw', 'alaw', 'g722'],
    true,
    '5678',
    'off',
    false,
    NULL,
    NULL,
    NULL,
    30,
    3,
    '{}',
    now(),
    now()
)
ON CONFLICT DO NOTHING;


-- =============================================================================
-- Demo AI Receptionist Agent
-- =============================================================================
-- Number 9000 is the AI receptionist.  Callers can dial 9000 from any
-- extension to test the AI agent, or inbound PSTN calls can be routed here
-- via an IVR or direct DID mapping.
--
-- Note: ai_agents has no unique constraint on the 'number' column, so we
-- guard against duplicate seeds with a WHERE NOT EXISTS check.
-- =============================================================================
INSERT INTO ai_agents (
    id,
    tenant_id,
    name,
    number,
    role,
    model,
    system_prompt,
    greeting,
    voice_id,
    stt_provider,
    tts_provider,
    language,
    temperature_effort,
    interruptible,
    max_turns,
    end_keywords,
    tools,
    knowledge_base_id,
    fallback_dest_type,
    fallback_dest_id,
    is_active,
    settings,
    created_at,
    updated_at
)
SELECT
    gen_random_uuid(),
    '00000000-0000-0000-0000-000000000001',
    'AI Receptionist',
    '9000',
    'receptionist',
    'claude-opus-4-8',
    -- System prompt for the AI receptionist
    $PROMPT$You are an AI phone receptionist for a business. Your job is to greet callers warmly, understand the reason for their call, and route them appropriately or take a message.

Guidelines:
- Speak naturally and conversationally, as if you are a real receptionist.
- Keep responses concise — phone conversations are different from text chat.
- Do not read out lists; instead, ask one question at a time.
- If a caller wants to reach an extension, offer to transfer them.
  - Extension 1001: Admin / Main Office
  - Extension 1002: Demo Department
- If you cannot help or the caller insists on a human agent, offer to transfer to extension 1001 or take a message.
- Take a message if the desired party is unavailable. Ask for: caller name, callback number, and a brief message.
- Always confirm details back to the caller before completing a transfer or message.
- Be professional, polite, and empathetic at all times.
- If a caller is distressed or the situation is urgent, prioritise transferring to a human immediately.
- Do not make up information about the business. If you do not know something, say so and offer to take a message.

When a caller wants to be transferred, use the transfer_call tool.
When a caller wants to leave a message, summarise the message clearly before ending the call.
$PROMPT$,
    'Thank you for calling. I''m your AI assistant. How can I help you today?',
    '21m00Tcm4TlvDq8ikWAM',   -- ElevenLabs default voice (Rachel)
    'deepgram',
    'elevenlabs',
    'en-US',
    'low',
    true,
    50,
    ARRAY['goodbye', 'bye', 'hang up', 'end call'],
    -- Tools available to this agent
    '[
        {
            "name": "transfer_call",
            "description": "Transfer the current call to a specified extension or phone number.",
            "parameters": {
                "type": "object",
                "properties": {
                    "destination": {
                        "type": "string",
                        "description": "The extension number or E.164 phone number to transfer to (e.g. \"1001\" or \"+15555551234\")."
                    },
                    "reason": {
                        "type": "string",
                        "description": "Brief reason for the transfer, logged in the call record."
                    },
                    "warm": {
                        "type": "boolean",
                        "description": "If true, perform a warm (attended) transfer; if false, perform a blind transfer. Default false."
                    }
                },
                "required": ["destination"]
            }
        },
        {
            "name": "lookup_caller",
            "description": "Look up information about the caller using their phone number.",
            "parameters": {
                "type": "object",
                "properties": {
                    "phone_number": {
                        "type": "string",
                        "description": "The caller''s phone number in E.164 format."
                    }
                },
                "required": ["phone_number"]
            }
        }
    ]'::jsonb,
    NULL,                   -- no knowledge base attached initially
    'extension',
    '1001',                 -- fallback: transfer to extension 1001 if AI fails
    true,
    '{}'::jsonb,
    now(),
    now()
WHERE NOT EXISTS (
    SELECT 1 FROM ai_agents
    WHERE tenant_id = '00000000-0000-0000-0000-000000000001'
      AND number = '9000'
);


-- =============================================================================
-- Confirmation
-- =============================================================================
DO $$
DECLARE
    user_count      int;
    ext_count       int;
    agent_count     int;
BEGIN
    SELECT count(*) INTO user_count  FROM users      WHERE tenant_id = '00000000-0000-0000-0000-000000000001';
    SELECT count(*) INTO ext_count   FROM extensions WHERE tenant_id = '00000000-0000-0000-0000-000000000001';
    SELECT count(*) INTO agent_count FROM ai_agents  WHERE tenant_id = '00000000-0000-0000-0000-000000000001';

    RAISE NOTICE 'Seed complete — users: %, extensions: %, ai_agents: %',
        user_count, ext_count, agent_count;
    RAISE NOTICE 'ACTION REQUIRED: Reset admin password for admin@pbx.example.com';
    RAISE NOTICE 'ACTION REQUIRED: Update extension SIP passwords via the API';
END;
$$;
