"""Text-to-speech provider abstraction.

Providers turn text into audio and yield 8kHz mono 16-bit signed-linear PCM
chunks (slin8k) ready to send to Asterisk over AudioSocket. Each provider does
its own resampling from the rate its API returns down to 8kHz. The factory picks
an implementation from the agent config / env and falls back gracefully when
keys are missing.
"""
from __future__ import annotations

import logging
from typing import Optional

from ..config import Settings, get_settings
from ..db import AgentConfig
from .base import TTSProvider

logger = logging.getLogger("aipbx.tts")

__all__ = ["TTSProvider", "create_tts"]


def create_tts(
    agent: AgentConfig, settings: Optional[Settings] = None
) -> TTSProvider:
    """Build the TTS provider for a call, honoring agent.tts_provider then env."""
    settings = settings or get_settings()
    provider = (agent.tts_provider or settings.tts_provider or "elevenlabs").lower()
    voice_id = agent.voice_id or settings.elevenlabs_voice_id

    if provider == "elevenlabs":
        if settings.elevenlabs_api_key:
            from .elevenlabs import ElevenLabsTTS

            return ElevenLabsTTS(settings, voice_id=voice_id, language=agent.language)
        logger.warning("ELEVENLABS_API_KEY missing — falling back to local TTS stub")
    elif provider == "openai":
        if settings.openai_api_key:
            from .openai_tts import OpenAITTS

            return OpenAITTS(settings, voice_id=voice_id, language=agent.language)
        logger.warning("OPENAI_API_KEY missing — falling back to local TTS stub")
    elif provider == "azure":
        if settings.azure_tts_key and settings.azure_tts_region:
            from .azure_tts import AzureTTS

            return AzureTTS(settings, voice_id=voice_id, language=agent.language)
        logger.warning("AZURE_TTS_* missing — falling back to local TTS stub")
    elif provider == "piper-local":
        from .piper_local import PiperLocalTTS

        return PiperLocalTTS(settings, voice_id=voice_id, language=agent.language)

    from .piper_local import PiperLocalTTS

    return PiperLocalTTS(settings, voice_id=voice_id, language=agent.language)
