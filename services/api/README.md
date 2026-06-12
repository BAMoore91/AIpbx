# AIpbx — API control-plane service

The backend control plane for **AIpbx**, an AI-native cloud PBX (a 3CX
alternative) built on an Asterisk core. This service is the brain that:

- Serves the multi-tenant REST API + WebSocket realtime feed for the web
  console and softphone.
- Connects to Asterisk via **ARI** (Asterisk REST Interface), registers a
  Stasis application, and **routes inbound calls** (extension / IVR / queue /
  ring group / AI agent / voicemail) based on database state.
- Provisions PJSIP endpoints/trunks, mirrors call lifecycle into the `calls`
  table and device state into `endpoint_status`.
- Tells the **AI engine** (a separate Python service) which `ai_agent` should
  handle a call; the dialplan bridges audio into the engine's AudioSocket.

Stack: TypeScript (Node 22, ESM), Fastify, PostgreSQL (`pg`), Redis (`ioredis`),
`ari-client`, `ws`, JWT (`jsonwebtoken`), `argon2`, `zod`, `pino`, AWS SDK v3
S3 (DO Spaces), `nodemailer`.

## Layout

```
src/
  index.ts          boot: config → db/redis → context → ARI → HTTP+WS → listen
  app.ts            Fastify instance, CORS, error handler, route mount
  config.ts         zod-validated env config
  context.ts        process-wide singletons (crypto, jwt, services…)
  db.ts             pg Pool + query/queryOne/withTransaction helpers
  redis.ts          ioredis client + pub/sub + presence helpers
  crypto.ts         AES-256-GCM encrypt/decrypt for secrets at rest
  events.ts         EventBus → Redis pub/sub + webhook fan-out
  audit.ts          audit_logs writer
  errors.ts         AppError + helpers (400/401/403/404/409)
  auth/             jwt, argon2 passwords, TOTP MFA, login/refresh service, Fastify plugin
  ari/              ARI controller, routing engine, PJSIP provisioner, type shims
  ws/               authenticated WebSocket hub (Redis → clients)
  services/         s3, email, webhook dispatcher, ai-engine client
  routes/           versioned REST API under /api
  types/            db row types + http types
  __tests__/        vitest tests (jwt / crypto / mfa)
```

## Scripts

```bash
npm run build      # tsc → dist/
npm start          # node dist/index.js
npm run dev        # tsx watch src/index.ts
npm run typecheck  # tsc --noEmit
npm test           # vitest run
```

## Configuration

All config comes from the environment (see repo `.env.example`). Required:
`DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`,
`ENCRYPTION_KEY`. ARI / S3 / SMTP are optional — the service degrades
gracefully (logs a warning) when they are unset, so it boots for local CRUD
work without Asterisk, object storage, or email.

`ENCRYPTION_KEY` should be a 32-byte base64 key; any other string is hashed to
32 bytes. It encrypts `extensions.sip_password` and `trunks.secret` at rest.

## Authentication & tenancy

- `POST /api/auth/login` → access + refresh token pair (argon2id verify; TOTP
  MFA enforced when `users.mfa_enabled`).
- `POST /api/auth/refresh` → **rotating** refresh tokens. The raw token's
  SHA-256 hash is stored in `refresh_tokens`; reuse of a rotated token revokes
  the whole family.
- `POST /api/auth/logout`, `GET /api/auth/me`.

Access tokens are short-lived JWTs carrying `{ sub, tid, role, email }`. The
`authenticate` preHandler verifies the token and attaches `request.auth`.
**Every** data query filters by `request.auth.tenantId`, so tenant isolation is
enforced uniformly. `requireRole(...)` adds RBAC (superadmin always passes).

## REST API (all under `/api`, all tenant-scoped, validated, audited)

