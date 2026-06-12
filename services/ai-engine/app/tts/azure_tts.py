"""Azure Cognitive Services TTS.

Uses the REST synthesis endpoint with a `riff-8khz-16bit-mono-pcm` output
format, which already matches Asterisk slin8k — so no resampling is needed. We
strip the 44-byte WAV/RIFF header and yield the raw PCM body.
"""
from __future__ import annotations

import logging
from typing import AsyncIterator, Optional

import httpx

from ..config import Settings
from .base import TTSProvider

logger = logging.getLogger("aipbx.tts.azure")

WAV_HEADER_BYTES = 44


class AzureTTS(TTSProvider):
    name = "azure"

    def __init__(
        self,
        settings: Settings,
        voice_id: Optional[str] = None,
        language: Optional[str] = None,
    ) -> None:
        super().__init__(settings, voice_id=voice_id, language=language)
        self.voice = voice_id or "en-US-JennyNeural"
        self._client = httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=5.0))

    @property
    def _endpoint(self) -> str:
        region = self.settings.azure_tts_region
        return f"https://{region}.tts.speech.microsoft.com/cognitiveservices/v1"

    def _ssml(self, text: str) -> str:
        lang = self.language or "en-US"
        if "-" not in lang:
            lang = f"{lang}-US"
        safe = (
            text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        )
        return (
            f"<speak version='1.0' xml:lang='{lang}'>"
            f"<voice xml:lang='{lang}' name='{self.voice}'>{safe}</voice>"
            f"</speak>"
        )

    async def synthesize(self, text: str) -> AsyncIterator[bytes]:
        text = (text or "").strip()
        if not text:
            return
        headers = {
            "Ocp-Apim-Subscription-Key": self.settings.azure_tts_key,
            "Content-Type": "application/ssml+xml",
            # 8kHz mono 16-bit PCM matches Asterisk slin directly.
            "X-Microsoft-OutputFormat": "riff-8khz-16bit-mono-pcm",
            "User-Agent": "aipbx-ai-engine",
        }
        stripped_header = False
        try:
            async with self._client.stream(
                "POST", self._endpoint, headers=headers, content=self._ssml(text)
            ) as resp:
                if resp.status_code != 200:
                    detail = (await resp.aread())[:200]
                    logger.error("Azure TTS %s: %r", resp.status_code, detail)
                    return
                buffer = b""
                async for chunk in resp.aiter_bytes():
                    if not chunk:
                        continue
                    if not stripped_header:
                        buffer += chunk
                        if len(buffer) <= WAV_HEADER_BYTES:
                            continue
                        chunk = buffer[WAV_HEADER_BYTES:]
                        stripped_header = True
                        buffer = b""
                    yield chunk
        except Exception:  # noqa: BLE001
            logger.exception("Azure TTS synthesis failed")
            return

    async def aclose(self) -> None:
        await self._client.aclose()
