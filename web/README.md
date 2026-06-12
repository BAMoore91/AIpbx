# AIpbx Web — Admin Console + WebRTC Softphone

React 18 + TypeScript + Vite single-page application: a full-featured cloud PBX admin console with an embedded JsSIP-based WebRTC softphone.

---

## Quick Start (Development)

```bash
cd web/
cp .env.example .env.local   # fill in your API/WS/SIP URLs
npm install
npm run dev                  # starts on http://localhost:3000
```

## Build

```bash
npm run build                # outputs to dist/
npm run preview              # preview the production build locally
```

## Docker

```bash
docker build \
  --build-arg VITE_API_URL=https://your-host/api \
  --build-arg VITE_WS_URL=wss://your-host/ws \
  --build-arg VITE_SIP_WSS_URL=wss://your-host:8089/ws \
  -t aipbx-web .

docker run -p 80:80 aipbx-web
```

---

## Environment Variables

| Variable          | Example                          | Description                                  |
|-------------------|----------------------------------|----------------------------------------------|
| `VITE_API_URL`    | `https://host/api`               | REST API base URL (JWT-authenticated)         |
| `VITE_WS_URL`     | `wss://host/ws`                  | WebSocket for live call/presence events       |
| `VITE_SIP_WSS_URL`| `wss://host:8089/ws`             | Asterisk WebRTC WebSocket for JsSIP softphone |

All three are Vite build-time vars (baked into the JS bundle).

---

## Architecture

```
src/
├── lib/
│   ├── types.ts          # TypeScript interfaces mirroring DB schema
│   ├── api.ts            # Axios instance, JWT interceptor, token refresh, all resource APIs
│   ├── ws.ts             # Reconnecting WebSocket client → event bus
│   ├── auth.ts           # Token localStorage helpers
│   └── queryClient.ts    # TanStack Query config
├── store/
│   ├── authStore.ts      # Zustand: user/session (persisted)
│   ├── callStore.ts      # Zustand: live active calls + queue stats (WS-driven)
│   └── softphoneStore.ts # Zustand: SIP registration state + active call state
├── softphone/
│   ├── sipEngine.ts      # JsSIP UA lifecycle: register, dial, answer, hangup, mute, hold, DTMF, transfer
│   ├── SoftphoneWidget.tsx     # Floating dialer panel (draggable numpad, active call controls)
│   └── IncomingCallPopup.tsx   # Incoming call notification with Answer/Decline
├── components/
│   ├── Sidebar.tsx       # Collapsible navigation sidebar
│   ├── Topbar.tsx        # App header (softphone status, dark mode, user menu)
│   ├── DataTable.tsx     # Sortable, paginated table with skeleton loading
│   ├── Modal.tsx         # Headless UI dialog with transitions
│   ├── ConfirmDialog.tsx # Destructive action confirmation
│   ├── StatCard.tsx      # KPI card with trend indicator
│   ├── AudioPlayer.tsx   # HTML5 audio with waveform-style progress + download
│   ├── Badge.tsx         # Color-coded status badges
│   ├── FormFields.tsx    # Input, Select, Textarea, Toggle, FormSection
│   └── Toast.tsx         # react-hot-toast re-export
├── pages/
│   ├── Login.tsx          # Email/password + MFA flow
│   ├── Dashboard.tsx      # KPIs + live call list + queue SLA + sentiment pie + hourly area chart
│   ├── LiveWallboard.tsx  # Real-time active calls table + queue stat tiles
│   ├── Users.tsx          # CRUD: system users
│   ├── Extensions.tsx     # CRUD: SIP/WebRTC extensions + provisioning toggles
│   ├── Trunks.tsx         # CRUD: SIP trunk configuration
│   ├── Routing.tsx        # Tabs: DID Numbers / Outbound Routes / Ring Groups
│   ├── Queues.tsx         # CRUD + member management + live SLA bars
│   ├── IVR.tsx            # Visual IVR builder: drag key→destination mapping
│   ├── TimeConditions.tsx # Time-based routing rules
│   ├── AIAgents.tsx       # Agent list + 4-tab builder (Core/Voice/Tools/Advanced) + live test chat panel
│   ├── KnowledgeBases.tsx # KB CRUD + file drop-zone document management
│   ├── CDR.tsx            # Call history: filters/pagination + drill-down with transcript timeline + recording player
│   ├── Recordings.tsx     # Recording list with inline audio player
│   ├── Voicemail.tsx      # Inbox with expandable cards, audio playback + transcription
│   ├── Messages.tsx       # SMS/messaging history
│   ├── Reports.tsx        # Recharts bar/line charts, report type picker
│   └── Settings.tsx       # Tabs: Profile / Tenant / Webhooks / Security (MFA + password)
└── styles/
    └── index.css          # Tailwind base + component layer (cards, buttons, inputs, badges, table, softphone)
```

