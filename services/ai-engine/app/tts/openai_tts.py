"""OpenAI TTS.

Requests 24kHz PCM from OpenAI's speech endpoint and resamples to 8kHz slin.
OpenAI returns the audio body as a stream we read incrementally.
"""
from __future__ import annotations

import logging
from typing import AsyncIterator, Optional

import httpx

from .. import audio as audiolib
from ..config import Settings
from .base import TTSProvider

logger = logging.getLogger("aipbx.tts.openai")

OPENAI_TTS_URL = "https://api.openai.com/v1/audio/speech"
OPENAI_RATE = 24000  # pcm response_format is 24kHz mono 16-bit


class OpenAITTS(TTSProvider):
    name = "openai"

    def __init__(
        self,
        settings: Settings,
        voice_id: Optional[str] = None,
        language: Optional[str] = None,
    ) -> None:
        super().__init__(settings, voice_id=voice_id, language=language)
        # OpenAI voices: alloy, echo, fable, onyx, nova, shimmer.
        self.voice = voice_id or "alloy"
        self._client = httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=5.0))

    async def synthesize(self, text: str) -> AsyncIterator[bytes]:
        text = (text or "").strip()
        if not text:
            return
        headers = {"Authorization": f"Bearer {self.settings.openai_api_key}"}
        body = {
            "model": "gpt-4o-mini-tts",
            "voice": self.voice,
            "input": text,
            "response_format": "pcm",
        }
        resampler = audiolib.Resampler(OPENAI_RATE, self.target_rate)
        try:
            async with self._client.stream(
                "POST", OPENAI_TTS_URL, headers=headers, json=body
            ) as resp:
                if resp.status_code != 200:
                    detail = (await resp.aread())[:200]
                    logger.error("OpenAI TTS %s: %r", resp.status_code, detail)
                    return
                async for chunk in resp.aiter_bytes():
                    if chunk:
                        out = resampler.process(chunk)
                        if out:
                            yield out
        except Exception:  # noqa: BLE001
            logger.exception("OpenAI TTS synthesis failed")
            return

    async def aclose(self) -> None:
        await self._client.aclose()
