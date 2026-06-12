"""FastAPI control API for the AI engine.

Routes:
  POST /calls                  — register an agent for an upcoming AudioSocket
  GET  /healthz                — liveness/readiness
  GET  /calls/{uuid}           — live status of an active call
  POST /calls/{uuid}/summary   — force a summary for an active call
  POST /agents/{id}/test       — text-only chat test harness against an agent

The engine singleton is attached to ``app.state.engine`` in main.py.
"""
from __future__ import annotations

import logging
from typing import Any, Optional

from fastapi import APIRouter, FastAPI, HTTPException, Request
from pydantic import BaseModel, Field

from .engine import Engine
from .registry import CallRegistration

logger = logging.getLogger("aipbx.api")

router = APIRouter()


# ---- request/response models ----
class RegisterCall(BaseModel):
    call_uuid: str = Field(..., description="UUID Asterisk will send as frame 0x01")
    channel_id: Optional[str] = Field(None, description="Asterisk channel uniqueid")
    tenant_id: str
    agent_id: str


class TestChat(BaseModel):
    message: str
    history: list[dict[str, Any]] = Field(default_factory=list)


def _engine(request: Request) -> Engine:
    engine = getattr(request.app.state, "engine", None)
    if engine is None:  # pragma: no cover - defensive
        raise HTTPException(status_code=503, detail="engine not ready")
    return engine


@router.get("/healthz")
async def healthz(request: Request) -> dict[str, Any]:
    engine = _engine(request)
    return {
        "status": "ok",
        "llm": engine.brain.available,
        "db": engine.db.available,
        "active_calls": engine.registry.active_count,
    }


@router.post("/calls", status_code=202)
async def register_call(body: RegisterCall, request: Request) -> dict[str, Any]:
    """Register which agent handles the AudioSocket connection for a call_uuid."""
    engine = _engine(request)
    reg = CallRegistration(
        call_uuid=body.call_uuid,
        tenant_id=body.tenant_id,
        agent_id=body.agent_id,
        channel_id=body.channel_id,
    )
    await engine.registry.register(reg)
    logger.info(
        "registered call_uuid=%s agent=%s tenant=%s",
        body.call_uuid,
        body.agent_id,
        body.tenant_id,
    )
    return {"registered": True, "call_uuid": body.call_uuid}


@router.get("/calls/{call_uuid}")
async def call_status(call_uuid: str, request: Request) -> dict[str, Any]:
    engine = _engine(request)
    session = engine.registry.get_session(call_uuid)
    if session is not None:
        return session.status()  # type: ignore[attr-defined]
    reg = await engine.registry.get(call_uuid)
    if reg is None:
        raise HTTPException(status_code=404, detail="call not found")
    return {
        "call_uuid": reg.call_uuid,
        "agent_id": reg.agent_id,
        "tenant_id": reg.tenant_id,
        "status": reg.status,
        "active": False,
    }


@router.post("/calls/{call_uuid}/summary")
async def force_summary(call_uuid: str, request: Request) -> dict[str, Any]:
    engine = _engine(request)
    session = engine.registry.get_session(call_uuid)
    if session is None:
        raise HTTPException(status_code=404, detail="no active session for call")
    return await session.force_summary()  # type: ignore[attr-defined]


@router.post("/agents/{agent_id}/test")
async def test_agent(agent_id: str, body: TestChat, request: Request) -> dict[str, Any]:
    """Text-only chat test harness for the console agent builder.

    Loads the agent's prompt/tools and runs one turn via the same llm.py path
    used in calls (built-in tools resolve to stubs; no audio).
    """
    engine = _engine(request)
    agent = await engine.db.get_agent(agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="agent not found")
    history = list(body.history)
    reply = await engine.brain.chat_once(
        agent=agent,
        history=history,
        user_text=body.message,
        db=engine.db,
    )
    return {"reply": reply, "history": history}


def create_app(engine: Engine) -> FastAPI:
    """Build the FastAPI app bound to an Engine (lifespan owned by main.py)."""
    app = FastAPI(title="AIpbx AI Engine", version="0.1.0")
    app.state.engine = engine
    app.include_router(router)
    return app
