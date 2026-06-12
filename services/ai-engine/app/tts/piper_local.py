"""Piper (offline) TTS stub.

Placeholder so the engine runs with no cloud TTS credentials. It synthesizes a
short stretch of silence sized to the text length so the AudioSocket pipeline is
exercised end to end. Swap in a real Piper invocation (subprocess piping slin)
for genuine offline speech.
"""
from __future__ import annotations

import logging
from typing import AsyncIterator, Optional

from .. import audio as audiolib
from ..config import Settings
from .base import TTSProvider

logger = logging.getLogger("aipbx.tts.piper")

# Rough speaking rate to size the silence stub: ~12 chars/sec.
CHARS_PER_SEC = 12.0
CHUNK_MS = 20


class PiperLocalTTS(TTSProvider):
    name = "piper-local"

    def __init__(
        self,
        settings: Settings,
        voice_id: Optional[str] = None,
        language: Optional[str] = None,
    ) -> None:
        super().__init__(settings, voice_id=voice_id, language=language)
        logger.warning(
            "Piper TTS stub active — emitting silence. Install piper and wire it "
            "here for real offline speech."
        )

    async def synthesize(self, text: str) -> AsyncIterator[bytes]:
        text = (text or "").strip()
        if not text:
            return
        total_ms = max(CHUNK_MS, int(len(text) / CHARS_PER_SEC * 1000))
        emitted = 0
        while emitted < total_ms:
            step = min(CHUNK_MS, total_ms - emitted)
            yield audiolib.silence(step, self.target_rate)
            emitted += step
