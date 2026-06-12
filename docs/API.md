# AIpbx — REST & WebSocket API Reference

## Base URL

```
https://DOMAIN/api
```

All endpoints require a valid JWT Bearer token in the `Authorization` header unless marked **public**.

---

## Authentication

### POST /api/auth/login  (public)

Authenticate with email + password. Returns access and refresh tokens.

**Request**
```json
{
  "email": "admin@pbx.example.com",
  "password": "YourPassword123!"
}
```

**Response 200**
```json
{
  "accessToken": "eyJ...",
  "refreshToken": "eyJ...",
  "expiresIn": 900,
  "user": {
    "id": "...",
    "email": "admin@pbx.example.com",
    "role": "admin",
    "tenantId": "..."
  }
}
```

**Errors**: `401` invalid credentials, `403` account inactive.

---

### POST /api/auth/refresh  (public)

Exchange a refresh token for a new access token. The old refresh token is invalidated (rotation).

**Request**
```json
{ "refreshToken": "eyJ..." }
```

**Response 200**
```json
{
  "accessToken": "eyJ...",
  "refreshToken": "eyJ...",
  "expiresIn": 900
}
```

---

### POST /api/auth/logout

Revoke the current refresh token.

**Request**: `Authorization: Bearer <accessToken>` (no body required)

**Response 204**: No content.

---

### POST /api/auth/change-password

Change the authenticated user's password.

**Request**
```json
{
  "currentPassword": "OldPassword",
  "newPassword": "NewPassword123!"
}
```

**Response 204**: No content.

---

## Extensions

### GET /api/extensions

List all extensions in the tenant. Supports pagination.

**Query params**: `page` (default 1), `limit` (default 50, max 200), `search` (text search on extension/display_name), `type` (softphone|webrtc|desk|ai_agent)

**Response 200**
```json
{
  "data": [
    {
      "id": "uuid",
      "extension": "1001",
      "displayName": "Alice",
      "sipUsername": "alice1001",
      "type": "webrtc",
      "transport": "transport-wss",
      "codecs": ["opus", "ulaw", "alaw"],
      "voicemailEnabled": true,
      "callRecording": "on-demand",
      "dnd": false,
      "state": "available",
      "createdAt": "2024-01-01T00:00:00Z"
    }
  ],
  "total": 42,
  "page": 1,
  "limit": 50
}
```

---

### POST /api/extensions

Create a new extension. The `sipPassword` is encrypted at rest using `ENCRYPTION_KEY`.

**Request**
```json
{
  "extension": "1003",
  "displayName": "Charlie",
  "type": "webrtc",
  "transport": "transport-wss",
  "codecs": ["opus", "ulaw"],
  "sipPassword": "SecretSIPpass1!",
  "voicemailEnabled": true,
  "callRecording": "on-demand",
  "ringTimeout": 25
}
```

**Response 201**: Created extension object (password field omitted).

---

### GET /api/extensions/:id

Get a single extension by UUID.

---

### PUT /api/extensions/:id

Update extension settings. Partial updates are supported (PATCH semantics).

---

### DELETE /api/extensions/:id

Delete an extension. Associated calls are preserved in CDR.

---

## Trunks

### GET /api/trunks

List SIP trunks. **Roles**: admin, superadmin.

### POST /api/trunks

Create a SIP trunk.

**Request**
```json
{
  "name": "Twilio US",
  "provider": "twilio",
  "host": "pstn.twilio.com",
  "port": 5060,
  "transport": "udp",
  "authType": "userpass",
  "username": "ACxxxxxxxx",
  "secret": "your-twilio-auth-token",
  "register": true,
  "codecs": ["ulaw", "alaw"],
  "maxChannels": 30
}
```

### GET/PUT/DELETE /api/trunks/:id

Standard CRUD operations.

---

## DID Numbers

### GET /api/did-numbers

List DID numbers with their routing destinations.

**Response 200**
```json
{
  "data": [
    {
      "id": "uuid",
      "e164": "+15551234567",
      "label": "Main Line",
      "trunkId": "uuid",
      "destType": "ai_agent",
      "destId": "uuid-of-agent",
      "isActive": true
    }
  ]
}
```

### POST /api/did-numbers

Add a DID number.

```json
{
  "e164": "+15559876543",
  "label": "Sales Line",
  "trunkId": "uuid",
  "destType": "queue",
  "destId": "uuid-of-sales-queue"
}
```

