# AIpbx — AI Voice Engine

Real-time AI voice service for the AIpbx cloud PBX. When a call is routed to an
AI agent, Asterisk bridges the channel's audio to this service over
**AudioSocket** (raw 8 kHz mono signed-linear 16-bit PCM over TCP). This service
runs the full-duplex loop:

```
caller audio (slin 8k)
   → resample 16k → STT (streaming)
      → final utterance → Claude (streaming + tool loop)
         → TTS → resample 8k → AudioSocket back to the caller
```

It supports **barge-in** (the caller can interrupt the agent), per-call session
state, **tool use**, and **post-call summary + sentiment**.

---

## Architecture

| Module | Responsibility |
| --- | --- |
| `app/main.py` | Entrypoint — runs the FastAPI control API (8080) and the AudioSocket TCP server (9092) concurrently. |
| `app/config.py` | Env config via `pydantic-settings`. Nothing hardcoded; missing keys degrade gracefully. |
| `app/audiosocket.py` | AudioSocket protocol: framing, partial-read handling, async TCP server. |
| `app/audio.py` | Resampling (`audioop.ratecv`) and companding between 8 kHz slin and 16 kHz, plus energy/RMS helpers for VAD/barge-in. |
| `app/engine.py` | Shared singletons (DB, Claude brain, registry, store) + the AudioSocket connection handler. |
| `app/session.py` | `CallSession` — the real-time orchestration loop, barge-in, turn limits, end keywords, tool side effects, post-call persistence. |
| `app/llm.py` | Claude brain (`AsyncAnthropic`): streaming turns, manual tool loop, conversation memory, system-prompt assembly, `summarize_call`. |
| `app/stt/` | STT providers — `deepgram` (streaming WS, default), `openai_whisper` (chunked + VAD), `local` (offline stub). |
| `app/tts/` | TTS providers — `elevenlabs` (streaming, default), `openai_tts`, `azure_tts`, `piper_local` (offline stub). |
| `app/db.py` | asyncpg pool + queries (agent config, KB retrieval, call/transcript persistence). |
| `app/store.py` | S3/DO Spaces recording upload (best-effort). |
| `app/registry.py` | `call_uuid → agent registration` + active sessions, mirrored into Redis so multiple workers can share. |
| `app/api.py` | HTTP control routes. |

---

## The real-time loop

1. The API service POSTs `/calls` with `{call_uuid, channel_id, tenant_id, agent_id}` to **register** which agent will handle an upcoming AudioSocket connection.
2. Asterisk opens the AudioSocket TCP connection and sends the **UUID** as its first frame (`0x01`, 16 bytes). The engine matches it to the registration and builds a `CallSession`.
3. The session loads the agent config (`ai_agents`), speaks the **greeting**, then pumps audio:
   - Inbound `0x10` audio frames are resampled 8 k → 16 k and streamed to **STT**.
   - **STT** emits interim and final transcripts. A final utterance (with endpointing) triggers a **Claude** turn.
   - **Claude** streams the reply via `client.messages.stream(...)`; the session flushes complete sentences to **TTS** as they arrive (low latency), resamples 16 k → 8 k, and sends `0x10` frames back to the caller.
4. On hangup/terminate the session generates a **summary + sentiment** and persists the transcript and call result; an optional recording is uploaded.

### Barge-in

If the agent is speaking and the caller starts talking (sustained inbound energy and/or interim STT), and the agent is `interruptible`, the session immediately:

- sets a cancel flag that stops consuming the TTS audio generator, and
- cancels the in-flight LLM stream task.

The caller's new utterance then drives the next turn.

### Turn control

- `max_turns` from the agent config caps the conversation; exceeding it triggers a human handoff.
- `end_keywords` (e.g. "goodbye") end the call gracefully.

---

## Claude usage (authoritative)

- Official `anthropic` SDK (`from anthropic import AsyncAnthropic`). Never raw HTTP for Claude, never OpenAI for the brain.
- Model from `LLM_MODEL` (default `claude-opus-4-8`; voice configs may use `claude-haiku-4-5`). Exact id strings — **no date suffix**.
- **Adaptive thinking**: `thinking={"type": "adaptive"}`, depth via `output_config={"effort": <LLM_EFFORT>}` (default `low` for voice latency).
- **No** `temperature` / `top_p` / `top_k` (they 400 on these models) and **no** `budget_tokens`.
- Streaming via `client.messages.stream(...)`, consuming `text_stream`, so TTS starts as text arrives. `max_tokens` ~1024 for voice turns.
- **Manual tool loop**: when `stop_reason == "tool_use"`, execute tools and feed `tool_result` blocks back, preserving per-call message history (thinking/tool_use blocks echoed back verbatim).
- `summarize_call` is non-streaming with structured outputs (`output_config.format`) returning `{summary, sentiment, sentiment_score, action_items, tags}`.

