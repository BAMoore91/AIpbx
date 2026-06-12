# Multi-Tenancy

AIpbx is multi-tenant to the core: a single deployment serves many isolated
organizations (tenants), each with its own users, extensions, trunks, numbers,
AI agents, routing, recordings, and CDR. This document explains the model and
how to operate it.

## Model

```
Platform (one deployment)
└── Tenant (org)  ── plan, limits, SIP domain
    ├── Users (RBAC: admin / supervisor / agent / user)
    ├── Extensions ─ globally-unique sip_username, per-tenant extension number
    ├── Trunks · DIDs · Outbound routes
    ├── Queues · Ring groups · IVRs · Time conditions
    ├── AI agents · Knowledge bases
    └── Calls · Recordings · Transcripts · Voicemail
```

Every domain table carries a `tenant_id`, and **every API query is filtered by
the caller's effective tenant** (`request.auth.tenantId`), set once in the auth
plugin. There is no code path that returns cross-tenant data to a normal user.

## Roles

| Role | Scope |
|------|-------|
| `superadmin` | **Platform-wide.** Manages tenants; can act on any tenant. |
| `admin` | Full control **within their tenant**. |
| `supervisor` | Manage routing/queues/agents within their tenant. |
| `agent` / `user` | Use the phone, see their own data. |

`superadmin` is the only cross-tenant role. Create one by setting a user's
`role` to `superadmin` (e.g. promote the seeded default admin):

```sql
UPDATE users SET role = 'superadmin' WHERE email = 'admin@example.com';
```

## Isolation guarantees

- **Data**: all reads/writes are `WHERE tenant_id = $effectiveTenant`. The CRUD
  factory injects `tenant_id` on insert and scopes every select/update/delete.
- **SIP / telephony**: `extensions.sip_username` is **globally unique**, so the
  call engine resolves a call's tenant from the *calling endpoint* (the PJSIP
  channel name), never from the dialled extension number — which legitimately
  collides across tenants (every org can have a "1001"). Inbound calls resolve
  the tenant from the **DID**.
- **Secrets**: SIP/trunk credentials are encrypted at rest (AES-256-GCM).
- **Audit**: every mutation is written to `audit_logs` with the tenant + actor.

## Plan limits

Each tenant has a plan and enforced ceilings:

| Limit | Enforced where |
|-------|----------------|
| `max_extensions` | On extension create (409 when exceeded) |
| `max_concurrent_calls` | In the call engine — calls over the ceiling are rejected with congestion |
| Suspension (`is_active = false`) | The call engine rejects all calls for a suspended tenant |

Usage vs. limits is shown per tenant in **Platform → Tenants**.

## Managing tenants (superadmin)

### Console
**Platform → Tenants** (visible only to superadmins):
- **New Tenant** — name, slug (used for the SIP domain), plan, limits, and the
  **first admin user** — created atomically.
- **Manage** (↪) — set the active tenant and drop into that tenant's console.
- **Edit** — change plan, limits, SIP domain.
- **Suspend / Activate** — instantly gate all calls for a tenant.

### Acting on a tenant — the `X-Tenant-Id` header
A superadmin selects an active tenant; the web client then sends
`X-Tenant-Id: <tenantId>` on every request. The API honors this header **only
for superadmins**, rewriting `request.auth.tenantId` so all the normal
tenant-scoped routes operate on the chosen tenant. Non-superadmins are always
pinned to their own tenant; the header is ignored for them.

`GET /api/tenants/context/current` returns the effective tenant, whether the
superadmin is impersonating, and their home tenant.

### API
```bash
# Create a tenant + first admin (superadmin token)
curl -X POST https://$DOMAIN/api/tenants \
  -H "Authorization: Bearer $SUPERADMIN_JWT" -H 'content-type: application/json' \
  -d '{
        "name":"Acme Corp","slug":"acme","plan":"pro",
        "max_extensions":100,"max_concurrent_calls":50,
        "admin":{"email":"admin@acme.com","password":"<strong>"}
      }'

# Manage Acme's extensions as superadmin
curl https://$DOMAIN/api/extensions \
  -H "Authorization: Bearer $SUPERADMIN_JWT" -H "X-Tenant-Id: <acme-tenant-id>"

# Suspend a tenant (blocks all its calls immediately)
curl -X POST https://$DOMAIN/api/tenants/<id>/suspend \
  -H "Authorization: Bearer $SUPERADMIN_JWT"
```

Endpoints (all superadmin): `GET/POST /api/tenants`, `GET/PATCH /api/tenants/:id`,
`POST /api/tenants/:id/{suspend,activate}`, `DELETE /api/tenants/:id` (refuses a
non-empty tenant unless `?force=1`).

## SIP domains

Each tenant may have its own `domain` (e.g. `acme.pbx.example.com`). Set it on
the tenant; point DNS/SRV at the PBX. Endpoints register with their unique
`sip_username`, so even without distinct domains tenants stay isolated — the
domain mainly gives each org a clean registration realm and From identity.

## Onboarding a new tenant — checklist

1. **Platform → Tenants → New Tenant** (name, slug, plan, limits, first admin).
2. Hand the admin their login; they sign in and land in their own console.
3. Admin adds extensions (softphones/WebRTC), a trunk (or **Connect Twilio** —
   see `INTEGRATIONS.md`), DIDs, and routing.
4. Admin builds an AI receptionist (**AI Agents**) and points the main DID at it.

## Notes & limitations

- Live WebSocket events are scoped to the authenticated user's **home** tenant.
  While a superadmin is impersonating another tenant, REST data reflects that
  tenant, but the live wallboard reflects the superadmin's home tenant. Use the
  target tenant's own admin login for live monitoring, or refresh views.
- DIDs (`e164`) are globally unique across the platform — a number belongs to
  exactly one tenant, which is how inbound calls resolve their tenant.
