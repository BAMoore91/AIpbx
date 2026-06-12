# Access Roles & Departments (per-department RBAC)

Modeled on [3CX V20 access roles](https://www.3cx.com/docs/manual/access-roles/),
AIpbx grants permissions **per role, per department, per organization** — and,
unlike 3CX V20, the role→permission matrix is **customizable per tenant**
(the V18 behavior teams asked to keep).

## Two role planes

| Plane | Where | Roles | Scope |
|-------|-------|-------|-------|
| **System** | `users.role` | `admin` (System Owner), `supervisor` (System Admin), `agent`, `user` | Tenant-wide |
| **Department** | `department_members.role` | `owner`, `manager`, `receptionist`, `user` | One department |

A user has exactly one **system** role and may hold a **department** role in any
number of departments. `superadmin` is platform-wide (all permissions, every
tenant — see `MULTI_TENANCY.md`).

**Effective permission** for *(user, permission, department?)* =
the system role grants it **OR** the user's role in that department grants it.
Tenant-wide actions (no department) consider only the system role.

## Permission catalog

Grouped rights the matrix controls:

- **Visibility** — `switchboard.view`, `cdr.view`, `recordings.view`,
  `transcripts.view`, `chat.view`, `voicemail.view`
- **Administration** — `extensions.manage`, `users.manage`, `users.elevate`,
  `routing.manage`, `queues.manage`, `trunks.manage`, `ai.manage`
- **Organization** — `departments.manage`, `roles.manage`, `settings.manage`,
  `billing.view`

## Default matrix

| Permission (sample) | admin | supervisor | owner | manager | receptionist | user |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| switchboard.view | ✅ | ✅ | ✅ | ✅ | ✅ | – |
| cdr.view | ✅ | ✅ | ✅ | ✅ | ✅ | – |
| recordings.view | ✅ | – | ✅ | ✅ | – | – |
| extensions.manage | ✅ | ✅ | ✅ | – | – | – |
| users.manage / elevate | ✅ | ✅ / – | ✅ | ✅ | – | – |
| routing/queues/ai.manage | ✅ | ✅ | ✅ | queues | – | – |
| roles/settings/departments | ✅ | – | – | – | – | – |
| voicemail.view | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

- **admin** (System Owner) and department **owner** are always full and **not**
  customizable (mirrors 3CX). `supervisor`, `agent`, `user`, `manager`, and
  `receptionist` are customizable per tenant.

## Enforcement

- **Management writes** (extensions, trunks, routing, queues, AI, …) require the
  matching `*.manage` permission.
- **Sensitive reads are department-scoped.** A user without tenant-wide
  `cdr.view` / `recordings.view` sees only calls/recordings for departments
  where their department role grants it. Calls are tagged with the
  `department_id` of the extension/queue/agent/IVR/DID that handled them.
- `recordings/:id/download` re-checks `recordings.view` against the call's
  department.

## Departments

`departments` are org sub-units (3CX "groups"). Resources
(extensions, queues, ring groups, IVRs, AI agents, DIDs) carry an optional
`department_id`; `NULL` = org-wide/unassigned (visible only to system roles
that hold the permission tenant-wide).

## API

All under `/api`, tenant-scoped (a superadmin can target a tenant with
`X-Tenant-Id`).

**Effective permissions (any user — used by the console to gate UI):**
```
GET /api/access/me
→ { superadmin, systemRole, global: [perm…], byDepartment: { <deptId>: [perm…] } }
```

**Role matrix editor (requires `roles.manage`):**
```
GET    /api/access/matrix                     # catalog + per-role effective sets + editable flags
PUT    /api/access/matrix/system/supervisor   # { "permissions": ["cdr.view", ...] }
PUT    /api/access/matrix/department/manager   { "permissions": [ ... ] }
DELETE /api/access/matrix/department/manager  # reset to defaults
```

**Departments (requires `departments.manage` to mutate):**
```
GET/POST       /api/departments
GET/PATCH/DELETE /api/departments/:id
PUT            /api/departments/:id/members            # { user_id, role }
DELETE         /api/departments/:id/members/:userId
```

Tag a resource to a department by setting `department_id` on create/update,
e.g. `POST /api/extensions { …, "department_id": "<deptId>" }`.

### Example — a Sales manager who can only see Sales

```bash
# 1. Create the department
curl -X POST $API/departments -H "$ADMIN" -d '{"name":"Sales"}'      # → dept_sales

# 2. Make Dana the Sales manager
curl -X PUT  $API/departments/dept_sales/members -H "$ADMIN" \
     -d '{"user_id":"<dana>","role":"manager"}'

# 3. Tag the Sales queue & extensions to the department
curl -X PATCH $API/queues/<q> -H "$ADMIN" -d '{"department_id":"dept_sales"}'
```

Dana (system role `agent`, Sales `manager`) can now see Sales CDR + recordings
and manage Sales users — and nothing in other departments.

## Migration

Fresh installs get this from `db/schema.sql`. Existing databases:

```bash
psql "$DATABASE_URL" -f db/migrations/002_departments_rbac.sql
```
