"""TTS provider base class.

Providers stream synthesized audio as 8kHz mono 16-bit slin PCM chunks. The
session pipes those chunks straight into AudioSocket 0x10 frames. Streaming is
important for latency and for barge-in: the session can stop consuming the
async generator the moment the caller interrupts.
"""
from __future__ import annotations

import abc
from typing import AsyncIterator, Optional

from ..config import Settings


class TTSProvider(abc.ABC):
    """Streaming text-to-speech provider producing slin 8kHz audio."""

    name = "base"

    def __init__(
        self,
        settings: Settings,
        voice_id: Optional[str] = None,
        language: Optional[str] = None,
    ) -> None:
        self.settings = settings
        self.voice_id = voice_id
        self.language = language or "en"
        self.target_rate = settings.asterisk_sample_rate  # 8kHz slin for Asterisk

    @abc.abstractmethod
    def synthesize(self, text: str) -> AsyncIterator[bytes]:
        """Yield slin (8kHz mono 16-bit) PCM chunks for ``text``.

        Implemented as an async generator. Consumers may stop iterating early
        (barge-in) — providers must tolerate a closed generator.
        """
        raise NotImplementedError

    async def aclose(self) -> None:
        """Release any held resources (HTTP clients, sockets)."""
        return None
