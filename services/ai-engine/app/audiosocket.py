"""AudioSocket protocol: raw asyncio TCP server + framing.

Asterisk's AudioSocket bridges a channel's audio to this service over a plain
TCP connection. The wire format is a stream of length-prefixed frames:

    +--------+------------------+------------------------+
    | 1 byte | 2 bytes (BE u16) |   <length> bytes       |
    |  type  |     length       |        payload         |
    +--------+------------------+------------------------+

Frame types (matching Asterisk app_audiosocket / res_audiosocket):
    0x00  TERMINATE  — hangup / close the connection (payload empty)
    0x01  UUID       — the call UUID as 16 raw bytes (first frame Asterisk sends)
    0x03  ERROR      — error from Asterisk (1-byte error code payload)
    0x10  AUDIO      — slin: 8kHz, 16-bit, mono, signed-linear PCM
    0xff  LOG/DTMF   — out-of-band log / control (vendor-specific; we just log it)

Audio payload is signed-linear ("slin") at 8kHz mono 16-bit. To PLAY audio to
the caller we send 0x10 frames of slin, chunked into ~20ms (320-byte) frames so
Asterisk paces them smoothly and barge-in stays responsive.

This module is provider-agnostic: it only does framing + connection handling and
hands each connection to a CallSession (resolved from the UUID via the registry).
"""
from __future__ import annotations

import asyncio
import logging
import struct
import uuid
from dataclasses import dataclass
from typing import Awaitable, Callable, Optional

logger = logging.getLogger("aipbx.audiosocket")

# ---- Frame type constants ----
TYPE_TERMINATE = 0x00
TYPE_UUID = 0x01
TYPE_ERROR = 0x03
TYPE_AUDIO = 0x10
TYPE_DTMF = 0x11  # some Asterisk builds emit DTMF on 0x11
TYPE_LOG = 0xFF

_HEADER = struct.Struct(">BH")  # type (u8) + length (big-endian u16)
MAX_PAYLOAD = 0xFFFF

# 20ms of slin @ 8kHz mono 16-bit = 160 samples * 2 bytes.
DEFAULT_AUDIO_CHUNK = 320


@dataclass
class Frame:
    """A decoded AudioSocket frame."""

    type: int
    payload: bytes

    @property
    def is_audio(self) -> bool:
        return self.type == TYPE_AUDIO

    @property
    def is_terminate(self) -> bool:
        return self.type == TYPE_TERMINATE


def encode_frame(ftype: int, payload: bytes = b"") -> bytes:
    """Encode a single AudioSocket frame (type + BE length + payload)."""
    if len(payload) > MAX_PAYLOAD:
        raise ValueError(f"payload too large for one frame: {len(payload)} bytes")
    return _HEADER.pack(ftype, len(payload)) + payload


def iter_audio_frames(pcm: bytes, chunk: int = DEFAULT_AUDIO_CHUNK):
    """Yield 0x10 audio frames for a slin PCM buffer, ~20ms per frame.

    The trailing partial chunk (if any) is still emitted so no audio is dropped.
    """
    for i in range(0, len(pcm), chunk):
        yield encode_frame(TYPE_AUDIO, pcm[i : i + chunk])


async def read_frame(reader: asyncio.StreamReader) -> Optional[Frame]:
    """Read exactly one frame, handling partial TCP reads.

    Returns None on a clean EOF (connection closed). `readexactly` raises
    IncompleteReadError on a truncated frame, which we translate to EOF.
    """
    try:
        header = await reader.readexactly(_HEADER.size)
    except asyncio.IncompleteReadError as exc:
        if not exc.partial:
            return None  # clean EOF at a frame boundary
        logger.debug("truncated header (%d bytes) — treating as EOF", len(exc.partial))
        return None

    ftype, length = _HEADER.unpack(header)
    if length == 0:
        return Frame(ftype, b"")

    try:
        payload = await reader.readexactly(length)
    except asyncio.IncompleteReadError:
        logger.warning("truncated payload for type=0x%02x len=%d", ftype, length)
        return None
    return Frame(ftype, payload)


