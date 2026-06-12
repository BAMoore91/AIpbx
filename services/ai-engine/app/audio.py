"""Audio helpers: resampling and companding between Asterisk slin (8kHz) and the
sample rates STT/TTS providers expect (typically 16kHz mono 16-bit).

Uses the stdlib `audioop` module (ratecv for resampling, lin2ulaw/ulaw2lin for
companding). `audioop` is removed in Python 3.13+, so we guard the import and
fall back to a small numpy-based resampler if it is unavailable.
"""
from __future__ import annotations

import logging
from typing import Optional, Tuple

logger = logging.getLogger("aipbx.audio")

try:  # stdlib through 3.12; "audioop-lts" backport otherwise
    import audioop  # type: ignore

    _HAVE_AUDIOOP = True
except Exception:  # noqa: BLE001
    audioop = None  # type: ignore
    _HAVE_AUDIOOP = False
    import numpy as _np

SAMPLE_WIDTH = 2  # 16-bit PCM
CHANNELS = 1


class Resampler:
    """Stateful linear resampler for one direction of one stream.

    `audioop.ratecv` carries filter state across calls so chunk boundaries don't
    click; we keep that state per-instance. Create one per (src,dst) direction
    per call.
    """

    def __init__(self, src_rate: int, dst_rate: int) -> None:
        self.src_rate = src_rate
        self.dst_rate = dst_rate
        self._state: Optional[object] = None

    def process(self, pcm: bytes) -> bytes:
        if not pcm or self.src_rate == self.dst_rate:
            return pcm
        if _HAVE_AUDIOOP:
            converted, self._state = audioop.ratecv(
                pcm, SAMPLE_WIDTH, CHANNELS, self.src_rate, self.dst_rate, self._state
            )
            return converted
        return _np_resample(pcm, self.src_rate, self.dst_rate)

    def reset(self) -> None:
        self._state = None


def _np_resample(pcm: bytes, src_rate: int, dst_rate: int) -> bytes:
    """Fallback numpy linear resampler (stateless, lower quality)."""
    samples = _np.frombuffer(pcm, dtype=_np.int16)
    if samples.size == 0:
        return b""
    n_out = max(1, int(round(samples.size * dst_rate / src_rate)))
    x_old = _np.linspace(0.0, 1.0, num=samples.size, endpoint=False)
    x_new = _np.linspace(0.0, 1.0, num=n_out, endpoint=False)
    out = _np.interp(x_new, x_old, samples.astype(_np.float32))
    return out.astype(_np.int16).tobytes()


def resample(pcm: bytes, src_rate: int, dst_rate: int) -> bytes:
    """One-shot resample (no carried state). Prefer Resampler for streams."""
    if not pcm or src_rate == dst_rate:
        return pcm
    if _HAVE_AUDIOOP:
        converted, _ = audioop.ratecv(
            pcm, SAMPLE_WIDTH, CHANNELS, src_rate, dst_rate, None
        )
        return converted
    return _np_resample(pcm, src_rate, dst_rate)


def slin_to_ulaw(pcm: bytes) -> bytes:
    """Convert 16-bit signed-linear PCM to 8-bit mu-law."""
    if _HAVE_AUDIOOP:
        return audioop.lin2ulaw(pcm, SAMPLE_WIDTH)
    raise RuntimeError("mu-law companding requires audioop")


def ulaw_to_slin(ulaw: bytes) -> bytes:
    """Convert 8-bit mu-law to 16-bit signed-linear PCM."""
    if _HAVE_AUDIOOP:
        return audioop.ulaw2lin(ulaw, SAMPLE_WIDTH)
    raise RuntimeError("mu-law companding requires audioop")


def rms(pcm: bytes) -> float:
    """RMS amplitude of a slin buffer (used for simple energy VAD)."""
    if not pcm:
        return 0.0
    if _HAVE_AUDIOOP:
        return float(audioop.rms(pcm, SAMPLE_WIDTH))
    samples = _np.frombuffer(pcm, dtype=_np.int16).astype(_np.float32)
    if samples.size == 0:
        return 0.0
    return float(_np.sqrt(_np.mean(samples * samples)))


def frame_duration_ms(pcm: bytes, sample_rate: int) -> float:
    """Duration in ms of a slin buffer at the given sample rate."""
    samples = len(pcm) // SAMPLE_WIDTH
    if sample_rate <= 0:
        return 0.0
    return samples * 1000.0 / sample_rate


def silence(duration_ms: int, sample_rate: int) -> bytes:
    """A buffer of slin silence."""
    samples = int(sample_rate * duration_ms / 1000)
    return b"\x00\x00" * samples


def rates() -> Tuple[bool]:  # pragma: no cover - introspection helper
    return (_HAVE_AUDIOOP,)