### PUT /api/did-numbers/:id

Update routing — change `destType` and `destId` to reroute the number live.

---

## Calls

### GET /api/calls

List call detail records. Paginated.

**Query params**: `status` (ringing|answered|ended), `direction` (inbound|outbound|internal), `from`, `to` (date range), `extension`, `aiAgentId`, `search`

### GET /api/calls/:id

Get full call record including transcript and recording references.

**Response 200**
```json
{
  "id": "uuid",
  "direction": "inbound",
  "fromNumber": "+15551234567",
  "fromName": "John Doe",
  "toNumber": "+15559876543",
  "did": "+15559876543",
  "status": "ended",
  "disposition": "answered",
  "handledBy": "9000",
  "aiAgentId": "uuid",
  "startedAt": "2024-01-15T14:22:00Z",
  "answeredAt": "2024-01-15T14:22:03Z",
  "endedAt": "2024-01-15T14:28:45Z",
  "talkSeconds": 402,
  "sentiment": "positive",
  "summary": "Caller inquired about pricing. AI provided overview and offered to connect with sales.",
  "recordingId": "uuid",
  "transcriptId": "uuid"
}
```

### POST /api/calls

Originate an outbound call.

**Request**
```json
{
  "from": "1001",
  "to": "+15559876543",
  "callerId": "+15551111111"
}
```

**Response 202**
```json
{
  "callId": "uuid",
  "channelId": "asterisk-channel-id",
  "status": "ringing"
}
```

### DELETE /api/calls/:id

Hang up an active call.

**Response 204**: No content.

---

## Recordings

### GET /api/recordings

List recordings. Paginated.

**Query params**: `callId`, `from`, `to` (date range), `transcribed` (boolean)

### GET /api/recordings/:id/download

Get a pre-signed URL to download the recording audio file from DO Spaces.

**Response 200**
```json
{
  "url": "https://aipbx-recordings.nyc3.digitaloceanspaces.com/...",
  "expiresIn": 3600,
  "format": "wav",
  "durationSeconds": 402
}
```

---

## AI Agents

### GET /api/ai-agents

List all AI agents in the tenant.

### POST /api/ai-agents

Create a new AI voice agent.

**Request**
```json
{
  "name": "Sales Bot",
  "number": "9001",
  "role": "sales",
  "model": "claude-opus-4-8",
  "systemPrompt": "You are a sales assistant...",
  "greeting": "Thanks for calling! How can I help you today?",
  "voiceId": "21m00Tcm4TlvDq8ikWAM",
  "sttProvider": "deepgram",
  "ttsProvider": "elevenlabs",
  "language": "en",
  "temperatureEffort": "low",
  "interruptible": true,
  "maxTurns": 40,
  "endKeywords": ["goodbye", "bye"],
  "tools": [
    {
      "name": "transfer_call",
      "description": "Transfer the call to a human agent",
      "parameters": {
        "type": "object",
        "properties": {
          "extension": { "type": "string", "description": "Extension number to transfer to" },
          "reason": { "type": "string", "description": "Reason for transfer" }
        },
        "required": ["extension"]
      }
    }
  ],
  "fallbackDestType": "extension",
  "fallbackDestId": "1001"
}
```

**Response 201**: Created AI agent object.

### GET/PUT/DELETE /api/ai-agents/:id

Standard CRUD. PUT supports partial updates.

---

## Queues

### GET /api/queues

List ACD queues.

### POST /api/queues

Create a queue.

```json
{
  "number": "200",
  "name": "Support Queue",
  "strategy": "rrmemory",
  "maxWait": 300,
  "maxCallers": 50,
  "wrapupTime": 10,
  "serviceLevel": 60
}
```

### POST /api/queues/:id/members

Add a member extension to the queue.

```json
{ "extension": "1001", "penalty": 0 }
```

### DELETE /api/queues/:id/members/:extension

Remove a member from the queue.

---

## IVR Menus

### GET /api/ivr-menus

List IVR (auto-attendant) menus.

### POST /api/ivr-menus

Create an IVR menu.

```json
{
  "number": "100",
  "name": "Main Menu",
  "greetingType": "tts",
  "greetingText": "Press 1 for sales, 2 for support, 0 for the operator.",
  "timeout": 5,
  "maxRetries": 3,
  "options": {
    "1": { "type": "queue", "id": "uuid-sales-queue" },
    "2": { "type": "queue", "id": "uuid-support-queue" },
    "0": { "type": "extension", "id": "1001" }
  }
}
```

