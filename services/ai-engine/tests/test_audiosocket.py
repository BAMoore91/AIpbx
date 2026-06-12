"""Unit tests for AudioSocket framing — no network required."""
from __future__ import annotations

import asyncio
import struct
import uuid

import pytest

from app.audiosocket import (
    TYPE_AUDIO,
    TYPE_TERMINATE,
    TYPE_UUID,
    Frame,
    encode_frame,
    iter_audio_frames,
    parse_uuid,
    read_frame,
)


def test_encode_frame_header_and_payload():
    payload = b"\x01\x02\x03\x04"
    frame = encode_frame(TYPE_AUDIO, payload)
    ftype, length = struct.unpack(">BH", frame[:3])
    assert ftype == TYPE_AUDIO
    assert length == len(payload)
    assert frame[3:] == payload


def test_encode_empty_frame():
    frame = encode_frame(TYPE_TERMINATE)
    assert frame == struct.pack(">BH", TYPE_TERMINATE, 0)


def test_iter_audio_frames_chunking():
    pcm = b"\x00\x01" * 500  # 1000 bytes
    frames = list(iter_audio_frames(pcm, chunk=320))
    # 1000 / 320 -> 3 full + 1 partial = 4 frames
    assert len(frames) == 4
    # Each frame must decode to type 0x10 with a correct length header.
    total = b""
    for f in frames:
        ftype, length = struct.unpack(">BH", f[:3])
        assert ftype == TYPE_AUDIO
        assert length == len(f) - 3
        total += f[3:]
    assert total == pcm


def test_parse_uuid_from_16_bytes():
    u = uuid.uuid4()
    assert parse_uuid(u.bytes) == str(u)


def test_parse_uuid_from_ascii():
    u = uuid.uuid4()
    assert parse_uuid(str(u).encode("ascii")) == str(u)


class _FakeReader:
    """Minimal StreamReader stand-in feeding bytes via readexactly."""

    def __init__(self, data: bytes) -> None:
        self._data = data
        self._pos = 0

    async def readexactly(self, n: int) -> bytes:
        if self._pos >= len(self._data):
            raise asyncio.IncompleteReadError(partial=b"", expected=n)
        chunk = self._data[self._pos : self._pos + n]
        if len(chunk) < n:
            self._pos = len(self._data)
            raise asyncio.IncompleteReadError(partial=chunk, expected=n)
        self._pos += n
        return chunk


@pytest.mark.asyncio
async def test_read_frame_roundtrip():
    payload = b"hello-audio"
    data = encode_frame(TYPE_AUDIO, payload)
    reader = _FakeReader(data)
    frame = await read_frame(reader)
    assert isinstance(frame, Frame)
    assert frame.type == TYPE_AUDIO
    assert frame.payload == payload
    assert frame.is_audio


@pytest.mark.asyncio
async def test_read_frame_clean_eof_returns_none():
    reader = _FakeReader(b"")
    assert await read_frame(reader) is None


@pytest.mark.asyncio
async def test_read_frame_multiple_frames_in_stream():
    u = uuid.uuid4()
    stream = encode_frame(TYPE_UUID, u.bytes) + encode_frame(TYPE_AUDIO, b"\x00\x00")
    reader = _FakeReader(stream)
    f1 = await read_frame(reader)
    f2 = await read_frame(reader)
    assert f1.type == TYPE_UUID
    assert parse_uuid(f1.payload) == str(u)
    assert f2.type == TYPE_AUDIO
    assert await read_frame(reader) is None
