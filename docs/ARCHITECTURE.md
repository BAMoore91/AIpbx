# AIpbx — System Architecture

## Overview

AIpbx is an AI-native cloud PBX built on an Asterisk core, designed as a production-grade alternative to 3CX for teams that need programmable, AI-enhanced voice communications. The system is multi-tenant, deployed as a Docker Compose stack on a DigitalOcean droplet, and built around five capabilities that traditional PBX systems lack:

1. **AI voice agents** — LLM-powered agents (Claude) that answer calls, handle IVR logic conversationally, and hand off to humans.
2. **Real-time transcription and summarization** of every call.
3. **Fully programmable call routing** via a REST API (ARI/Stasis).
4. **WebRTC-native** — browsers register as SIP endpoints without plugins.
5. **Multi-tenant** — full data isolation with per-tenant SIP domains.

---

## Component Map

```
                         ┌──────────────────────────────────────────────────────┐
                         │                   DigitalOcean Droplet                │
                         │                                                        │
  Browser / SIP UA ──────┼───► :443 (HTTPS/WSS) ──► nginx ──► web:80 (SPA)      │
                         │                               │                        │
  REST / WebSocket ───────┼───────────────────────────────┼───► api:3000 (Node)   │
                         │                               │        │               │
  WebRTC WSS ────────────┼───► :8089 ──────────────────────► asterisk:8089        │
                         │                               │        │               │
  SIP (UDP/TLS) ──────────┼───► :5060/:5061 ──────────────► asterisk:5060/5061   │
                         │                                        │               │
  PSTN trunk ─────────────┼────────────────────────────────────────┘              │
                         │                                        │               │
                         │   api:3000 ◄──────────────────── ARI/Stasis events    │
                         │       │                               │               │
                         │       ├── PostgreSQL:5432             │               │
                         │       ├── Redis:6379                  │               │
                         │       └── ai-engine:8080 ─────────────┘               │
                         │              │                                         │
                         │              ├── AudioSocket:9092 ◄── Asterisk         │
                         │              ├── Deepgram STT (external)               │
                         │              ├── Claude API (external)                 │
                         │              └── ElevenLabs TTS (external)             │
                         │                                                        │
                         │   Recordings ────────────────────────► DO Spaces (S3) │
                         └──────────────────────────────────────────────────────┘
```

---

## Services

| Service     | Image / Build        | Port(s)                        | Role                                        |
|-------------|----------------------|--------------------------------|---------------------------------------------|
| nginx       | nginx:1.27-alpine    | 80, 443                        | TLS termination, reverse proxy              |
| web         | ./web (Vite/React)   | 80 (internal)                  | Static SPA frontend                         |
| api         | ./services/api       | 3000                           | REST + WebSocket, ARI bridge, business logic|
| ai-engine   | ./services/ai-engine | 8080 (HTTP), 9092 (AudioSocket) | AI pipeline: STT → LLM → TTS              |
| asterisk    | ./asterisk           | 5060/udp, 5061, 8088, 8089, 10000-10200/udp | PBX core, Stasis app, WebRTC |
| postgres    | postgres:16-alpine   | 5432 (internal)                | Primary relational store                    |
| redis       | redis:7-alpine       | 6379 (internal)                | Session cache, pub/sub, queue               |

---

## Inbound Call Flow (PSTN → Extension)

```
1. PSTN carrier sends SIP INVITE to :5060 (UDP) or :5061 (TLS)
2. Asterisk PJSIP receives the call, matches a trunk endpoint
3. Asterisk dialplan routes to the Stasis app ("aipbx")
4. The Stasis app connects via WebSocket to api:3000 (ARI)
5. api looks up the DID in did_numbers → resolves dest_type/dest_id:
   ├── dest_type = "extension"  → bridge to the extension's PJSIP endpoint
   ├── dest_type = "ivr"        → play greeting, wait for DTMF, re-route
   ├── dest_type = "queue"      → add caller to ACD queue
   ├── dest_type = "ring_group" → simultaneously ring member extensions
   ├── dest_type = "voicemail"  → record audio, store to S3, notify via email
   └── dest_type = "ai_agent"   → launch AI agent pipeline (see below)
6. Call events (ringing, answered, ended) are emitted over ARI WebSocket
7. api writes a calls row and emits WebSocket events to connected web clients
8. On hangup: recording (if enabled) is uploaded to DO Spaces; transcript
   and AI summary are stored in transcripts and calls tables.
```

---

## Inbound Call Flow (WebRTC Browser)

```
1. Browser SIP UA (JsSIP/SipML5) opens a WebSocket to wss://DOMAIN:8089/ws
   (Asterisk HTTP server — NOT proxied through nginx, direct connection)
2. Asterisk performs DTLS-SRTP negotiation (ICE with STUN/TURN)
3. SIP REGISTER → Asterisk creates a PJSIP endpoint entry in endpoint_status
4. Incoming call → SIP INVITE routed the same as PSTN (step 4 above)
5. Outgoing call → browser sends SIP INVITE → Asterisk → ARI → api
```

The WebRTC WSS port (8089) is exposed directly from the asterisk container, not proxied through nginx. This is required because WebRTC DTLS termination must occur at the media endpoint (Asterisk). The nginx configuration documents this with a comment.

---

## AI Agent Real-Time Pipeline

When a call is routed to an `ai_agent` destination:

```
Asterisk ──AudioSocket:9092──► ai-engine
                                    │
                         ┌──────────┤
                         │ VAD loop │  (Voice Activity Detection)
                         └──────────┤
                                    │ speech detected →
                              Deepgram STT (streaming)
                                    │ transcript chunk →
                              Claude API (streaming, tool_use enabled)
                                    │ response token →
                              ElevenLabs TTS (streaming)
                                    │ audio chunks →
                         ──AudioSocket:9092──► Asterisk ──► caller
```

**AudioSocket protocol**: Asterisk's `app_audiosocket` application sends raw 16-bit PCM (8 kHz, mono, slin) over a TCP socket to the ai-engine. The ai-engine sends audio back the same way. Each message has a 3-byte header: 1-byte type + 2-byte length.

**Barge-in (interruption)**: The ai-engine runs a parallel VAD thread. When the caller speaks while the agent is playing audio, the in-flight TTS stream is cancelled, the LLM generation is aborted, and the new speech is processed. The `interruptible` flag on `ai_agents` controls this behavior.

**Latency budget**:
- VAD detection: ~50 ms
- Deepgram streaming STT (end of utterance): ~200 ms
- Claude streaming (first token): ~150–350 ms (varies by model)
- ElevenLabs TTS (first audio chunk): ~100–200 ms
- AudioSocket round-trip: ~5 ms (local network)
- **Total perceived response latency: ~500–800 ms** (claude-opus-4-8)
- **With claude-haiku-4-5**: ~300–500 ms (recommended for high-volume/low-latency)

**Post-call processing**: After the call ends, ai-engine stores the full transcript in `transcripts`, runs a sentiment analysis pass via Claude, and writes a call summary to `calls.summary`.

---

## Data Model Overview

```
tenants
  └── users               (employees, admins)
  └── extensions          (SIP endpoints — softphone, WebRTC, AI agent)
  └── trunks              (PSTN carrier connections)
       └── did_numbers    (phone numbers, routed to destinations)
  └── outbound_routes     (dialplan patterns → trunks)
  └── ring_groups         (simultaneous ring strategies)
  └── queues              (ACD queues with agents)
       └── queue_members
  └── ivr_menus           (auto-attendant trees with DTMF options)
  └── time_conditions     (business hours routing)
  └── ai_agents           (AI voice agent configurations)
       └── knowledge_bases
            └── kb_documents
  └── calls               (CDR — every call leg)
       └── recordings     (S3 keys for audio files)
       └── transcripts    (turn-by-turn STT output)
  └── voicemails
  └── messages            (SMS / internal chat)
  └── webhooks            (outbound event delivery)
  └── audit_logs          (immutable action log)
```

**Multi-tenancy**: Every table has a `tenant_id` column. The API enforces tenant isolation at the query level — all queries include `WHERE tenant_id = :currentTenantId`. SIP domains are isolated by the Asterisk `domain` field in PJSIP endpoint config. The `tenants.domain` column holds the SIP domain for each tenant.

---

## Port Reference

| Port          | Protocol | Exposed To  | Purpose                              |
|---------------|----------|-------------|--------------------------------------|
| 80            | TCP      | Public      | HTTP (ACME challenge + redirect)     |
| 443           | TCP      | Public      | HTTPS — web UI, REST API, WebSocket  |
| 5060          | UDP      | Public      | SIP signaling (trunks + softphones)  |
| 5061          | TCP      | Public      | SIP over TLS (SIPS)                  |
| 8088          | TCP      | Internal    | Asterisk ARI (accessed by api only)  |
| 8089          | TCP      | Public      | Asterisk WebRTC WSS                  |
| 9092          | TCP      | Internal    | AudioSocket (Asterisk → ai-engine)   |
| 8080          | TCP      | Internal    | ai-engine REST health/control        |
| 3000          | TCP      | Internal    | API service (proxied by nginx)       |
| 5432          | TCP      | Internal    | PostgreSQL                           |
| 6379          | TCP      | Internal    | Redis                                |
| 10000–10200   | UDP      | Public      | RTP media (audio streams)            |

---

## Scaling Notes

**Vertical scaling** (recommended first step): Asterisk is CPU-bound for audio transcoding. Resize the droplet from `s-4vcpu-8gb` to `s-8vcpu-16gb` or `s-16vcpu-32gb`. Update `terraform.tfvars` and run `terraform apply`.

**RTP port range**: The default 10000–10200 allows ~100 concurrent call legs. For higher concurrency, expand to 10000–20000 in `.env` (`RTP_START`/`RTP_END`) and update the Cloud Firewall rule. Each call uses 2 RTP ports (send + receive) per leg.

**Horizontal Asterisk scaling** (advanced): Requires a media proxy (rtpengine or RTPEngine) to anchor RTP, and a shared SIP registrar. Redis is already in the stack for shared session state. Database read replicas (managed PostgreSQL replica in DigitalOcean) offload reporting queries.

**AI engine scaling**: The ai-engine is stateless per-call (state is in Redis). Multiple instances can be run behind a simple TCP load balancer for the AudioSocket port (9092), or by routing calls to specific instances based on channel ID.

**Database**: For production with >100 tenants, migrate to managed PostgreSQL (DigitalOcean DBaaS) — see the commented `digitalocean_database_cluster` resource in `deploy/terraform/main.tf`.