---

## Ring Groups

### GET /api/ring-groups

List ring groups.

### POST /api/ring-groups

```json
{
  "number": "300",
  "name": "On-Call Team",
  "strategy": "hunt",
  "members": ["1001", "1002"],
  "ringTimeout": 25,
  "failDestType": "voicemail",
  "failDestId": "1001"
}
```

---

## Webhooks

### GET /api/webhooks

List configured webhooks.

### POST /api/webhooks

Register a webhook endpoint.

```json
{
  "url": "https://your-server.example.com/hooks/aipbx",
  "events": ["call.started", "call.ended", "voicemail.received"],
  "secret": "your-webhook-signing-secret"
}
```

AIpbx signs every webhook POST with `X-AIpbx-Signature: sha256=<hmac>` using the `secret`.

**Supported event types**:

| Event                    | When fired                                             |
|--------------------------|--------------------------------------------------------|
| `call.started`           | A new call begins ringing                              |
| `call.answered`          | A call is answered by an extension, queue, or agent    |
| `call.ended`             | A call terminates (any disposition)                    |
| `call.recording.ready`   | Recording upload to Spaces completes                   |
| `call.transcript.ready`  | STT transcript is available                            |
| `agent.transfer`         | AI agent initiates a call transfer                     |
| `voicemail.received`     | New voicemail left                                     |
| `extension.registered`   | A SIP endpoint registers                               |
| `extension.unregistered` | A SIP endpoint de-registers or times out               |
| `queue.joined`           | Caller enters a queue                                  |
| `queue.abandoned`        | Caller leaves a queue before being answered            |

**Webhook payload schema**:
```json
{
  "event": "call.ended",
  "tenantId": "uuid",
  "timestamp": "2024-01-15T14:28:45Z",
  "data": { ... }
}
```

### PUT/DELETE /api/webhooks/:id

Update or remove a webhook.

---

## WebSocket Events

Connect with:
```
wss://DOMAIN/ws?token=<accessToken>
```

Or pass `Authorization: Bearer <token>` as a WebSocket subprotocol header.

All messages are JSON. The client receives events; it does not send commands over WebSocket (use REST for actions).

### Event Schema

```json
{
  "type": "call.ringing",
  "tenantId": "uuid",
  "ts": "2024-01-15T14:22:00Z",
  "data": { ... }
}
```

### Event Types

| Type                         | Data fields                                          |
|------------------------------|------------------------------------------------------|
| `call.ringing`               | `callId, from, to, did, direction`                   |
| `call.answered`              | `callId, answeredAt, handledBy`                      |
| `call.ended`                 | `callId, disposition, talkSeconds, hangupCause`      |
| `call.on_hold`               | `callId, holdStartedAt`                              |
| `call.resumed`               | `callId`                                             |
| `presence.updated`           | `extension, state` (available|ringing|inuse|busy|unavailable) |
| `queue.stats`                | `queueId, waitingCallers, avgWaitSeconds, agentsAvailable` |
| `agent.utterance`            | `callId, agentId, text, role` (streaming AI transcripts) |
| `voicemail.received`         | `extension, from, duration, id`                      |
| `system.notification`        | `level, message` (info|warn|error)                   |

---

## Error Responses

All errors follow this schema:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "extension is required",
    "details": [
      { "field": "extension", "message": "must be a non-empty string" }
    ]
  }
}
```

Common HTTP status codes:
- `400` Bad Request — validation error
- `401` Unauthorized — missing or expired token
- `403` Forbidden — insufficient role
- `404` Not Found
- `409` Conflict — duplicate (unique constraint)
- `429` Too Many Requests — rate limited
- `500` Internal Server Error

---

## Rate Limiting

- Default: **100 requests / 15 minutes** per authenticated user.
- Call origination: **10 outbound calls / minute** per tenant.
- Rate limit headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.

---

## Pagination

All list endpoints support:

| Param   | Default | Description               |
|---------|---------|---------------------------|
| `page`  | 1       | Page number (1-indexed)   |
| `limit` | 50      | Items per page (max 200)  |

Response includes `total`, `page`, `limit`, and `data` array.
