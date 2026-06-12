"""Object storage for call recordings (DO Spaces / S3-compatible).

Records both legs of a call as slin (8kHz mono 16-bit) and uploads a WAV to the
configured S3 bucket. Uploads are best-effort: if storage is not configured or
fails, the call still completes — recording is a side artifact.
"""
from __future__ import annotations

import io
import logging
import wave
from typing import Optional

from .config import Settings, get_settings

logger = logging.getLogger("aipbx.store")

try:
    import aioboto3
except Exception:  # noqa: BLE001
    aioboto3 = None  # type: ignore


def pcm_to_wav(pcm_slin8k: bytes, sample_rate: int = 8000) -> bytes:
    """Wrap raw slin PCM in a WAV container for storage/playback."""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm_slin8k)
    return buf.getvalue()


class RecordingStore:
    """Uploads recordings to S3-compatible storage."""

    def __init__(self, settings: Optional[Settings] = None) -> None:
        self.settings = settings or get_settings()
        self._session = None
        if aioboto3 is not None and self._configured:
            self._session = aioboto3.Session()

    @property
    def _configured(self) -> bool:
        s = self.settings
        return bool(s.s3_bucket and s.s3_access_key and s.s3_secret_key)

    @property
    def available(self) -> bool:
        return self._session is not None

    async def upload_recording(
        self, key: str, pcm_slin8k: bytes, sample_rate: int = 8000
    ) -> Optional[dict]:
        """Upload a slin recording as WAV. Returns {s3_key, size_bytes, duration}.

        Returns None if storage is unavailable or the upload fails.
        """
        if self._session is None or not pcm_slin8k:
            return None
        wav = pcm_to_wav(pcm_slin8k, sample_rate)
        duration = len(pcm_slin8k) // (sample_rate * 2)
        try:
            async with self._session.client(
                "s3",
                endpoint_url=self.settings.s3_endpoint or None,
                region_name=self.settings.s3_region or None,
                aws_access_key_id=self.settings.s3_access_key,
                aws_secret_access_key=self.settings.s3_secret_key,
            ) as client:
                await client.put_object(
                    Bucket=self.settings.s3_bucket,
                    Key=key,
                    Body=wav,
                    ContentType="audio/wav",
                )
        except Exception:  # noqa: BLE001
            logger.exception("recording upload failed for key=%s", key)
            return None
        logger.info("uploaded recording %s (%d bytes)", key, len(wav))
        return {"s3_key": key, "size_bytes": len(wav), "duration": duration}
