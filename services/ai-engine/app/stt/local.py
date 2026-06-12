"""Local / offline STT stub (whisper-local).

A placeholder so the engine runs without any cloud STT credentials. It performs
simple energy-based VAD to detect utterance boundaries but does not transcribe —
it emits an empty final transcript on each detected utterance so the rest of the
pipeline can be exercised. Swap in faster-whisper / whisper.cpp here for a real
offline path.
"""
from __future__ import annotations

import logging

from .. import audio as audiolib
from ..config import Settings
from .base import STTProvider, Transcript, TranscriptCallback

logger = logging.getLogger("aipbx.stt.local")

SILENCE_RMS = 350.0
SILENCE_HANG_S = 0.8


class LocalSTT(STTProvider):
    name = "whisper-local"

    def __init__(
        self,
        on_transcript: TranscriptCallback,
        settings: Settings,
        language: str = "en",
    ) -> None:
        super().__init__(on_transcript, settings, language=language)
        self._had_speech = False
        self._silence_run = 0.0
        logger.warning(
            "Local STT stub active — no transcription. Install a real offline "
            "engine (faster-whisper / whisper.cpp) to enable whisper-local."
        )

    async def start(self) -> None:  # pragma: no cover - trivial
        return None

    async def send_audio(self, pcm16: bytes) -> None:
        if not pcm16:
            return
        level = audiolib.rms(pcm16)
        dur_s = audiolib.frame_duration_ms(pcm16, self.sample_rate) / 1000.0
        if level >= SILENCE_RMS:
            self._had_speech = True
            self._silence_run = 0.0
        elif self._had_speech:
            self._silence_run += dur_s
            if self._silence_run >= SILENCE_HANG_S:
                self._had_speech = False
                self._silence_run = 0.0
                await self.on_transcript(
                    Transcript(text="", is_final=True, speech_final=True)
                )

    async def finish(self) -> None:  # pragma: no cover - trivial
        return None
