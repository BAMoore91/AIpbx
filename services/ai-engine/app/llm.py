"""Claude brain for the voice agent.

Wraps the official Anthropic Python SDK (``AsyncAnthropic``) per the engine's
authoritative LLM rules:

* model id from ``LLM_MODEL`` (default ``claude-opus-4-8``); exact string, no
  date suffix.
* adaptive thinking (``thinking={"type": "adaptive"}``) for non-trivial
  reasoning, with depth controlled by ``output_config={"effort": ...}``.
* NEVER passes temperature / top_p / top_k (they 400 on these models), and
  never uses ``budget_tokens``.
* streaming via ``client.messages.stream(...)`` consuming ``text_stream`` so TTS
  can start as text arrives.
* a manual tool loop: when ``stop_reason == "tool_use"`` we execute tools and
  feed ``tool_result`` blocks back, keeping per-call conversation history.

Conversation memory is the per-call ``messages`` list owned by the CallSession;
this module assembles the system prompt (persona + optional KB context) and the
tool definitions, and exposes streaming + non-streaming entry points.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Awaitable, Callable, Optional

from anthropic import AsyncAnthropic

from .config import Settings, get_settings
from .db import AgentConfig, Database

logger = logging.getLogger("aipbx.llm")

# A tool executor takes (tool_name, tool_input) and returns a string result.
ToolExecutor = Callable[[str, dict[str, Any]], Awaitable[str]]

# Built-in tools always available to a voice agent. Tenant-defined webhook tools
# from ai_agents.tools are merged on top of these.
BUILTIN_TOOLS: list[dict[str, Any]] = [
    {
        "name": "transfer_to_human",
        "description": (
            "Transfer the caller to a human agent or department. Use when the "
            "caller explicitly asks for a person, is frustrated, or the request "
            "is beyond your ability."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "reason": {
                    "type": "string",
                    "description": "Short reason for the transfer.",
                },
                "department": {
                    "type": "string",
                    "description": "Optional target department or extension.",
                },
            },
            "required": ["reason"],
        },
    },
    {
        "name": "lookup_knowledge",
        "description": (
            "Search the agent's knowledge base for facts needed to answer the "
            "caller. Call this before answering questions about products, "
            "policies, hours, or pricing."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The search query, phrased as the caller's need.",
                }
            },
            "required": ["query"],
        },
    },
    {
        "name": "end_call",
        "description": (
            "Politely end the call. Use when the caller says goodbye or the "
            "conversation is clearly complete."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "farewell": {
                    "type": "string",
                    "description": "Optional final spoken line before hangup.",
                }
            },
            "required": [],
        },
    },
    {
        "name": "schedule_callback",
        "description": (
            "Schedule a callback for the caller at a requested time. Collect a "
            "phone number and a time window."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "phone": {"type": "string", "description": "Callback number."},
                "when": {
                    "type": "string",
                    "description": "Requested date/time window, natural language.",
                },
                "note": {"type": "string", "description": "Reason / context."},
            },
            "required": ["phone", "when"],
        },
    },
]


@dataclass
class LLMResult:
    """Outcome of one assistant turn."""

    text: str
    stop_reason: Optional[str] = None
    tool_calls: list[dict[str, Any]] = field(default_factory=list)


def effort_for(agent: AgentConfig, settings: Settings) -> str:
    """Resolve the effort level: agent override (temperature_effort) else env."""
    raw = (agent.effort or settings.llm_effort or "low").lower()
    return raw if raw in {"low", "medium", "high", "max"} else "low"


def model_for(agent: AgentConfig, settings: Settings) -> str:
    """Resolve the model id: agent.model else env default. Exact string, no suffix."""
    return agent.model or settings.llm_model


def build_system_prompt(
    agent: AgentConfig, kb_context: Optional[str] = None
) -> str:
    """Assemble the system prompt: persona + voice guidance + optional KB grounding."""
    parts: list[str] = [agent.system_prompt.strip()]

    parts.append(
        "\n\nYou are speaking with the caller over a live phone call. Keep "
        "replies short, natural, and conversational — one or two sentences is "
        "usually right. Spell out numbers and avoid markdown, lists, or emoji, "
        "since your words are read aloud by a text-to-speech voice. If you need "
        "facts you don't have, use the lookup_knowledge tool before answering."
    )

    if agent.language and agent.language.lower() not in {"en", "en-us", "english"}:
        parts.append(f"\n\nRespond in the caller's language: {agent.language}.")

    if kb_context:
        parts.append(
            "\n\nRelevant knowledge base context (use it to ground your "
            f"answers; do not read it verbatim):\n{kb_context}"
        )

    return "".join(parts)


def assemble_tools(agent: AgentConfig) -> list[dict[str, Any]]:
    """Built-in tools plus tenant-defined webhook tools from ai_agents.tools.

    Tenant tool entries are expected to look like Claude tool definitions
    (``name``, ``description``, ``input_schema``) — optionally carrying an
    ``x_webhook`` URL the executor uses to dispatch the call. We pass through the
    Claude-relevant fields and tolerate partial definitions.
    """
    tools = [dict(t) for t in BUILTIN_TOOLS]
    seen = {t["name"] for t in tools}
    for raw in agent.tools or []:
        if not isinstance(raw, dict):
            continue
        name = raw.get("name")
        if not name or name in seen:
            continue
        schema = raw.get("input_schema") or {
            "type": "object",
            "properties": {},
        }
        tools.append(
            {
                "name": name,
                "description": raw.get("description", f"Tenant tool {name}."),
                "input_schema": schema,
            }
        )
        seen.add(name)
    return tools


class ClaudeBrain:
    """Per-engine Claude wrapper. One instance is shared across calls."""

    def __init__(self, settings: Optional[Settings] = None) -> None:
        self.settings = settings or get_settings()
        self._client: Optional[AsyncAnthropic] = None
        if self.settings.anthropic_api_key:
            self._client = AsyncAnthropic(api_key=self.settings.anthropic_api_key)
        else:
            logger.warning("ANTHROPIC_API_KEY not set — LLM disabled (stub replies)")

    @property
    def available(self) -> bool:
        return self._client is not None

    # ------------------------------------------------------------------
    # Streaming turn with manual tool loop
    # ------------------------------------------------------------------
    async def stream_turn(
        self,
        *,
        agent: AgentConfig,
        messages: list[dict[str, Any]],
        system: str,
        tools: list[dict[str, Any]],
        tool_executor: ToolExecutor,
        on_text: Callable[[str], Awaitable[None]],
        max_tool_iterations: int = 6,
    ) -> LLMResult:
        """Run one user→assistant turn, streaming text to ``on_text`` as it arrives.

        Mutates ``messages`` in place with the assistant turn(s) and any
        tool_result turns so the caller keeps full conversation memory. Handles a
        manual tool loop: while ``stop_reason == "tool_use"`` we execute the
        requested tools, append a tool_result user turn, and continue.

        Returns the final assistant text plus the list of tool calls made (so the
        session can act on end_call / transfer_to_human side effects).
        """
        if self._client is None:
            text = "I'm sorry, the assistant is not available right now."
            await on_text(text)
            messages.append({"role": "assistant", "content": text})
            return LLMResult(text=text, stop_reason="end_turn")

        model = model_for(agent, self.settings)
        effort = effort_for(agent, self.settings)
        collected_text: list[str] = []
        all_tool_calls: list[dict[str, Any]] = []
        final_stop: Optional[str] = None

        for _ in range(max_tool_iterations):
            assistant_blocks: list[dict[str, Any]] = []
            turn_text: list[str] = []

            # Stream so TTS can start speaking as soon as text arrives.
            async with self._client.messages.stream(
                model=model,
                max_tokens=self.settings.llm_max_tokens,
                system=system,
                tools=tools,
                thinking={"type": "adaptive"},
                output_config={"effort": effort},
                messages=messages,
            ) as stream:
                async for text in stream.text_stream:
                    if text:
                        turn_text.append(text)
                        collected_text.append(text)
                        await on_text(text)
                final = await stream.get_final_message()

            final_stop = final.stop_reason

            # Rebuild the assistant content blocks for history (text + tool_use +
            # thinking blocks must be echoed back verbatim on the same model).
            tool_use_blocks: list[Any] = []
            for block in final.content:
                if block.type == "text":
                    assistant_blocks.append({"type": "text", "text": block.text})
                elif block.type == "thinking":
                    assistant_blocks.append(
                        {
                            "type": "thinking",
                            "thinking": block.thinking,
                            "signature": getattr(block, "signature", None),
                        }
                    )
                elif block.type == "redacted_thinking":
                    assistant_blocks.append(
                        {"type": "redacted_thinking", "data": block.data}
                    )
                elif block.type == "tool_use":
                    assistant_blocks.append(
                        {
                            "type": "tool_use",
                            "id": block.id,
                            "name": block.name,
                            "input": block.input,
                        }
                    )
                    tool_use_blocks.append(block)

            messages.append({"role": "assistant", "content": assistant_blocks})

            if final.stop_reason != "tool_use" or not tool_use_blocks:
                break

            # Execute every requested tool, collect tool_result blocks.
            tool_results: list[dict[str, Any]] = []
            for tb in tool_use_blocks:
                tinput = tb.input if isinstance(tb.input, dict) else {}
                all_tool_calls.append({"name": tb.name, "input": tinput, "id": tb.id})
                try:
                    result = await tool_executor(tb.name, tinput)
                except Exception:  # noqa: BLE001
                    logger.exception("tool %s execution failed", tb.name)
                    result = f"Error: the {tb.name} tool failed."
                tool_results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": tb.id,
                        "content": result,
                    }
                )
            messages.append({"role": "user", "content": tool_results})
            # Loop again so Claude can respond to the tool results.

        return LLMResult(
            text="".join(collected_text).strip(),
            stop_reason=final_stop,
            tool_calls=all_tool_calls,
        )

    # ------------------------------------------------------------------
    # Post-call summary + sentiment (non-streaming, structured output)
    # ------------------------------------------------------------------
    async def summarize_call(
        self, transcript: str, *, language: str = "en"
    ) -> dict[str, Any]:
        """Summarize a finished call. Returns
        {summary, sentiment, sentiment_score, action_items, tags}.

        Uses structured outputs (output_config.format) so the result parses
        cleanly. Falls back to a neutral stub if the LLM is unavailable.
        """
        fallback = {
            "summary": "",
            "sentiment": "neutral",
            "sentiment_score": 0.0,
            "action_items": [],
            "tags": [],
        }
        if self._client is None or not transcript.strip():
            return fallback

        schema = {
            "type": "object",
            "properties": {
                "summary": {"type": "string"},
                "sentiment": {
                    "type": "string",
                    "enum": ["positive", "neutral", "negative"],
                },
                "sentiment_score": {"type": "number"},
                "action_items": {"type": "array", "items": {"type": "string"}},
                "tags": {"type": "array", "items": {"type": "string"}},
            },
            "required": [
                "summary",
                "sentiment",
                "sentiment_score",
                "action_items",
                "tags",
            ],
            "additionalProperties": False,
        }

        system = (
            "You analyze finished phone-call transcripts. Produce a concise "
            "summary (2-4 sentences), the caller's overall sentiment, a "
            "sentiment_score from -1.0 (very negative) to 1.0 (very positive), "
            "concrete action_items for follow-up, and a few short topical tags."
        )
        user = f"Transcript (language={language}):\n\n{transcript}"

        try:
            resp = await self._client.messages.create(
                model=self.settings.llm_model,
                max_tokens=1024,
                system=system,
                thinking={"type": "adaptive"},
                output_config={
                    "effort": "low",
                    "format": {"type": "json_schema", "schema": schema},
                },
                messages=[{"role": "user", "content": user}],
            )
        except Exception:  # noqa: BLE001
            logger.exception("summarize_call failed")
            return fallback

        text = next((b.text for b in resp.content if b.type == "text"), "")
        try:
            data = json.loads(text)
        except (json.JSONDecodeError, TypeError):
            logger.warning("summarize_call returned non-JSON: %r", text[:200])
            return fallback

        # Clamp the score to the documented range.
        try:
            score = float(data.get("sentiment_score", 0.0))
        except (TypeError, ValueError):
            score = 0.0
        data["sentiment_score"] = max(-1.0, min(1.0, score))
        for key, default in fallback.items():
            data.setdefault(key, default)
        return data

    # ------------------------------------------------------------------
    # Text-only test harness (console agent builder)
    # ------------------------------------------------------------------
    async def chat_once(
        self,
        *,
        agent: AgentConfig,
        history: list[dict[str, Any]],
        user_text: str,
        db: Optional[Database] = None,
    ) -> str:
        """Non-streaming single-turn chat against an agent's prompt + tools.

        Used by POST /agents/{id}/test. Mutates ``history`` with the user turn
        and assistant reply. Built-in tools resolve to simple textual stubs so
        the harness exercises the prompt without side effects.
        """
        kb_context = None
        if db and agent.knowledge_base_id:
            chunks = await db.search_kb(agent.knowledge_base_id, user_text)
            if chunks:
                kb_context = "\n\n".join(
                    f"[{c.get('title') or 'doc'}] {c['content']}" for c in chunks
                )
        system = build_system_prompt(agent, kb_context)
        tools = assemble_tools(agent)
        history.append({"role": "user", "content": user_text})

        if self._client is None:
            reply = "(LLM disabled — set ANTHROPIC_API_KEY to test this agent.)"
            history.append({"role": "assistant", "content": reply})
            return reply

        async def _stub_executor(name: str, tinput: dict[str, Any]) -> str:
            if name == "lookup_knowledge" and db and agent.knowledge_base_id:
                chunks = await db.search_kb(
                    agent.knowledge_base_id, tinput.get("query", "")
                )
                if chunks:
                    return "\n".join(c["content"] for c in chunks)[:1500]
                return "No matching knowledge found."
            return f"[test harness] {name} called with {json.dumps(tinput)}"

        collected: list[str] = []

        async def _collect(t: str) -> None:
            collected.append(t)

        result = await self.stream_turn(
            agent=agent,
            messages=history,
            system=system,
            tools=tools,
            tool_executor=_stub_executor,
            on_text=_collect,
        )
        return result.text or "".join(collected)
