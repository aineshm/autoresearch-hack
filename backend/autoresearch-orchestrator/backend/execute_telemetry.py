"""Middleware that compresses Modal execute output and logs full detail to Raindrop."""

from __future__ import annotations

import re
from typing import Any, Awaitable, Callable

from langchain.agents.middleware.types import AgentMiddleware
from langchain_core.messages import ToolMessage

from backend.modal_runtime import summarize_execute_output

_EXIT_CODE_RE = re.compile(r"exit code (\d+)", re.IGNORECASE)


class ExecuteTelemetryMiddleware(AgentMiddleware):
    """Keep execute tool results compact while shipping full output to Raindrop."""

    def __init__(self, *, run_id: str, telemetry: Any) -> None:
        self.run_id = run_id
        self.telemetry = telemetry

    async def awrap_tool_call(
        self,
        request: Any,
        handler: Callable[[Any], Awaitable[ToolMessage | Any]],
    ) -> ToolMessage | Any:
        tool_name = request.tool_call.get("name")
        if tool_name != "execute":
            return await handler(request)

        result = await handler(request)
        if not isinstance(result, ToolMessage):
            return result

        raw_output = str(result.content)
        exit_code = _parse_exit_code(raw_output)
        summary = summarize_execute_output(output=raw_output, exit_code=exit_code)
        if not summary.ok:
            await self.telemetry.log_trace(
                run_id=self.run_id,
                span="execute",
                level="error",
                detail=summary.output_tail or raw_output,
                metadata={"exit_code": summary.exit_code},
            )

        compact = summary.summary
        if summary.exit_code is not None:
            compact = f"{compact} (exit code {summary.exit_code})"
        return result.model_copy(update={"content": compact})


def _parse_exit_code(output: str) -> int | None:
    match = _EXIT_CODE_RE.search(output)
    if match:
        return int(match.group(1))
    return None