---

## Pages Summary

| Route              | Page              | Description |
|--------------------|-------------------|-------------|
| `/login`           | Login             | JWT auth + optional MFA TOTP code |
| `/dashboard`       | Dashboard         | Live KPIs, sentiment, call volume chart, queue SLA |
| `/wallboard`       | Live Wallboard    | Full-screen real-time calls + queue tiles |
| `/users`           | Users             | Tenant user management |
| `/extensions`      | Extensions        | SIP/WebRTC extensions, voicemail, recording mode |
| `/trunks`          | Trunks            | SIP trunk CRUD |
| `/routing`         | Routing           | DIDs, outbound routes, ring groups (tabbed) |
| `/queues`          | Queues            | Queue CRUD + member management + live SLA |
| `/ivr`             | IVR Menus         | Visual menu builder with key→destination mapping |
| `/time-conditions` | Time Conditions   | Business-hours routing rules |
| `/ai-agents`       | AI Agents         | Agent list + builder + live test chat |
| `/knowledge-bases` | Knowledge Bases   | Document upload (PDF/TXT/DOCX/MD) + processing status |
| `/cdr`             | Call History      | Full CDR explorer + call detail with transcript + recording |
| `/cdr/:id`         | Call Detail       | Transcript timeline, sentiment, AI summary, recording |
| `/recordings`      | Recordings        | Recording list with inline audio |
| `/voicemail`       | Voicemail         | Inbox with expand, audio player, transcription |
| `/messages`        | Messages          | SMS/messaging history |
| `/reports`         | Reports           | Charts + downloadable reports |
| `/settings`        | Settings          | Profile, tenant info, webhooks, MFA/password |

---

## Design System

- **Palette**: Deep indigo (`primary`) + teal (`accent`) on slate (`surface`); named semantic colors (success/warning/danger/info)
- **Typography**: Inter (body) + JetBrains Mono (code/numbers)  
- **Dark mode**: `class`-based via `document.documentElement.classList.toggle('dark')`, persisted to localStorage
- **Component classes**: All major UI patterns are defined as Tailwind `@layer components` (`.btn`, `.card`, `.input`, `.badge`, `.table`, etc.) — no inline style chaos
- **Responsive**: Sidebar collapses at mobile; grids adapt via responsive prefixes

---

## Key Assumptions

1. **JWT expiry**: Access token is short-lived; refresh token used on 401 via axios interceptor
2. **SIP credentials**: Pulled from the user's WebRTC extension (`type === 'webrtc'`, `user_id === currentUser.id`); `sip_username`/`sip_password` registered directly to `VITE_SIP_WSS_URL`
3. **WebSocket auth**: Token sent both as `?token=` query param and as the first JSON message `{type:"auth",token}` — supporting either server approach
4. **Recording download URLs**: The API is expected to return a `download_url` field on Recording/Voicemail resources (signed S3 URL or proxied endpoint)
5. **AI test endpoint**: `POST /ai_agents/:id/test` with `{message, history}` — returns `{reply}`
6. **Live WS events**: `call.started/updated/ended` drive the Zustand `callStore`; Dashboard invalidates its query on these events
