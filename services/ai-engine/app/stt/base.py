"""STT provider base class and transcript types."""
from __future__ import annotations

import abc
from dataclasses import dataclass
from typing import Awaitable, Callable

from ..config import Settings


@dataclass
class Transcript:
    """A transcript emitted by an STT provider.

    ``is_final`` marks an utterance the engine should act on (call the LLM);
    interim results are used only for barge-in / UI.
    """

    text: str
    is_final: bool
    confidence: float = 1.0
    language: str = "en"
    # ``speech_final`` (endpointing) — Deepgram fires this when the speaker has
    # likely finished a turn. Used to decide when to hand off to the LLM.
    speech_final: bool = False


# Called by the provider for each interim/final transcript.
TranscriptCallback = Callable[[Transcript], Awaitable[None]]


class STTProvider(abc.ABC):
    """Streaming speech-to-text provider.

    Lifecycle: ``start()`` → repeated ``send_audio(pcm16)`` → ``finish()``.
    Audio is 16kHz mono 16-bit signed-linear PCM. Transcripts are delivered out
    of band via the ``on_transcript`` callback supplied at construction.
    """

    name = "base"

    def __init__(
        self,
        on_transcript: TranscriptCallback,
        settings: Settings,
        language: str = "en",
    ) -> None:
        self.on_transcript = on_transcript
        self.settings = settings
        self.language = language
        self.sample_rate = settings.provider_sample_rate  # 16kHz

    @abc.abstractmethod
    async def start(self) -> None:
        """Open the streaming connection / session."""

    @abc.abstractmethod
    async def send_audio(self, pcm16: bytes) -> None:
        """Feed a chunk of 16kHz mono 16-bit PCM."""

    @abc.abstractmethod
    async def finish(self) -> None:
        """Flush and close the session."""

    async def __aenter__(self) -> "STTProvider":
        await self.start()
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.finish()
