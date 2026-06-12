-- ============================================================================
-- AIpbx — PostgreSQL schema
-- Multi-tenant AI-powered PBX (3CX alternative) on an Asterisk core.
-- Apply with: psql "$DATABASE_URL" -f db/schema.sql
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ---------------------------------------------------------------------------
-- Tenancy & identity
-- ---------------------------------------------------------------------------
CREATE TABLE tenants (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            TEXT NOT NULL,
    slug            TEXT NOT NULL UNIQUE,
    domain          TEXT UNIQUE,                       -- SIP domain for the tenant
    plan            TEXT NOT NULL DEFAULT 'pro',        -- free|pro|enterprise
    max_extensions  INT NOT NULL DEFAULT 50,
    max_concurrent_calls INT NOT NULL DEFAULT 30,
    settings        JSONB NOT NULL DEFAULT '{}',
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email           TEXT NOT NULL,
    password_hash   TEXT,                               -- argon2id; null for SSO-only
    first_name      TEXT,
    last_name       TEXT,
    role            TEXT NOT NULL DEFAULT 'agent',       -- superadmin|admin|supervisor|agent|user
    mfa_secret      TEXT,
    mfa_enabled     BOOLEAN NOT NULL DEFAULT FALSE,
    avatar_url      TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, email)
);
CREATE INDEX idx_users_tenant ON users(tenant_id);

CREATE TABLE refresh_tokens (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash      TEXT NOT NULL,
    user_agent      TEXT,
    ip              INET,
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_refresh_user ON refresh_tokens(user_id);

CREATE TABLE audit_logs (
    id              BIGSERIAL PRIMARY KEY,
    tenant_id       UUID REFERENCES tenants(id) ON DELETE CASCADE,
    user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    action          TEXT NOT NULL,
    entity          TEXT,
    entity_id       TEXT,
    metadata        JSONB NOT NULL DEFAULT '{}',
    ip              INET,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_tenant_time ON audit_logs(tenant_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Extensions / SIP endpoints (PJSIP)
-- ---------------------------------------------------------------------------
CREATE TABLE extensions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    extension       TEXT NOT NULL,                       -- dialable number e.g. "1001"
    display_name    TEXT,
    sip_username    TEXT NOT NULL,                       -- PJSIP endpoint/aor name
    sip_password    TEXT NOT NULL,                       -- encrypted at rest
    type            TEXT NOT NULL DEFAULT 'softphone',   -- softphone|webrtc|desk|ai_agent
    transport       TEXT NOT NULL DEFAULT 'transport-udp',-- transport-udp|tls|wss
    codecs          TEXT[] NOT NULL DEFAULT ARRAY['opus','ulaw','alaw'],
    voicemail_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    vm_pin          TEXT,
    call_recording  TEXT NOT NULL DEFAULT 'on-demand',   -- always|on-demand|never
    dnd             BOOLEAN NOT NULL DEFAULT FALSE,
    forward_always  TEXT,                                 -- destination when set
    forward_busy    TEXT,
    forward_noanswer TEXT,
    ring_timeout    INT NOT NULL DEFAULT 25,
    max_contacts    INT NOT NULL DEFAULT 3,
    settings        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, extension),
    UNIQUE (sip_username)
);
CREATE INDEX idx_ext_tenant ON extensions(tenant_id);

-- Live registration / presence (updated by ARI/AMI events)
CREATE TABLE endpoint_status (
    sip_username    TEXT PRIMARY KEY REFERENCES extensions(sip_username) ON DELETE CASCADE,
    state           TEXT NOT NULL DEFAULT 'unavailable', -- available|ringing|inuse|busy|unavailable
    contact_uri     TEXT,
    user_agent      TEXT,
    last_seen       TIMESTAMPTZ
);

-- ---------------------------------------------------------------------------
-- SIP trunks (carriers / providers)
-- ---------------------------------------------------------------------------
CREATE TABLE trunks (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    provider        TEXT,                                 -- twilio|telnyx|bandwidth|generic
    host            TEXT NOT NULL,
    port            INT NOT NULL DEFAULT 5060,
    transport       TEXT NOT NULL DEFAULT 'udp',
    auth_type       TEXT NOT NULL DEFAULT 'userpass',     -- userpass|ip
    username        TEXT,
    secret          TEXT,                                 -- encrypted at rest
    from_domain     TEXT,
    from_user       TEXT,
    register        BOOLEAN NOT NULL DEFAULT TRUE,
    codecs          TEXT[] NOT NULL DEFAULT ARRAY['ulaw','alaw'],
    max_channels    INT NOT NULL DEFAULT 30,
    caller_id       TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    settings        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_trunk_tenant ON trunks(tenant_id);

-- DIDs / phone numbers, routed to a destination
CREATE TABLE did_numbers (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    trunk_id        UUID REFERENCES trunks(id) ON DELETE SET NULL,
    e164            TEXT NOT NULL,                        -- +15551234567
    label           TEXT,
    dest_type       TEXT NOT NULL DEFAULT 'extension',   -- extension|ivr|queue|ring_group|ai_agent|voicemail
    dest_id         TEXT,                                 -- id/number of destination
    cnam            TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (e164)
);
CREATE INDEX idx_did_tenant ON did_numbers(tenant_id);

-- Outbound routing rules (pattern -> trunk)
CREATE TABLE outbound_routes (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    pattern         TEXT NOT NULL,                        -- dialplan pattern e.g. _1NXXNXXXXXX
    trunk_id        UUID NOT NULL REFERENCES trunks(id) ON DELETE CASCADE,
    prepend         TEXT DEFAULT '',
    strip           INT DEFAULT 0,
    caller_id       TEXT,
    priority        INT NOT NULL DEFAULT 100,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_obroute_tenant ON outbound_routes(tenant_id, priority);

-- ---------------------------------------------------------------------------
-- Call routing primitives
-- ---------------------------------------------------------------------------
CREATE TABLE ring_groups (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    number          TEXT NOT NULL,
    name            TEXT NOT NULL,
    strategy        TEXT NOT NULL DEFAULT 'ringall',      -- ringall|hunt|memoryhunt|random
    members         TEXT[] NOT NULL DEFAULT '{}',         -- extension numbers
    ring_timeout    INT NOT NULL DEFAULT 25,
    fail_dest_type  TEXT DEFAULT 'voicemail',
    fail_dest_id    TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, number)
);

CREATE TABLE queues (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    number          TEXT NOT NULL,
    name            TEXT NOT NULL,
    strategy        TEXT NOT NULL DEFAULT 'rrmemory',     -- ringall|leastrecent|fewestcalls|rrmemory|linear
    music_on_hold   TEXT NOT NULL DEFAULT 'default',
    max_wait        INT NOT NULL DEFAULT 300,
    max_callers     INT NOT NULL DEFAULT 50,
    announce_position BOOLEAN NOT NULL DEFAULT TRUE,
    announce_frequency INT NOT NULL DEFAULT 30,
    wrapup_time     INT NOT NULL DEFAULT 10,
    service_level   INT NOT NULL DEFAULT 60,              -- SLA seconds
    timeout_dest_type TEXT DEFAULT 'voicemail',
    timeout_dest_id TEXT,
    settings        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, number)
);

CREATE TABLE queue_members (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    queue_id        UUID NOT NULL REFERENCES queues(id) ON DELETE CASCADE,
    extension       TEXT NOT NULL,
    penalty         INT NOT NULL DEFAULT 0,
    paused          BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (queue_id, extension)
);

-- IVR / auto-attendant menus (tree of nodes)
CREATE TABLE ivr_menus (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    number          TEXT NOT NULL,
    name            TEXT NOT NULL,
    greeting_type   TEXT NOT NULL DEFAULT 'tts',          -- tts|upload|ai
    greeting_text   TEXT,                                 -- TTS prompt
    greeting_audio  TEXT,                                 -- audio file / s3 key
    timeout         INT NOT NULL DEFAULT 5,
    max_retries     INT NOT NULL DEFAULT 3,
    invalid_dest_type TEXT,
    invalid_dest_id TEXT,
    timeout_dest_type TEXT,
    timeout_dest_id TEXT,
    options         JSONB NOT NULL DEFAULT '{}',          -- {"1":{"type":"queue","id":"..."}, ...}
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, number)
);

