# AIpbx — AI-Native Cloud PBX

An open, self-hosted **3CX alternative** built on an **Asterisk** core with a
first-class **AI layer** (LLM-powered receptionists, real-time transcription,
sentiment, summaries), designed to deploy on **DigitalOcean** in minutes.

> Asterisk does the telephony. A TypeScript control plane drives it over ARI.
> A Python AI engine streams call audio to STT → an LLM brain (Claude) → TTS,
> in real time, with barge-in. A React console + WebRTC softphone runs the front.

---

## Features

### Telephony core (Asterisk / PJSIP)
- SIP extensions (softphone, desk phone, **WebRTC** browser phone)
- SIP **trunks** (Twilio/Telnyx/Bandwidth/generic), DID inbound + outbound routing
- **IVR / auto-attendant** (multi-level, TTS or uploaded greetings)
- **Call queues** (ACD, strategies, SLA, position announcements, wrap-up)
- **Ring groups**, **time conditions** (business hours), **voicemail** (+ email + transcription)
- Call **recording** (always / on-demand) → DO Spaces
- Conferencing, call transfer / park / pickup, BLF presence, music-on-hold
- Full **CDR** + real-time call-control events

### AI layer (the differentiator)
- **AI voice agents**: receptionist, sales, support, survey, outbound — each with
  its own persona, knowledge base, voice, and tools
- **Real-time** STT (Deepgram/Whisper) ↔ **Claude** brain ↔ TTS (ElevenLabs/Azure/OpenAI)
- **Barge-in** (caller can interrupt), turn detection, sub-second response targets
- Tool use: lookup, booking, transfer-to-human, CRM writes, custom webhooks
- Post-call **AI summary**, **sentiment** scoring, action items, searchable transcripts
- RAG knowledge bases per agent

### Platform
- **Multi-tenant**, RBAC (superadmin/admin/supervisor/agent/user), MFA, audit logs
- React admin console: dashboard, live wallboard, extensions, trunks, routing,
  AI agent builder, CDR explorer, recordings, voicemail, reports
- Browser **WebRTC softphone** (JsSIP)
- REST + WebSocket API, webhooks, SMS/chat hooks
- One-command **DigitalOcean** deploy (Terraform + Docker Compose), Let's Encrypt TLS

---

## Architecture

```
                        ┌──────────────────────────────────────────┐
   PSTN / SIP trunks ───┤                 Asterisk                  │
   WebRTC browsers ─────┤   PJSIP · dialplan · ARI · AudioSocket    │
                        └───────┬───────────────────────┬──────────┘
                          ARI (HTTP/WS)            AudioSocket (TCP, raw audio)
                                │                       │
                    ┌───────────▼─────────┐   ┌─────────▼────────────┐
                    │   API (Node/TS)     │   │   AI Engine (Python) │
                    │  Fastify · ARI ctrl │   │  STT → Claude → TTS  │
                    │  REST · WS · auth   │◄─►│  barge-in · tools    │
                    │  routing · CDR      │   │  summaries/sentiment │
                    └───┬──────────┬──────┘   └──────────┬───────────┘
                        │          │                     │
                ┌───────▼──┐  ┌────▼─────┐        ┌───────▼────────┐
                │ Postgres │  │  Redis   │        │   DO Spaces    │
                │  state   │  │ presence │        │ recordings/vm  │
                └──────────┘  └──────────┘        └────────────────┘
                        ▲
                ┌───────┴────────┐
                │  Web (React)   │  admin console + WebRTC softphone
                └────────────────┘
```

### Repository layout
```
AIpbx/
├── asterisk/            # Asterisk Docker image + PJSIP/dialplan/ARI config
├── services/
│   ├── api/             # Node/TS control plane (Fastify, ARI, REST, WS, auth)
│   └── ai-engine/       # Python AI voice agent (AudioSocket, STT/LLM/TTS)
├── web/                 # React + Vite admin console & softphone
├── db/                  # PostgreSQL schema
├── deploy/              # Terraform (DigitalOcean), nginx, scripts
└── docs/                # Architecture, runbooks, API reference
```

### Service contract (ports)
| Service     | Port(s)                       | Purpose                          |
|-------------|-------------------------------|----------------------------------|
| Asterisk    | 5060/udp 5061/tcp 8088 8089   | SIP, TLS, ARI, WebRTC WSS        |
| Asterisk    | 10000-10200/udp               | RTP media                        |
| AI Engine   | 8080, 9092/tcp                | HTTP API, AudioSocket            |
| API         | 3000                          | REST + WebSocket                 |
| Postgres    | 5432                          | State                            |
| Redis       | 6379                          | Presence, queues, pub/sub        |
| nginx       | 80, 443                       | TLS termination + reverse proxy  |

---

## Quick start (local)

```bash
git clone <repo> AIpbx && cd AIpbx
make env                 # creates .env from template
$EDITOR .env             # set secrets + ANTHROPIC_API_KEY + provider keys
make up                  # build & start the whole stack
make seed                # default admin + demo extensions
```

- Console:  `http://localhost` (admin@default / set during seed)
- API:      `http://localhost:3000/api`
- Register a softphone against `localhost:5060` or use the browser softphone.

## Deploy to DigitalOcean

```bash
cd deploy/terraform
cp terraform.tfvars.example terraform.tfvars   # droplet size, region, domain, DO token
terraform init && terraform apply              # provisions droplet, Spaces, firewall, DNS
```
The droplet's cloud-init clones the repo, writes `.env`, runs `docker compose up`,
and obtains Let's Encrypt certificates. See `deploy/README.md`.

---

## Configuration
All configuration is environment-driven. See [`.env.example`](.env.example) for the
full list. The AI brain defaults to `claude-opus-4-8`; set `LLM_MODEL=claude-haiku-4-5`
for the lowest voice latency.

## Documentation
- `docs/ARCHITECTURE.md` — deep dive on call flow & AI pipeline
- `docs/API.md` — REST + WebSocket reference
- `docs/AI_AGENTS.md` — building AI voice agents
- `docs/OPERATIONS.md` — runbook, scaling, backups

## License
MIT
