"""Unit tests for LLM prompt assembly + tool building — no network required.

The Anthropic client is never constructed here (no API key), so ClaudeBrain runs
in its disabled/stub path. We test the pure assembly helpers and a stubbed
streaming turn via a fake brain.
"""
from __future__ import annotations

import pytest

from app.config import Settings
from app.db import AgentConfig
from app.llm import (
    BUILTIN_TOOLS,
    ClaudeBrain,
    assemble_tools,
    build_system_prompt,
    effort_for,
    model_for,
)


def _agent(**kw) -> AgentConfig:
    base = dict(
        id="a1",
        tenant_id="t1",
        name="Reception",
        system_prompt="You are Ada, the receptionist for Acme.",
    )
    base.update(kw)
    return AgentConfig(**base)


def test_build_system_prompt_includes_persona_and_voice_guidance():
    agent = _agent()
    prompt = build_system_prompt(agent)
    assert "Ada" in prompt
    assert "phone call" in prompt.lower()
    # No KB context provided -> no KB section.
    assert "knowledge base context" not in prompt.lower()


def test_build_system_prompt_with_kb_context():
    agent = _agent()
    prompt = build_system_prompt(agent, kb_context="Hours: 9-5 Mon-Fri.")
    assert "Hours: 9-5" in prompt
    assert "knowledge base context" in prompt.lower()


def test_build_system_prompt_non_english_language():
    agent = _agent(language="es")
    prompt = build_system_prompt(agent)
    assert "es" in prompt
    assert "language" in prompt.lower()


def test_assemble_tools_includes_builtins():
    agent = _agent()
    tools = assemble_tools(agent)
    names = {t["name"] for t in tools}
    for builtin in BUILTIN_TOOLS:
        assert builtin["name"] in names
    # Every tool has a JSON-schema input.
    for t in tools:
        assert t["input_schema"]["type"] == "object"


def test_assemble_tools_merges_tenant_tools_without_duplicates():
    agent = _agent(
        tools=[
            {
                "name": "check_order",
                "description": "Look up an order status.",
                "input_schema": {
                    "type": "object",
                    "properties": {"order_id": {"type": "string"}},
                    "required": ["order_id"],
                },
                "x_webhook": "https://example.com/hook",
            },
            # duplicate of a builtin -> ignored
            {"name": "end_call", "description": "dup"},
        ]
    )
    tools = assemble_tools(agent)
    names = [t["name"] for t in tools]
    assert "check_order" in names
    # end_call appears exactly once (builtin not overridden).
    assert names.count("end_call") == 1


def test_effort_and_model_resolution_prefer_agent_then_env():
    settings = Settings(LLM_MODEL="claude-opus-4-8", LLM_EFFORT="low")
    # agent override wins
    agent = _agent(model="claude-haiku-4-5", effort="medium")
    assert model_for(agent, settings) == "claude-haiku-4-5"
    assert effort_for(agent, settings) == "medium"
    # falls back to env when agent fields empty
    agent2 = _agent(model=None, effort=None)
    assert model_for(agent2, settings) == "claude-opus-4-8"
    assert effort_for(agent2, settings) == "low"


def test_effort_invalid_value_falls_back_to_low():
    settings = Settings()
    agent = _agent(effort="bogus")
    assert effort_for(agent, settings) == "low"


@pytest.mark.asyncio
async def test_stream_turn_disabled_brain_returns_stub():
    # No API key -> brain disabled; stream_turn should still produce a reply.
    settings = Settings(ANTHROPIC_API_KEY="")
    brain = ClaudeBrain(settings)
    assert brain.available is False

    agent = _agent()
    messages: list = [{"role": "user", "content": "hi"}]
    spoken: list[str] = []

    async def on_text(t: str) -> None:
        spoken.append(t)

    async def executor(name: str, tinput: dict) -> str:
        return "ok"

    result = await brain.stream_turn(
        agent=agent,
        messages=messages,
        system=build_system_prompt(agent),
        tools=assemble_tools(agent),
        tool_executor=executor,
        on_text=on_text,
    )
    assert result.text
    assert spoken  # the stub text was streamed out
    assert messages[-1]["role"] == "assistant"


@pytest.mark.asyncio
async def test_summarize_call_disabled_brain_returns_neutral():
    brain = ClaudeBrain(Settings(ANTHROPIC_API_KEY=""))
    out = await brain.summarize_call("Caller: hi\nAgent: hello")
    assert out["sentiment"] == "neutral"
    assert out["sentiment_score"] == 0.0
    assert out["action_items"] == []