def parse_uuid(payload: bytes) -> str:
    """Parse the 16-byte UUID payload from a 0x01 frame into canonical string.

    Asterisk sends the UUID as 16 raw bytes. If a build sends it as ASCII text
    instead, fall back to decoding it as a string.
    """
    if len(payload) == 16:
        return str(uuid.UUID(bytes=payload))
    text = payload.decode("ascii", errors="ignore").strip().strip("\x00")
    return str(uuid.UUID(text))  # raises if not a valid UUID


class AudioSocketConnection:
    """Wraps a single AudioSocket TCP connection with framed I/O + a send lock."""

    def __init__(
        self,
        reader: asyncio.StreamReader,
        writer: asyncio.StreamWriter,
    ) -> None:
        self.reader = reader
        self.writer = writer
        self._write_lock = asyncio.Lock()
        self.peer = writer.get_extra_info("peername")
        self.closed = False

    async def read_frame(self) -> Optional[Frame]:
        return await read_frame(self.reader)

    async def send_audio(self, pcm_slin8k: bytes, chunk: int = DEFAULT_AUDIO_CHUNK) -> None:
        """Send slin (8kHz mono 16-bit) PCM to the caller as 0x10 audio frames.

        Serialized via a lock so concurrent speak() calls never interleave bytes.
        """
        if not pcm_slin8k:
            return
        async with self._write_lock:
            if self.closed:
                return
            for frame in iter_audio_frames(pcm_slin8k, chunk):
                self.writer.write(frame)
            await self.writer.drain()

    async def send_terminate(self) -> None:
        """Ask Asterisk to hang up the channel."""
        async with self._write_lock:
            if self.closed:
                return
            self.writer.write(encode_frame(TYPE_TERMINATE))
            try:
                await self.writer.drain()
            except (ConnectionError, OSError):
                pass

    async def close(self) -> None:
        if self.closed:
            return
        self.closed = True
        try:
            self.writer.close()
            await self.writer.wait_closed()
        except (ConnectionError, OSError):
            pass


# A handler receives (uuid_str, connection) and runs the session loop.
ConnectionHandler = Callable[[str, AudioSocketConnection], Awaitable[None]]


class AudioSocketServer:
    """Asyncio TCP server that accepts AudioSocket connections.

    On each connection it reads frames until it sees the 0x01 UUID frame, then
    delegates to the handler (which resolves the registered CallSession and runs
    the real-time loop, feeding it audio frames as they arrive).
    """

    def __init__(
        self,
        host: str,
        port: int,
        handler: ConnectionHandler,
    ) -> None:
        self.host = host
        self.port = port
        self.handler = handler
        self._server: Optional[asyncio.AbstractServer] = None

    async def start(self) -> None:
        self._server = await asyncio.start_server(
            self._on_connection, self.host, self.port
        )
        sockets = ", ".join(str(s.getsockname()) for s in self._server.sockets or [])
        logger.info("AudioSocket TCP server listening on %s", sockets)

    async def serve_forever(self) -> None:
        if self._server is None:
            await self.start()
        assert self._server is not None
        async with self._server:
            await self._server.serve_forever()

    async def stop(self) -> None:
        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()
            logger.info("AudioSocket server stopped")

    async def _on_connection(
        self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter
    ) -> None:
        conn = AudioSocketConnection(reader, writer)
        logger.info("AudioSocket connection from %s", conn.peer)
        call_uuid: Optional[str] = None
        try:
            # The first meaningful frame must be the UUID (0x01). We tolerate a
            # leading audio/log frame just in case, but expect UUID immediately.
            while call_uuid is None:
                frame = await conn.read_frame()
                if frame is None:
                    logger.info("connection closed before UUID frame")
                    return
                if frame.type == TYPE_UUID:
                    try:
                        call_uuid = parse_uuid(frame.payload)
                    except (ValueError, Exception):  # noqa: BLE001
                        logger.error("invalid UUID frame payload: %r", frame.payload)
                        return
                elif frame.type == TYPE_TERMINATE:
                    return
                elif frame.type == TYPE_ERROR:
                    logger.warning("error frame before UUID: %r", frame.payload)
                # ignore stray audio/log frames before the UUID arrives

            logger.info("AudioSocket bound to call_uuid=%s", call_uuid)
            await self.handler(call_uuid, conn)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            logger.exception("AudioSocket connection handler crashed")
        finally:
            await conn.close()
            logger.info("AudioSocket connection from %s closed", conn.peer)
