"""Call registry: maps call_uuid → pending agent registration + active sessions.

The API service POSTs ``/calls`` to register which agent should handle an
upcoming AudioSocket connection (keyed by call_uuid). Asterisk then opens the
AudioSocket and sends that UUID as its first frame; the engine looks it up here.

State is held in process for the active connection, and mirrored into Redis so
multiple engine workers can share registrations (the API may hit worker A while
the AudioSocket lands on worker B). Redis is optional — without it the engine
works single-process.
"""
from __future__ import annotations

import json
import logging
from dataclasses import asdict, dataclass
from typing import Optional

from .config import Settings, get_settings

logger = logging.getLogger("aipbx.registry")

try:
    import redis.asyncio as aioredis
except Exception:  # noqa: BLE001
    aioredis = None  # type: ignore

_REDIS_PREFIX = "aipbx:aiengine:call:"
_REGISTRATION_TTL = 3600  # seconds a pending registration is valid


@dataclass
class CallRegistration:
    """A pending or active agent assignment for a call."""

    call_uuid: str
    tenant_id: str
    agent_id: str
    channel_id: Optional[str] = None
    status: str = "registered"  # registered | active | ended

    def to_json(self) -> str:
        return json.dumps(asdict(self))

    @classmethod
    def from_json(cls, raw: str) -> "CallRegistration":
        return cls(**json.loads(raw))


class CallRegistry:
    """In-memory map of registrations + active sessions, backed by Redis."""

    def __init__(self, settings: Optional[Settings] = None) -> None:
        self.settings = settings or get_settings()
        self._pending: dict[str, CallRegistration] = {}
        # call_uuid -> CallSession (typed loosely to avoid an import cycle).
        self._sessions: dict[str, object] = {}
        self._redis = None

    async def connect(self) -> None:
        if not self.settings.redis_url or aioredis is None:
            if aioredis is None:
                logger.warning("redis.asyncio unavailable — registry is local-only")
            return
        try:
            self._redis = aioredis.from_url(
                self.settings.redis_url, decode_responses=True
            )
            await self._redis.ping()
            logger.info("Registry Redis ready")
        except Exception:  # noqa: BLE001
            logger.exception("Redis connect failed — registry is local-only")
            self._redis = None

    async def close(self) -> None:
        if self._redis is not None:
            try:
                await self._redis.aclose()
            except Exception:  # noqa: BLE001
                pass
            self._redis = None

    def _key(self, call_uuid: str) -> str:
        return f"{_REDIS_PREFIX}{call_uuid}"

    async def register(self, reg: CallRegistration) -> None:
        self._pending[reg.call_uuid] = reg
        if self._redis is not None:
            try:
                await self._redis.set(
                    self._key(reg.call_uuid), reg.to_json(), ex=_REGISTRATION_TTL
                )
            except Exception:  # noqa: BLE001
                logger.exception("registry register redis write failed")

    async def get(self, call_uuid: str) -> Optional[CallRegistration]:
        reg = self._pending.get(call_uuid)
        if reg is not None:
            return reg
        if self._redis is not None:
            try:
                raw = await self._redis.get(self._key(call_uuid))
                if raw:
                    reg = CallRegistration.from_json(raw)
                    self._pending[call_uuid] = reg
                    return reg
            except Exception:  # noqa: BLE001
                logger.exception("registry get redis read failed")
        return None

    async def mark_active(self, call_uuid: str) -> None:
        reg = await self.get(call_uuid)
        if reg:
            reg.status = "active"
            await self.register(reg)

    async def remove(self, call_uuid: str) -> None:
        self._pending.pop(call_uuid, None)
        self._sessions.pop(call_uuid, None)
        if self._redis is not None:
            try:
                await self._redis.delete(self._key(call_uuid))
            except Exception:  # noqa: BLE001
                pass

    # ---- active session tracking (in-process only) ----
    def attach_session(self, call_uuid: str, session: object) -> None:
        self._sessions[call_uuid] = session

    def get_session(self, call_uuid: str) -> Optional[object]:
        return self._sessions.get(call_uuid)

    def detach_session(self, call_uuid: str) -> None:
        self._sessions.pop(call_uuid, None)

    @property
    def active_count(self) -> int:
        return len(self._sessions)