| Area | Routes |
|------|--------|
| auth | `login`, `refresh`, `logout`, `me` |
| users | CRUD (`/users`) — argon2 hashing, email uniqueness per tenant |
| extensions | CRUD — encrypts SIP secret, provisions PJSIP, redacts secret |
| trunks | CRUD — encrypts secret, provisions PJSIP trunk |
| did_numbers, outbound_routes, ring_groups, queues, ivr_menus, time_conditions, ai_agents, knowledge_bases, webhooks | generic CRUD |
| queue members | `/queues/:id/members` (nested) |
| kb documents | `/knowledge_bases/:id/documents` (nested) |
| calls | `/calls` list/search (filters: direction, status, date range, number, agent, queue + pagination), `/calls/:id` |
| recordings | `/recordings`, `/recordings/:id/download` (presigned S3) |
| transcripts | `/transcripts/search` (Postgres FTS), `/calls/:id/transcript` |
| voicemails | list, `/:id/download` (presigned), `/:id/read`, delete |
| messages | list/create/get (SMS/chat) |
| dashboard | `/dashboard/stats` (active calls, today's counts, queue SLA, sentiment), `/reports` (time-bucketed) |
| call control | `/control/originate`, `/control/:channelId/{hangup,hold,dtmf,transfer,record/start,record/stop}` |
| health | `GET /healthz`, `GET /readyz` (unauthenticated) |

Mutating endpoints require role `admin`/`supervisor` (configurable per
resource); reads require any authenticated user. List endpoints return
`{ data, page, pageSize, total }`.

## WebSocket realtime

Connect to `ws://host/ws?token=<accessJWT>` (or `Authorization: Bearer`). The
hub authenticates the JWT, binds the socket to its tenant, and bridges
Redis pub/sub → clients. Clients may send
`{ "action": "subscribe", "topics": ["call.started", ...] }` to filter.

Event types: `call.started`, `call.updated`, `call.ended`, `presence.changed`,
`queue.stats`. Each frame is `{ type, tenantId, data, ts }`. Events are
published to Redis (so they fan out across all API nodes) and simultaneously
dispatched to tenant webhooks (HMAC-SHA256 signed, header
`X-AIpbx-Signature: sha256=<hex>`).

## ARI & call routing

On boot the service connects to ARI and registers the Stasis app named by
`ARI_APP` (default `aipbx`). The dialplan sends inbound calls into Stasis.

**StasisStart** → the routing engine (`ari/routing.ts`):

1. Look up the dialed number as a DID (`did_numbers.e164`) to find the tenant
   and destination; if not a DID, treat as an internal number and resolve
   within the tenant.
2. `time_condition` destinations are followed transitively (business-hours
   routing in the row's timezone, honoring holidays) until a concrete target
   is reached.
3. A `calls` row is created (status `ringing`) and `call.started` is emitted.
4. Dispatch by destination type:
   - **extension** — honors DND / unconditional forward, otherwise
     originate + bridge to `PJSIP/<sip_username>`; no-answer → voicemail.
   - **ai_agent** — answer, set `AIPBX_*` channel vars, `POST /calls` to the
     AI engine with the agent config + channel id + generated call UUID, then
     `continueInDialplan` into the `ai-audiosocket` context that bridges RTP
     to the engine's AudioSocket.
   - **ivr** — answer, play greeting, collect a DTMF digit via ARI, follow the
     menu option (or invalid/timeout fallback).
   - **queue** — answer, add to a holding bridge (MOH), emit `queue.stats`,
     connect to the first available unpaused member by penalty.
   - **ring_group** — try members per strategy, failover to `fail_dest`.
   - **voicemail** — answer, prompt, record.

**ChannelStateChange / Dial / ChannelHangupRequest / StasisEnd** update the
`calls` row (answered_at, ring/talk seconds, disposition, hangup cause) and emit
`call.updated` / `call.ended`. For AI-handled calls, hangup triggers a
post-call summary/sentiment request to the AI engine.

**DeviceStateChange** upserts `endpoint_status` and publishes
`presence.changed`.

### Call-control REST → ARI

`/control/*` endpoints back the softphone: originate, hangup, hold/unhold,
send DTMF, blind transfer, and record start/stop. Each verifies the target
channel belongs to the caller's tenant (via the `calls` row) before acting.

### PjsipProvisioner

`extensions` / `trunks` writes trigger `PjsipProvisioner`. Asterisk normally
reads PJSIP from the `ps_endpoints` / `ps_aors` / `ps_auths` realtime tables in
the same PostgreSQL database (sorcery + `res_config_pgsql`). Because that
realtime wiring is environment-specific, the provisioner:

1. **Logs the intended PJSIP configuration** (the authoritative action),
2. **Best-effort upserts** the `ps_*` rows if those tables exist (silently
   skips if absent), and
3. asks Asterisk to `reloadModule('res_pjsip.so')` via ARI.

Secrets are decrypted only at the moment they are pushed to Asterisk; our own
tables never store them in plaintext.

## AI engine contract

`services/ai-engine.ts` is the HTTP client to `AI_ENGINE_URL`:

- `POST /calls` — `{ call_id, channel_id, tenant_id, caller_number, did, agent }`
  hands a channel + agent config to the engine.
- `POST /calls/:id/end` — tear down.
- `POST /calls/:id/summary` — request `{ summary, sentiment, sentimentScore }`.

## Notes / TODOs

- Queue and ring-group strategies are baseline (first-available / sequential);
  full strategy weighting + wrapup handling is marked TODO in the controller.
- The voicemail capture starts an ARI recording; finalizing the `voicemails`
  row + S3 upload + email notification runs in the post-record pipeline
  (`services/email.ts` provides `sendVoicemailNotification`).
- Outbound SMS delivery to a carrier is a TODO hook in `routes/messages.ts`.
- TOTP enrollment (provisioning URI / QR) is left to the admin UI; verification
  is implemented for login.
```
