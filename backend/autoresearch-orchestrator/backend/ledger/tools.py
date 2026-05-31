"""Deep Agents tool factory exposing the research ledger to the Scientist."""

from __future__ import annotations

from typing import Any, Callable

from backend.ledger.models import ResearchLedger


def create_ledger_tools(*, ledger: ResearchLedger) -> list[Callable[..., Any]]:
    """Build read-only ledger tools so a Scientist can avoid known dead ends.

    The swarm records outcomes automatically after each worker, so these tools
    are intentionally query-only: agents consult memory, they do not mutate it.
    """

    async def check_prior_attempts(approach: str) -> str:
        """Check whether a proposed approach (or a close variant) already failed.

        Call this BEFORE committing to an implementation approach. Pass a 1–2
        sentence description of the approach you intend to take.
        """
        if not approach.strip():
            return "Provide a short description of the approach you want to check."
        match = ledger.find_blocking_failure(approach)
        if match is None:
            return "No prior failure matches this approach. Safe to proceed."
        reason = match.attempt.error_class or "failure"
        return (
            f"BLOCKED — a {match.similarity:.0%}-similar approach already failed "
            f"(generation {match.attempt.generation}, {reason}): "
            f"{match.attempt.approach}\nChoose a materially different approach."
        )

    async def list_failed_approaches() -> str:
        """List recent failed approaches recorded in the research ledger."""
        avoid = ledger.avoid_list()
        if not avoid:
            return "No failed approaches recorded yet."
        lines = ["Failed approaches to avoid:"]
        for index, attempt in enumerate(avoid, start=1):
            reason = attempt.error_class or "failed"
            lines.append(f"{index}. [{reason}] {attempt.approach}")
        return "\n".join(lines)

    return [check_prior_attempts, list_failed_approaches]