-- Time-based conditions (business hours routing)
CREATE TABLE time_conditions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    timezone        TEXT NOT NULL DEFAULT 'UTC',
    rules           JSONB NOT NULL DEFAULT '[]',          -- [{days,start,end}]
    match_dest_type TEXT,
    match_dest_id   TEXT,
    nomatch_dest_type TEXT,
    nomatch_dest_id TEXT,
    holidays        JSONB NOT NULL DEFAULT '[]',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- AI voice agents (the differentiator vs 3CX)
-- ---------------------------------------------------------------------------
CREATE TABLE ai_agents (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    number          TEXT,                                 -- internal dialable number
    role            TEXT NOT NULL DEFAULT 'receptionist', -- receptionist|sales|support|survey|outbound
    model           TEXT NOT NULL DEFAULT 'claude-opus-4-8',
    system_prompt   TEXT NOT NULL,
    greeting        TEXT,                                 -- spoken first line
    voice_id        TEXT,                                 -- TTS voice
    stt_provider    TEXT DEFAULT 'deepgram',
    tts_provider    TEXT DEFAULT 'elevenlabs',
    language        TEXT NOT NULL DEFAULT 'en',
    temperature_effort TEXT NOT NULL DEFAULT 'low',
    interruptible   BOOLEAN NOT NULL DEFAULT TRUE,        -- barge-in
    max_turns       INT NOT NULL DEFAULT 40,
    end_keywords    TEXT[] DEFAULT ARRAY['goodbye','bye'],
    tools           JSONB NOT NULL DEFAULT '[]',          -- enabled tool definitions
    knowledge_base_id UUID,
    fallback_dest_type TEXT DEFAULT 'extension',          -- human handoff target
    fallback_dest_id TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    settings        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_aiagent_tenant ON ai_agents(tenant_id);

CREATE TABLE knowledge_bases (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    description     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE kb_documents (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    kb_id           UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    title           TEXT,
    source          TEXT,
    content         TEXT NOT NULL,
    chunk_index     INT NOT NULL DEFAULT 0,
    embedding       JSONB,                                -- vector stored as JSON (pgvector optional)
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_kbdoc_kb ON kb_documents(kb_id);

-- ---------------------------------------------------------------------------
-- Calls, CDR, recordings, transcripts
-- ---------------------------------------------------------------------------
CREATE TABLE calls (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    channel_id      TEXT,                                 -- Asterisk channel uniqueid
    linkedid        TEXT,                                 -- call leg group
    direction       TEXT NOT NULL,                        -- inbound|outbound|internal
    from_number     TEXT,
    from_name       TEXT,
    to_number       TEXT,
    did             TEXT,
    status          TEXT NOT NULL DEFAULT 'ringing',      -- ringing|answered|in-progress|hold|ended
    disposition     TEXT,                                 -- answered|no-answer|busy|failed|abandoned
    handled_by      TEXT,                                 -- extension/ai_agent/queue handling it
    ai_agent_id     UUID REFERENCES ai_agents(id) ON DELETE SET NULL,
    queue_id        UUID REFERENCES queues(id) ON DELETE SET NULL,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    answered_at     TIMESTAMPTZ,
    ended_at        TIMESTAMPTZ,
    ring_seconds    INT,
    talk_seconds    INT,
    hold_seconds    INT NOT NULL DEFAULT 0,
    hangup_cause    TEXT,
    recording_id    UUID,
    sentiment       TEXT,                                 -- positive|neutral|negative
    sentiment_score NUMERIC(4,3),
    summary         TEXT,                                 -- AI post-call summary
    tags            TEXT[] DEFAULT '{}',
    cost            NUMERIC(10,4) DEFAULT 0,
    metadata        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_calls_tenant_time ON calls(tenant_id, started_at DESC);
CREATE INDEX idx_calls_channel ON calls(channel_id);
CREATE INDEX idx_calls_linked ON calls(linkedid);
CREATE INDEX idx_calls_status ON calls(tenant_id, status);

CREATE TABLE recordings (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    call_id         UUID REFERENCES calls(id) ON DELETE CASCADE,
    s3_key          TEXT NOT NULL,
    format          TEXT NOT NULL DEFAULT 'wav',
    duration        INT,
    size_bytes      BIGINT,
    transcribed     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_rec_call ON recordings(call_id);

CREATE TABLE transcripts (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    call_id         UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
    turns           JSONB NOT NULL DEFAULT '[]',          -- [{role,ts,text,speaker}]
    full_text       TEXT,
    language        TEXT DEFAULT 'en',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_transcript_call ON transcripts(call_id);
CREATE INDEX idx_transcript_fts ON transcripts USING gin (to_tsvector('english', coalesce(full_text,'')));

-- ---------------------------------------------------------------------------
-- Voicemail
-- ---------------------------------------------------------------------------
CREATE TABLE voicemails (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    extension       TEXT NOT NULL,
    call_id         UUID REFERENCES calls(id) ON DELETE SET NULL,
    from_number     TEXT,
    s3_key          TEXT NOT NULL,
    duration        INT,
    transcription   TEXT,
    is_read         BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_vm_tenant_ext ON voicemails(tenant_id, extension);

-- ---------------------------------------------------------------------------
-- Messaging (SMS / internal chat) — optional unified comms
-- ---------------------------------------------------------------------------
CREATE TABLE messages (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    channel         TEXT NOT NULL DEFAULT 'sms',          -- sms|chat
    direction       TEXT,                                 -- inbound|outbound
    from_addr       TEXT,
    to_addr         TEXT,
    body            TEXT,
    status          TEXT DEFAULT 'queued',
    metadata        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_msg_tenant_time ON messages(tenant_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Webhooks / integrations
-- ---------------------------------------------------------------------------
CREATE TABLE webhooks (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    url             TEXT NOT NULL,
    events          TEXT[] NOT NULL DEFAULT '{}',         -- call.started, call.ended, ...
    secret          TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Seed: default super-tenant + admin (password: ChangeMe123! — argon2 placeholder)
-- Replace the hash post-deploy via the API. See deploy/scripts/seed.sql.
-- ---------------------------------------------------------------------------
INSERT INTO tenants (id, name, slug, domain, plan, max_extensions, max_concurrent_calls)
VALUES ('00000000-0000-0000-0000-000000000001', 'Default', 'default', 'pbx.example.com', 'enterprise', 500, 200)
ON CONFLICT DO NOTHING;
