"""Speech-to-text provider abstraction.

Providers consume 16kHz mono 16-bit PCM (slin16) chunks and emit interim and
final transcripts via an async callback. The factory picks an implementation
from the agent config / env and falls back gracefully when keys are missing.
"""
from __future__ import annotations

import logging
from typing import Optional

from ..config import Settings, get_settings
from ..db import AgentConfig
from .base import STTProvider, Transcript, TranscriptCallback

logger = logging.getLogger("aipbx.stt")

__all__ = [
    "STTProvider",
    "Transcript",
    "TranscriptCallback",
    "create_stt",
]


def create_stt(
    agent: AgentConfig,
    on_transcript: TranscriptCallback,
    settings: Optional[Settings] = None,
) -> STTProvider:
    """Build the STT provider for a call, honoring agent.stt_provider then env."""
    settings = settings or get_settings()
    provider = (agent.stt_provider or settings.stt_provider or "deepgram").lower()
    language = agent.language or "en"

    if provider == "deepgram":
        if settings.deepgram_api_key:
            from .deepgram import DeepgramSTT

            return DeepgramSTT(on_transcript, settings, language=language)
        logger.warning("DEEPGRAM_API_KEY missing — falling back to local STT stub")
    elif provider == "openai":
        if settings.openai_api_key:
            from .openai_whisper import OpenAIWhisperSTT

            return OpenAIWhisperSTT(on_transcript, settings, language=language)
        logger.warning("OPENAI_API_KEY missing — falling back to local STT stub")
    elif provider == "whisper-local":
        from .local import LocalSTT

        return LocalSTT(on_transcript, settings, language=language)

    from .local import LocalSTT

    return LocalSTT(on_transcript, settings, language=language)
