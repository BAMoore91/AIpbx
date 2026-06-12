"""OpenAI Whisper STT (chunked, non-streaming).

OpenAI's transcription endpoint is not truly streaming, so this provider buffers
audio and transcribes on utterance boundaries driven by a simple energy VAD:
when it detects a stretch of silence after speech, it flushes the buffered audio
to the transcription API and emits a final transcript. Interim transcripts are
not produced.
"""
from __future__ import annotations

import asyncio
import io
import logging
import struct
import wave
from typing import Optional

import httpx

from .. import audio as audiolib
from ..config import Settings
from .base import STTProvider, Transcript, TranscriptCallback

logger = logging.getLogger("aipbx.stt.openai")

OPENAI_TRANSCRIBE_URL = "https://api.openai.com/v1/audio/transcriptions"
# Energy threshold (RMS) below which a frame is considered silence.
SILENCE_RMS = 350.0
# Trailing silence (seconds) that closes an utterance.
SILENCE_HANG_S = 0.8
MIN_UTTERANCE_S = 0.4


class OpenAIWhisperSTT(STTProvider):
    name = "openai"

    def __init__(
        self,
        on_transcript: TranscriptCallback,
        settings: Settings,
        language: str = "en",
    ) -> None:
        super().__init__(on_transcript, settings, language=language)
        self._buf = bytearray()
        self._silence_run = 0.0
        self._had_speech = False
        self._client: Optional[httpx.AsyncClient] = None
        self._lock = asyncio.Lock()

    async def start(self) -> None:
        self._client = httpx.AsyncClient(timeout=30.0)

    async def send_audio(self, pcm16: bytes) -> None:
        if not pcm16:
            return
        dur_s = audiolib.frame_duration_ms(pcm16, self.sample_rate) / 1000.0
        level = audiolib.rms(pcm16)
        async with self._lock:
            if level >= SILENCE_RMS:
                self._had_speech = True
                self._silence_run = 0.0
                self._buf.extend(pcm16)
            else:
                if self._had_speech:
                    self._buf.extend(pcm16)
                    self._silence_run += dur_s
                    if self._silence_run >= SILENCE_HANG_S:
                        await self._flush()

    async def _flush(self) -> None:
        if not self._buf:
            self._had_speech = False
            self._silence_run = 0.0
            return
        audio_bytes = bytes(self._buf)
        self._buf.clear()
        self._had_speech = False
        self._silence_run = 0.0

        dur = len(audio_bytes) / (self.sample_rate * 2)
        if dur < MIN_UTTERANCE_S or self._client is None:
            return

        wav = _pcm_to_wav(audio_bytes, self.sample_rate)
        try:
            resp = await self._client.post(
                OPENAI_TRANSCRIBE_URL,
                headers={"Authorization": f"Bearer {self.settings.openai_api_key}"},
                files={"file": ("audio.wav", wav, "audio/wav")},
                data={
                    "model": "whisper-1",
                    "language": (self.language or "en")[:2],
                    "response_format": "json",
                },
            )
            resp.raise_for_status()
            text = (resp.json().get("text") or "").strip()
        except Exception:  # noqa: BLE001
            logger.exception("OpenAI transcription failed")
            return
        if text:
            await self.on_transcript(
                Transcript(
                    text=text,
                    is_final=True,
                    language=self.language,
                    speech_final=True,
                )
            )

    async def finish(self) -> None:
        async with self._lock:
            if self._buf:
                await self._flush()
        if self._client is not None:
            await self._client.aclose()
            self._client = None


def _pcm_to_wav(pcm16: bytes, sample_rate: int) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm16)
    return buf.getvalue()


# silence struct import retained for parity with other modules
_ = struct
