"""ElevenLabs streaming TTS.

Requests PCM at 16kHz from ElevenLabs' streaming endpoint and resamples to 8kHz
slin for AudioSocket, yielding chunks as they arrive so the caller hears speech
with minimal latency. Fully implemented — ElevenLabs is the default TTS.
"""
from __future__ import annotations

import logging
from typing import AsyncIterator, Optional

import httpx

from .. import audio as audiolib
from ..config import Settings
from .base import TTSProvider

logger = logging.getLogger("aipbx.tts.elevenlabs")

# pcm_16000 => raw little-endian 16-bit PCM at 16kHz (we downsample to 8k).
ELEVEN_RATE = 16000
ELEVEN_BASE = "https://api.elevenlabs.io/v1/text-to-speech"


class ElevenLabsTTS(TTSProvider):
    name = "elevenlabs"

    def __init__(
        self,
        settings: Settings,
        voice_id: Optional[str] = None,
        language: Optional[str] = None,
    ) -> None:
        super().__init__(settings, voice_id=voice_id, language=language)
        self.voice_id = voice_id or settings.elevenlabs_voice_id
        self._client = httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=5.0))

    async def synthesize(self, text: str) -> AsyncIterator[bytes]:
        text = (text or "").strip()
        if not text:
            return
        url = f"{ELEVEN_BASE}/{self.voice_id}/stream"
        params = {"output_format": f"pcm_{ELEVEN_RATE}", "optimize_streaming_latency": "3"}
        headers = {
            "xi-api-key": self.settings.elevenlabs_api_key,
            "accept": "audio/pcm",
            "content-type": "application/json",
        }
        body = {
            "text": text,
            "model_id": "eleven_turbo_v2_5",
            "voice_settings": {"stability": 0.5, "similarity_boost": 0.8},
        }

        # ratecv carries filter state across chunks so boundaries don't click.
        resampler = audiolib.Resampler(ELEVEN_RATE, self.target_rate)
        try:
            async with self._client.stream(
                "POST", url, params=params, headers=headers, json=body
            ) as resp:
                if resp.status_code != 200:
                    detail = (await resp.aread())[:200]
                    logger.error("ElevenLabs %s: %r", resp.status_code, detail)
                    return
                async for chunk in resp.aiter_bytes():
                    if chunk:
                        out = resampler.process(chunk)
                        if out:
                            yield out
        except Exception:  # noqa: BLE001
            logger.exception("ElevenLabs synthesis failed")
            return

    async def aclose(self) -> None:
        await self._client.aclose()
