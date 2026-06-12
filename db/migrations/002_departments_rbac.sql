-- ============================================================================
-- Migration 002 — Departments + per-department RBAC (3CX-style access roles)
-- Safe to run on an existing database. Idempotent.
--   psql "$DATABASE_URL" -f db/migrations/002_departments_rbac.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS departments (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    description     TEXT,
    manager_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    settings        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, name)
);
CREATE INDEX IF NOT EXISTS idx_dept_tenant ON departments(tenant_id);

CREATE TABLE IF NOT EXISTS department_members (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    department_id   UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role            TEXT NOT NULL DEFAULT 'user',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (department_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_deptmember_user ON department_members(user_id);
CREATE INDEX IF NOT EXISTS idx_deptmember_dept ON department_members(department_id);

CREATE TABLE IF NOT EXISTS role_permissions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    scope           TEXT NOT NULL,
    role            TEXT NOT NULL,
    permission      TEXT NOT NULL,
    allowed         BOOLEAN NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, scope, role, permission)
);
CREATE INDEX IF NOT EXISTS idx_roleperm_tenant ON role_permissions(tenant_id);

ALTER TABLE extensions  ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id) ON DELETE SET NULL;
ALTER TABLE queues      ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id) ON DELETE SET NULL;
ALTER TABLE ring_groups ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id) ON DELETE SET NULL;
ALTER TABLE ivr_menus   ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id) ON DELETE SET NULL;
ALTER TABLE ai_agents   ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id) ON DELETE SET NULL;
ALTER TABLE did_numbers ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id) ON DELETE SET NULL;
ALTER TABLE calls       ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_ext_dept   ON extensions(department_id);
CREATE INDEX IF NOT EXISTS idx_queue_dept ON queues(department_id);
CREATE INDEX IF NOT EXISTS idx_calls_dept ON calls(department_id);
