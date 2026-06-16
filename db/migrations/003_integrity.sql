-- ============================================================================
-- Migration 003 — integrity hardening (production audit)
-- Idempotent; safe on existing databases.
--   psql "$DATABASE_URL" -f db/migrations/003_integrity.sql
-- ============================================================================

-- 1. trunks.department_id — the TS type referenced it but the column was missing.
ALTER TABLE trunks ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_trunk_dept ON trunks(department_id);

-- 2. Index the hot auth path (every access-token validation looks up by hash).
CREATE INDEX IF NOT EXISTS idx_refresh_token_hash ON refresh_tokens(token_hash);

-- 3. Foreign keys that were bare UUIDs (orphan prevention).
DO $$ BEGIN
  ALTER TABLE calls ADD CONSTRAINT calls_recording_fk
    FOREIGN KEY (recording_id) REFERENCES recordings(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE ai_agents ADD CONSTRAINT ai_agents_kb_fk
    FOREIGN KEY (knowledge_base_id) REFERENCES knowledge_bases(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 4. Enum CHECK constraints (defense vs direct DB writes that bypass app zod).
DO $$ BEGIN
  ALTER TABLE extensions ADD CONSTRAINT extensions_call_recording_chk
    CHECK (call_recording IN ('always','on-demand','never'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE extensions ADD CONSTRAINT extensions_type_chk
    CHECK (type IN ('softphone','webrtc','desk','ai_agent'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE trunks ADD CONSTRAINT trunks_auth_type_chk
    CHECK (auth_type IN ('userpass','ip','none'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_role_chk
    CHECK (role IN ('superadmin','admin','supervisor','agent','user'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE calls ADD CONSTRAINT calls_direction_chk
    CHECK (direction IN ('inbound','outbound','internal'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 5. audit_logs should survive tenant deletion (compliance) — SET NULL not CASCADE.
DO $$ BEGIN
  ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_tenant_id_fkey;
  ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE SET NULL;
EXCEPTION WHEN others THEN NULL; END $$;
