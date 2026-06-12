"""Postgres access layer (asyncpg pool) for the AI voice engine.

Loads agent configuration from ``ai_agents`` and persists call results to
``calls`` / ``transcripts``. The pool is created lazily at startup and tolerates
a missing/empty DATABASE_URL (the engine then runs in a degraded "no-DB" mode,
useful for the text test harness and local development).
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional

import asyncpg

from .config import Settings, get_settings

logger = logging.getLogger("aipbx.db")


@dataclass
class AgentConfig:
    """Resolved configuration for one AI agent (from ``ai_agents``)."""

    id: str
    tenant_id: str
    name: str
    role: str = "receptionist"
    model: Optional[str] = None
    system_prompt: str = "You are a helpful voice assistant."
    greeting: Optional[str] = None
    voice_id: Optional[str] = None
    stt_provider: Optional[str] = None
    tts_provider: Optional[str] = None
    language: str = "en"
    effort: Optional[str] = None  # maps from ai_agents.temperature_effort
    interruptible: bool = True
    max_turns: int = 40
    end_keywords: list[str] = field(default_factory=lambda: ["goodbye", "bye"])
    tools: list[dict[str, Any]] = field(default_factory=list)
    knowledge_base_id: Optional[str] = None
    fallback_dest_type: Optional[str] = None
    fallback_dest_id: Optional[str] = None
    settings: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_row(cls, row: "asyncpg.Record") -> "AgentConfig":
        tools = row["tools"]
        if isinstance(tools, str):
            tools = json.loads(tools or "[]")
        settings = row["settings"]
        if isinstance(settings, str):
            settings = json.loads(settings or "{}")
        return cls(
            id=str(row["id"]),
            tenant_id=str(row["tenant_id"]),
            name=row["name"],
            role=row["role"],
            model=row["model"],
            system_prompt=row["system_prompt"],
            greeting=row["greeting"],
            voice_id=row["voice_id"],
            stt_provider=row["stt_provider"],
            tts_provider=row["tts_provider"],
            language=row["language"],
            effort=row["temperature_effort"],
            interruptible=row["interruptible"],
            max_turns=row["max_turns"],
            end_keywords=list(row["end_keywords"] or []),
            tools=list(tools or []),
            knowledge_base_id=(
                str(row["knowledge_base_id"]) if row["knowledge_base_id"] else None
            ),
            fallback_dest_type=row["fallback_dest_type"],
            fallback_dest_id=row["fallback_dest_id"],
            settings=dict(settings or {}),
        )

    @classmethod
    def fallback(cls, agent_id: str, tenant_id: str) -> "AgentConfig":
        """A safe default config used when the DB is unavailable."""
        return cls(
            id=agent_id,
            tenant_id=tenant_id,
            name="AI Agent",
            system_prompt=(
                "You are a friendly, concise telephone receptionist. Keep replies "
                "short and natural for spoken conversation."
            ),
            greeting="Hi, thanks for calling. How can I help you today?",
        )


class Database:
    """Thin asyncpg wrapper holding a shared connection pool."""

    def __init__(self, settings: Optional[Settings] = None) -> None:
        self.settings = settings or get_settings()
        self._pool: Optional[asyncpg.Pool] = None

    @property
    def available(self) -> bool:
        return self._pool is not None

    async def connect(self) -> None:
        if not self.settings.database_url:
            logger.warning("DATABASE_URL not set — running without Postgres")
            return
        try:
            self._pool = await asyncpg.create_pool(
                dsn=self.settings.database_url,
                min_size=1,
                max_size=10,
                command_timeout=30,
            )
            logger.info("Postgres pool ready")
        except Exception:  # noqa: BLE001
            logger.exception("could not connect to Postgres — continuing without DB")
            self._pool = None

    async def close(self) -> None:
        if self._pool is not None:
            await self._pool.close()
            self._pool = None

    # ---- agent config ----
    async def get_agent(self, agent_id: str) -> Optional[AgentConfig]:
        if not self._pool:
            return None
        row = await self._pool.fetchrow(
            "SELECT * FROM ai_agents WHERE id = $1 AND is_active = TRUE",
            agent_id,
        )
        return AgentConfig.from_row(row) if row else None

    # ---- simple KB retrieval (keyword / trigram) ----
    async def search_kb(
        self, kb_id: str, query: str, limit: int = 4
    ) -> list[dict[str, Any]]:
        """Naive lexical retrieval over kb_documents.

        Uses pg_trgm similarity on the content (an embedding/pgvector path can be
        swapped in later). Returns the most relevant chunks for grounding.
        """
        if not self._pool or not kb_id:
            return []
        rows = await self._pool.fetch(
            """
            SELECT title, source, content,
                   similarity(content, $2) AS score
            FROM kb_documents
            WHERE kb_id = $1
            ORDER BY content <-> $2
            LIMIT $3
            """,
            kb_id,
            query,
            limit,
        )
        return [
            {
                "title": r["title"],
                "source": r["source"],
                "content": r["content"],
                "score": float(r["score"]) if r["score"] is not None else 0.0,
            }
            for r in rows
        ]

    # ---- call persistence ----
    async def upsert_call_started(
        self,
        call_uuid: str,
        tenant_id: str,
        agent_id: str,
        channel_id: Optional[str],
    ) -> Optional[str]:
        """Mark a call as in-progress, return the calls.id (db uuid).

        We key on the Asterisk channel_id when present; otherwise we let the call
        row's own id be the call_uuid so the engine can correlate later.
        """
        if not self._pool:
            return None
        try:
            row = await self._pool.fetchrow(
                """
                INSERT INTO calls (id, tenant_id, channel_id, direction, status,
                                   handled_by, ai_agent_id, answered_at)
                VALUES ($1, $2, $3, 'inbound', 'in-progress', 'ai_agent', $4, now())
                ON CONFLICT (id) DO UPDATE
                    SET status = 'in-progress',
                        ai_agent_id = EXCLUDED.ai_agent_id,
                        handled_by = 'ai_agent',
                        answered_at = COALESCE(calls.answered_at, now())
                RETURNING id
                """,
                call_uuid,
                tenant_id,
                channel_id,
                agent_id,
            )
            return str(row["id"]) if row else None
        except Exception:  # noqa: BLE001
            logger.exception("upsert_call_started failed for %s", call_uuid)
            return None

    async def save_transcript(
        self,
        call_id: str,
        turns: list[dict[str, Any]],
        full_text: str,
        language: str = "en",
    ) -> None:
        if not self._pool:
            return
        try:
            await self._pool.execute(
                """
                INSERT INTO transcripts (call_id, turns, full_text, language)
                VALUES ($1, $2::jsonb, $3, $4)
                """,
                call_id,
                json.dumps(turns),
                full_text,
                language,
            )
        except Exception:  # noqa: BLE001
            logger.exception("save_transcript failed for call %s", call_id)

    async def finalize_call(
        self,
        call_id: str,
        *,
        summary: Optional[str],
        sentiment: Optional[str],
        sentiment_score: Optional[float],
        tags: Optional[list[str]],
        talk_seconds: Optional[int],
        disposition: str = "answered",
        hangup_cause: Optional[str] = None,
        metadata: Optional[dict[str, Any]] = None,
    ) -> None:
        if not self._pool:
            return
        try:
            await self._pool.execute(
                """
                UPDATE calls
                SET status = 'ended',
                    disposition = $2,
                    ended_at = now(),
                    talk_seconds = $3,
                    hangup_cause = $4,
                    summary = $5,
                    sentiment = $6,
                    sentiment_score = $7,
                    tags = $8,
                    metadata = calls.metadata || $9::jsonb
                WHERE id = $1
                """,
                call_id,
                disposition,
                talk_seconds,
                hangup_cause,
                summary,
                sentiment,
                sentiment_score,
                tags or [],
                json.dumps(metadata or {}),
            )
        except Exception:  # noqa: BLE001
            logger.exception("finalize_call failed for call %s", call_id)

    async def attach_recording(
        self,
        call_id: str,
        tenant_id: str,
        s3_key: str,
        duration: int,
        size_bytes: int,
        fmt: str = "wav",
    ) -> None:
        if not self._pool:
            return
        try:
            rec = await self._pool.fetchrow(
                """
                INSERT INTO recordings (tenant_id, call_id, s3_key, format,
                                        duration, size_bytes)
                VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING id
                """,
                tenant_id,
                call_id,
                s3_key,
                fmt,
                duration,
                size_bytes,
            )
            await self._pool.execute(
                "UPDATE calls SET recording_id = $2 WHERE id = $1",
                call_id,
                rec["id"],
            )
        except Exception:  # noqa: BLE001
            logger.exception("attach_recording failed for call %s", call_id)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)