### Tools

Built-in: `transfer_to_human`, `lookup_knowledge`, `end_call`, `schedule_callback`. Tenant-defined webhook tools from `ai_agents.tools` are merged in; a tool entry may carry `x_webhook` (or `webhook_url`) which the session POSTs to with the call context.

---

## AudioSocket framing

Each frame is `1 byte type + 2 bytes big-endian length + payload`:

| Type | Meaning |
| --- | --- |
| `0x00` | TERMINATE / hangup (empty payload) |
| `0x01` | UUID (16 raw bytes — first frame Asterisk sends) |
| `0x03` | ERROR (from Asterisk) |
| `0x10` | AUDIO — slin: 8 kHz, 16-bit, mono, signed-linear PCM |
| `0x11` | DTMF (some builds) |
| `0xff` | LOG / out-of-band |

To **play** audio to the caller, send `0x10` frames of slin PCM, chunked into
~20 ms / 320-byte frames so Asterisk paces them smoothly and barge-in stays
responsive.

Example Asterisk dialplan leg (the API/dialplan side, not this service):

```
exten => _X.,1,Answer()
 same => n,AudioSocket(${CALL_UUID},ai-engine:9092)
 same => n,Hangup()
```

---

## Configuration (env)

| Var | Default | Notes |
| --- | --- | --- |
| `AI_ENGINE_PORT` | 8080 | HTTP control API |
| `AUDIOSOCKET_HOST` / `AUDIOSOCKET_PORT` | 0.0.0.0 / 9092 | AudioSocket TCP server |
| `DATABASE_URL` | — | Postgres; optional (degraded mode without it) |
| `REDIS_URL` | — | shared registry; optional |
| `ANTHROPIC_API_KEY` | — | required for the LLM brain |
| `LLM_MODEL` | `claude-opus-4-8` | exact id, no suffix |
| `LLM_EFFORT` | `low` | `low\|medium\|high\|max` |
| `STT_PROVIDER` | `deepgram` | `deepgram\|openai\|whisper-local` |
| `DEEPGRAM_API_KEY` / `OPENAI_API_KEY` | — | provider keys |
| `TTS_PROVIDER` | `elevenlabs` | `elevenlabs\|openai\|azure\|piper-local` |
| `ELEVENLABS_API_KEY` / `ELEVENLABS_VOICE_ID` | — | ElevenLabs |
| `AZURE_TTS_KEY` / `AZURE_TTS_REGION` | — | Azure TTS |
| `S3_*` | — | recording storage (DO Spaces / S3) |

Provider choice is per-agent (`ai_agents.stt_provider`, `tts_provider`,
`voice_id`, `model`, `temperature_effort`) and falls back to env. Missing keys
log a warning and fall back to the offline stub — the engine still runs.

---

## HTTP control API

| Method & path | Purpose |
| --- | --- |
| `POST /calls` | Register `{call_uuid, channel_id, tenant_id, agent_id}` for an upcoming AudioSocket connection. |
| `GET /healthz` | Liveness + readiness (LLM/DB status, active call count). |
| `GET /calls/{uuid}` | Status of an active or registered call. |
| `POST /calls/{uuid}/summary` | Force a summary for an active call. |
| `POST /agents/{id}/test` | Text-only chat test harness against an agent's prompt (console agent builder); uses the same `llm.py` path, built-in tools resolve to stubs. |

---

## Latency strategy

- **Streaming everywhere**: STT streams partials; Claude streams text; the session flushes complete sentences to TTS the moment they're ready; TTS streams audio chunks. The caller hears the first words long before the full reply is generated.
- **Adaptive thinking at `low` effort** for voice turns favors latency.
- **Barge-in cancellation** is immediate (energy-based + interim STT), so the caller never waits for the agent to finish.
- **Resampling** uses stateful `audioop.ratecv` so chunk boundaries don't click.

---

## Run

```bash
pip install -r requirements.txt
python -m app.main          # serves HTTP :8080 and AudioSocket :9092

# or via Docker
docker build -t aipbx-ai-engine .
docker run --env-file ../../.env -p 8080:8080 -p 9092:9092 aipbx-ai-engine
```

### Tests

```bash
pytest -q     # frame parsing + prompt assembly, no network (Anthropic/sockets mocked)
```
