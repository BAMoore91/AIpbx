"""CallSession: the real-time full-duplex loop for one AI-handled call.

Pipeline per call:

    AudioSocket (slin 8kHz)  →  resample to 16kHz  →  STT (streaming)
        →  final utterance  →  Claude (streaming, tool loop)
        →  TTS (slin 8kHz)  →  AudioSocket back to the caller

Key behaviors:
  * Barge-in: if the caller speaks (interim transcript / energy) while the agent
    is talking and the agent is interruptible, we cancel the in-flight TTS
    playback AND the in-flight LLM stream immediately.
  * Per-call state: agent config, message history, transcript turns.
  * Limits: max_turns and end_keywords from the agent config end the call.
  * Tool use: the LLM tool loop runs through ``_execute_tool`` for built-in tools
    (transfer_to_human, lookup_knowledge, end_call, schedule_callback) plus
    tenant webhook tools.
  * Post-call: on hangup we generate a summary + sentiment via Claude and persist
    the transcript and call result; optionally upload a recording.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Optional

import httpx

from . import audio as audiolib
from .audiosocket import AudioSocketConnection
from .config import Settings, get_settings
from .db import AgentConfig, Database
from .llm import ClaudeBrain, assemble_tools, build_system_prompt
from .registry import CallRegistry
from .store import RecordingStore
from .stt import Transcript, create_stt
from .tts import create_tts

logger = logging.getLogger("aipbx.session")

# Energy threshold (RMS over slin8k) that counts as the caller speaking — used
# as a fast barge-in trigger alongside interim STT transcripts.
BARGEIN_RMS = 500.0
# How many consecutive ~20ms speech frames before we treat it as real barge-in
# (avoids cancelling on a single click / breath).
BARGEIN_FRAMES = 4


class CallSession:
    """Orchestrates the STT→LLM→TTS loop for a single AudioSocket connection."""

    def __init__(
        self,
        *,
        call_uuid: str,
        agent: AgentConfig,
        conn: AudioSocketConnection,
        brain: ClaudeBrain,
        db: Database,
        registry: CallRegistry,
        store: RecordingStore,
        channel_id: Optional[str] = None,
        settings: Optional[Settings] = None,
    ) -> None:
        self.call_uuid = call_uuid
        self.agent = agent
        self.conn = conn
        self.brain = brain
        self.db = db
        self.registry = registry
        self.store = store
        self.channel_id = channel_id
        self.settings = settings or get_settings()

        # Conversation memory (Claude messages) + readable transcript turns.
        self.messages: list[dict[str, Any]] = []
        self.transcript_turns: list[dict[str, Any]] = []
        self.turn_count = 0

        # Resampling: Asterisk 8kHz <-> provider 16kHz.
        self._up = audiolib.Resampler(
            self.settings.asterisk_sample_rate, self.settings.provider_sample_rate
        )

        # STT / TTS providers (built per call so voice/lang come from agent cfg).
        self.stt = create_stt(self.agent, self._on_transcript, self.settings)
        self.tts = create_tts(self.agent, self.settings)

        # Barge-in / playback control.
        self._speaking = asyncio.Event()  # set while TTS is playing
        self._cancel_speech = asyncio.Event()  # set to interrupt playback + LLM
        self._bargein_run = 0
        self._llm_task: Optional[asyncio.Task] = None

        # Turn handling: a final utterance triggers the LLM. We serialize turns.
        self._turn_lock = asyncio.Lock()
        self._pending_user_text: list[str] = []

        # Lifecycle.
        self._db_call_id: Optional[str] = None
        self._ended = asyncio.Event()
        self._hangup_requested = False
        self._started_at = time.monotonic()

        # Optional recording buffer (agent out only, lightweight).
        self._record = bool(self.agent.settings.get("record", False)) and store.available
        self._rec_buf = bytearray()

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------
    async def run(self) -> None:
        """Top-level: greet, then pump audio until terminate/hangup."""
        self.registry.attach_session(self.call_uuid, self)
        await self.registry.mark_active(self.call_uuid)
        self._db_call_id = await self.db.upsert_call_started(
            self.call_uuid, self.agent.tenant_id, self.agent.id, self.channel_id
        )

        await self.stt.start()

        # Greeting first so the caller hears the agent immediately.
        greeting = self.agent.greeting or "Hello, how can I help you today?"
        await self._speak(greeting, record_turn=True, role="assistant")

        try:
            await self._audio_loop()
        finally:
            await self._teardown()

    async def _audio_loop(self) -> None:
        """Read AudioSocket frames; feed audio to STT, handle control frames."""
        from .audiosocket import TYPE_AUDIO, TYPE_DTMF, TYPE_ERROR, TYPE_TERMINATE

        while not self._ended.is_set():
            frame = await self.conn.read_frame()
            if frame is None:
                break
            if frame.type == TYPE_AUDIO:
                await self.on_audio_in(frame.payload)
            elif frame.type == TYPE_TERMINATE:
                logger.info("[%s] terminate frame", self.call_uuid)
                break
            elif frame.type == TYPE_ERROR:
                logger.warning("[%s] error frame: %r", self.call_uuid, frame.payload)
            elif frame.type == TYPE_DTMF:
                logger.debug("[%s] dtmf: %r", self.call_uuid, frame.payload)
            # ignore log frames

    async def _teardown(self) -> None:
        self._ended.set()
        self._cancel_speech.set()
        if self._llm_task and not self._llm_task.done():
            self._llm_task.cancel()
            try:
                await self._llm_task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
        try:
            await self.stt.finish()
        except Exception:  # noqa: BLE001
            logger.exception("stt finish error")
        try:
            await self.tts.aclose()
        except Exception:  # noqa: BLE001
            pass

        await self._finalize_call()
        self.registry.detach_session(self.call_uuid)
        await self.registry.remove(self.call_uuid)
        logger.info("[%s] session ended (%d turns)", self.call_uuid, self.turn_count)

    # ------------------------------------------------------------------
    # Inbound audio → STT + barge-in detection
    # ------------------------------------------------------------------
    async def on_audio_in(self, slin8k: bytes) -> None:
        """Feed one inbound audio frame to STT (resampled) and detect barge-in."""
        if not slin8k:
            return
        # Fast energy-based barge-in: if the agent is speaking and we detect
        # sustained caller energy, interrupt right away (don't wait for STT).
        if self.agent.interruptible and self._speaking.is_set():
            if audiolib.rms(slin8k) >= BARGEIN_RMS:
                self._bargein_run += 1
                if self._bargein_run >= BARGEIN_FRAMES:
                    self._trigger_bargein()
            else:
                self._bargein_run = 0

        # Resample 8k → 16k for the STT provider and forward.
        pcm16 = self._up.process(slin8k)
        if pcm16:
            await self.stt.send_audio(pcm16)

    def _trigger_bargein(self) -> None:
        """Cancel in-flight TTS + LLM so the caller can take the turn."""
        if not self._speaking.is_set():
            return
        logger.info("[%s] barge-in", self.call_uuid)
        self._cancel_speech.set()
        if self._llm_task and not self._llm_task.done():
            self._llm_task.cancel()

    # ------------------------------------------------------------------
    # STT transcripts → turn handling
    # ------------------------------------------------------------------
    async def _on_transcript(self, t: Transcript) -> None:
        """Handle interim/final transcripts from the STT provider."""
        if t.text and self.agent.interruptible and self._speaking.is_set():
            # Interim words while the agent is talking → barge-in.
            self._trigger_bargein()

        if not t.is_final:
            return
        text = t.text.strip()
        if not text:
            return

        # End-keyword check (caller said "goodbye"): finish gracefully.
        if self._matches_end_keyword(text):
            self.transcript_turns.append(self._turn("user", text))
            self.messages.append({"role": "user", "content": text})
            await self._speak("Thanks for calling. Goodbye!", role="assistant")
            await self._request_hangup()
            return

        await self.on_user_utterance(text)

    def _matches_end_keyword(self, text: str) -> bool:
        low = text.lower()
        return any(kw and kw.lower() in low for kw in (self.agent.end_keywords or []))

    async def on_user_utterance(self, text: str) -> None:
        """A final user utterance → run the LLM turn (serialized)."""
        async with self._turn_lock:
            if self._ended.is_set() or self._hangup_requested:
                return
            self.turn_count += 1
            self.transcript_turns.append(self._turn("user", text))
            self.messages.append({"role": "user", "content": text})

            if self.turn_count > self.agent.max_turns:
                await self._speak(
                    "I've reached my limit for this call. Let me hand you off.",
                    role="assistant",
                )
                await self._do_transfer("max_turns reached")
                await self._request_hangup()
                return

            # Optional KB grounding before the turn.
            kb_context = await self._kb_context(text)
            system = build_system_prompt(self.agent, kb_context)
            tools = assemble_tools(self.agent)

            self._cancel_speech.clear()
            self._llm_task = asyncio.create_task(
                self._run_llm_turn(system, tools)
            )
            try:
                await self._llm_task
            except asyncio.CancelledError:
                logger.debug("[%s] llm turn cancelled (barge-in)", self.call_uuid)

    async def _kb_context(self, query: str) -> Optional[str]:
        if not self.agent.knowledge_base_id:
            return None
        chunks = await self.db.search_kb(self.agent.knowledge_base_id, query)
        if not chunks:
            return None
        return "\n\n".join(
            f"[{c.get('title') or 'doc'}] {c['content']}" for c in chunks
        )[:4000]

    async def _run_llm_turn(self, system: str, tools: list[dict[str, Any]]) -> None:
        """Stream the assistant turn; speak sentences as they complete."""
        # Buffer streamed text into speakable sentence chunks for low latency.
        buffer: list[str] = []
        spoken_any = False

        async def on_text(chunk: str) -> None:
            nonlocal spoken_any
            buffer.append(chunk)
            joined = "".join(buffer)
            # Flush on sentence boundaries so TTS starts before the full reply.
            idx = _last_sentence_boundary(joined)
            if idx > 0:
                to_speak = joined[:idx].strip()
                remainder = joined[idx:]
                buffer.clear()
                if remainder:
                    buffer.append(remainder)
                if to_speak:
                    spoken_any = True
                    await self._speak(to_speak, role=None)

        result = await self.brain.stream_turn(
            agent=self.agent,
            messages=self.messages,
            system=system,
            tools=tools,
            tool_executor=self._execute_tool,
            on_text=on_text,
        )

        # Speak any trailing text not yet flushed.
        tail = "".join(buffer).strip()
        if tail and not self._cancel_speech.is_set():
            await self._speak(tail, role=None)

        # Record the assistant's full spoken text as a transcript turn.
        if result.text:
            self.transcript_turns.append(self._turn("assistant", result.text))

        # Act on side-effect tool calls (end_call requested hangup).
        if self._hangup_requested:
            await self._request_hangup()

    # ------------------------------------------------------------------
    # Tool execution (manual loop callback from llm.stream_turn)
    # ------------------------------------------------------------------
    async def _execute_tool(self, name: str, tinput: dict[str, Any]) -> str:
        logger.info("[%s] tool %s %s", self.call_uuid, name, tinput)
        if name == "lookup_knowledge":
            query = tinput.get("query", "")
            ctx = await self._kb_context(query)
            return ctx or "No matching knowledge was found."
        if name == "transfer_to_human":
            await self._do_transfer(tinput.get("reason", "caller requested"))
            return "Transfer initiated. Tell the caller you're connecting them now."
        if name == "end_call":
            farewell = tinput.get("farewell")
            if farewell:
                await self._speak(farewell, role="assistant")
            self._hangup_requested = True
            return "Call will end after this turn."
        if name == "schedule_callback":
            return await self._schedule_callback(tinput)
        # Tenant-defined webhook tool.
        return await self._call_webhook_tool(name, tinput)

    async def _do_transfer(self, reason: str) -> None:
        """Record a transfer intent. Asterisk performs the actual bridge based on
        the agent's fallback_dest_*; here we flag it in call metadata."""
        logger.info("[%s] transfer: %s", self.call_uuid, reason)
        self.transcript_turns.append(
            self._turn("system", f"transfer_to_human: {reason}")
        )
        self._hangup_requested = True  # hand back to dialplan fallback

    async def _schedule_callback(self, tinput: dict[str, Any]) -> str:
        phone = tinput.get("phone", "")
        when = tinput.get("when", "")
        self.transcript_turns.append(
            self._turn("system", f"schedule_callback {phone} @ {when}")
        )
        return f"Callback scheduled for {when} to {phone}."

    async def _call_webhook_tool(self, name: str, tinput: dict[str, Any]) -> str:
        """Dispatch a tenant-defined tool to its webhook URL (x_webhook)."""
        url = None
        for raw in self.agent.tools or []:
            if isinstance(raw, dict) and raw.get("name") == name:
                url = raw.get("x_webhook") or raw.get("webhook_url")
                break
        if not url:
            return f"Tool {name} is not configured with a webhook."
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(
                    url,
                    json={
                        "call_uuid": self.call_uuid,
                        "tenant_id": self.agent.tenant_id,
                        "agent_id": self.agent.id,
                        "tool": name,
                        "input": tinput,
                    },
                )
                resp.raise_for_status()
                data = resp.text
        except Exception:  # noqa: BLE001
            logger.exception("webhook tool %s failed", name)
            return f"The {name} action could not be completed right now."
        return data[:2000]

    # ------------------------------------------------------------------
    # TTS playback
    # ------------------------------------------------------------------
    async def _speak(
        self, text: str, *, role: Optional[str] = "assistant", record_turn: bool = False
    ) -> None:
        """Synthesize ``text`` and stream it to the caller, honoring barge-in."""
        text = (text or "").strip()
        if not text or self._ended.is_set():
            return
        if record_turn and role:
            self.transcript_turns.append(self._turn(role, text))

        self._cancel_speech.clear()
        self._speaking.set()
        self._bargein_run = 0
        try:
            async for slin8k in self.tts.synthesize(text):
                if self._cancel_speech.is_set() or self._ended.is_set():
                    break
                if self._record:
                    self._rec_buf.extend(slin8k)
                await self.conn.send_audio(slin8k)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            logger.exception("[%s] speak error", self.call_uuid)
        finally:
            self._speaking.clear()

    # ------------------------------------------------------------------
    # Hangup + post-call persistence
    # ------------------------------------------------------------------
    async def _request_hangup(self) -> None:
        if self._hangup_requested and self._ended.is_set():
            return
        self._hangup_requested = True
        try:
            await self.conn.send_terminate()
        except Exception:  # noqa: BLE001
            pass
        self._ended.set()

    async def _finalize_call(self) -> None:
        """Persist transcript + summary/sentiment; upload recording if enabled."""
        talk_seconds = int(time.monotonic() - self._started_at)
        full_text = self._render_transcript()

        if self._db_call_id and full_text.strip():
            await self.db.save_transcript(
                self._db_call_id,
                self.transcript_turns,
                full_text,
                language=self.agent.language,
            )

        summary = await self.brain.summarize_call(
            full_text, language=self.agent.language
        )

        if self._db_call_id:
            await self.db.finalize_call(
                self._db_call_id,
                summary=summary.get("summary") or None,
                sentiment=summary.get("sentiment"),
                sentiment_score=summary.get("sentiment_score"),
                tags=summary.get("tags") or [],
                talk_seconds=talk_seconds,
                disposition="answered",
                metadata={
                    "ai_turns": self.turn_count,
                    "action_items": summary.get("action_items", []),
                    "transferred": self._hangup_requested,
                },
            )

        # Optional recording upload.
        if self._record and self._rec_buf and self._db_call_id:
            key = f"recordings/{self.agent.tenant_id}/{self.call_uuid}.wav"
            meta = await self.store.upload_recording(
                key, bytes(self._rec_buf), self.settings.asterisk_sample_rate
            )
            if meta:
                await self.db.attach_recording(
                    self._db_call_id,
                    self.agent.tenant_id,
                    meta["s3_key"],
                    meta["duration"],
                    meta["size_bytes"],
                )

    # ------------------------------------------------------------------
    # Helpers / public status
    # ------------------------------------------------------------------
    def _turn(self, role: str, text: str) -> dict[str, Any]:
        return {
            "role": role,
            "speaker": "caller" if role == "user" else "agent",
            "text": text,
            "ts": round(time.monotonic() - self._started_at, 2),
        }

    def _render_transcript(self) -> str:
        lines = []
        for t in self.transcript_turns:
            who = "Caller" if t["role"] == "user" else (
                "Agent" if t["role"] == "assistant" else "System"
            )
            lines.append(f"{who}: {t['text']}")
        return "\n".join(lines)

    async def force_summary(self) -> dict[str, Any]:
        """On-demand summary (POST /calls/{uuid}/summary)."""
        return await self.brain.summarize_call(
            self._render_transcript(), language=self.agent.language
        )

    def status(self) -> dict[str, Any]:
        return {
            "call_uuid": self.call_uuid,
            "agent_id": self.agent.id,
            "tenant_id": self.agent.tenant_id,
            "turns": self.turn_count,
            "speaking": self._speaking.is_set(),
            "ended": self._ended.is_set(),
            "channel_id": self.channel_id,
        }


def _last_sentence_boundary(text: str) -> int:
    """Index just past the last sentence-ending punctuation, else 0.

    Lets us flush complete sentences to TTS as the LLM streams, cutting latency
    without chopping words mid-sentence.
    """
    best = 0
    for i, ch in enumerate(text):
        if ch in ".!?。！？" and i + 1 < len(text) and text[i + 1] in " \n\t":
            best = i + 1
    # Also flush on a clear clause break if the buffer is getting long.
    if best == 0 and len(text) > 160:
        comma = text.rfind(", ")
        if comma > 0:
            best = comma + 1
    return best
