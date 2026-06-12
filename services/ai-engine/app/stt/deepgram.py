"""Deepgram streaming STT over WebSocket.

Connects to Deepgram's real-time listen API and streams 16kHz linear16 audio,
emitting interim and final transcripts (plus endpointing via ``speech_final``)
through the async callback. Fully implemented — Deepgram is the default STT.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Optional
from urllib.parse import urlencode

import websockets

from ..config import Settings
from .base import STTProvider, Transcript, TranscriptCallback

logger = logging.getLogger("aipbx.stt.deepgram")

DEEPGRAM_WS = "wss://api.deepgram.com/v1/listen"


class DeepgramSTT(STTProvider):
    name = "deepgram"

    def __init__(
        self,
        on_transcript: TranscriptCallback,
        settings: Settings,
        language: str = "en",
    ) -> None:
        super().__init__(on_transcript, settings, language=language)
        self._ws: Optional[websockets.WebSocketClientProtocol] = None
        self._reader_task: Optional[asyncio.Task] = None
        self._closing = False

    def _url(self) -> str:
        params = {
            "encoding": "linear16",
            "sample_rate": str(self.sample_rate),
            "channels": "1",
            "model": "nova-2",
            "language": self.language or "en",
            "interim_results": "true",
            "smart_format": "true",
            "punctuate": "true",
            # Endpointing: Deepgram flags speech_final after this much silence.
            "endpointing": "300",
            "vad_events": "true",
        }
        return f"{DEEPGRAM_WS}?{urlencode(params)}"

    async def start(self) -> None:
        headers = {"Authorization": f"Token {self.settings.deepgram_api_key}"}
        try:
            self._ws = await websockets.connect(
                self._url(),
                extra_headers=headers,
                ping_interval=5,
                ping_timeout=20,
                max_size=None,
            )
        except Exception:  # noqa: BLE001
            logger.exception("Deepgram connect failed")
            self._ws = None
            return
        self._reader_task = asyncio.create_task(self._reader())
        logger.info("Deepgram STT stream open (lang=%s)", self.language)

    async def _reader(self) -> None:
        assert self._ws is not None
        try:
            async for raw in self._ws:
                try:
                    msg = json.loads(raw)
                except (json.JSONDecodeError, TypeError):
                    continue
                if msg.get("type") == "Results" or "channel" in msg:
                    await self._handle_results(msg)
        except (websockets.ConnectionClosed, asyncio.CancelledError):
            pass
        except Exception:  # noqa: BLE001
            logger.exception("Deepgram reader error")

    async def _handle_results(self, msg: dict) -> None:
        channel = msg.get("channel") or {}
        alts = channel.get("alternatives") or []
        if not alts:
            return
        alt = alts[0]
        text = (alt.get("transcript") or "").strip()
        if not text:
            return
        is_final = bool(msg.get("is_final"))
        speech_final = bool(msg.get("speech_final"))
        await self.on_transcript(
            Transcript(
                text=text,
                is_final=is_final,
                confidence=float(alt.get("confidence", 1.0)),
                language=self.language,
                speech_final=speech_final,
            )
        )

    async def send_audio(self, pcm16: bytes) -> None:
        if self._ws is None or self._closing:
            return
        try:
            await self._ws.send(pcm16)
        except (websockets.ConnectionClosed, OSError):
            self._ws = None

    async def finish(self) -> None:
        self._closing = True
        if self._ws is not None:
            try:
                # CloseStream tells Deepgram to flush remaining audio.
                await self._ws.send(json.dumps({"type": "CloseStream"}))
                await asyncio.wait_for(self._ws.close(), timeout=2.0)
            except (websockets.ConnectionClosed, OSError, asyncio.TimeoutError):
                pass
            self._ws = None
        if self._reader_task:
            self._reader_task.cancel()
            try:
                await self._reader_task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
