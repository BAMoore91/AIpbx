"""Engine context: shared singletons + the AudioSocket connection handler.

Holds the Database, ClaudeBrain, CallRegistry and RecordingStore created once at
startup, and provides ``handle_connection`` — the AudioSocket handler that
resolves a registered agent for an incoming UUID and runs a CallSession.
"""
from __future__ import annotations

import logging
from typing import Optional

from .audiosocket import AudioSocketConnection
from .config import Settings, get_settings
from .db import AgentConfig, Database
from .llm import ClaudeBrain
from .registry import CallRegistry
from .session import CallSession
from .store import RecordingStore

logger = logging.getLogger("aipbx.engine")


class Engine:
    """Container for shared services and the AudioSocket session entry point."""

    def __init__(self, settings: Optional[Settings] = None) -> None:
        self.settings = settings or get_settings()
        self.db = Database(self.settings)
        self.brain = ClaudeBrain(self.settings)
        self.registry = CallRegistry(self.settings)
        self.store = RecordingStore(self.settings)

    async def startup(self) -> None:
        await self.db.connect()
        await self.registry.connect()
        logger.info(
            "Engine ready (llm=%s, db=%s, redis=%s, s3=%s)",
            self.brain.available,
            self.db.available,
            self.registry._redis is not None,
            self.store.available,
        )

    async def shutdown(self) -> None:
        await self.registry.close()
        await self.db.close()

    async def resolve_agent(self, agent_id: str, tenant_id: str) -> AgentConfig:
        """Load the agent config from DB, falling back to a safe default."""
        agent = await self.db.get_agent(agent_id)
        if agent is None:
            logger.warning(
                "agent %s not found in DB — using fallback config", agent_id
            )
            agent = AgentConfig.fallback(agent_id, tenant_id)
        return agent

    async def handle_connection(
        self, call_uuid: str, conn: AudioSocketConnection
    ) -> None:
        """AudioSocket handler: match UUID → registration → run a CallSession."""
        reg = await self.registry.get(call_uuid)
        if reg is None:
            logger.error(
                "no registration for call_uuid=%s — closing AudioSocket", call_uuid
            )
            await conn.send_terminate()
            return

        agent = await self.resolve_agent(reg.agent_id, reg.tenant_id)
        session = CallSession(
            call_uuid=call_uuid,
            agent=agent,
            conn=conn,
            brain=self.brain,
            db=self.db,
            registry=self.registry,
            store=self.store,
            channel_id=reg.channel_id,
            settings=self.settings,
        )
        try:
            await session.run()
        except Exception:  # noqa: BLE001
            logger.exception("[%s] CallSession crashed", call_uuid)
