"""Append-only research ledger: long-term memory of attempted approaches.

The ledger is the swarm's durable memory. Unlike the ephemeral agent context
(which is flushed every generation) the ledger persists every approach the
swarm has tried, so a Scientist never re-proposes a slight variation of an
approach that already failed hours (or generations) ago.

Raw detail stays in JSON on disk; only a compact markdown "avoid list" is
published to the blackboard for agents to read.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
import hashlib
import json
from pathlib import Path
import re
from typing import Any, Iterable


_TOKEN_RE = re.compile(r"[a-z0-9]+")

# Strip low-signal words so similarity reflects the *content* of an approach,
# not shared boilerplate phrasing ("use a ... with ...").
_STOPWORDS = frozenset(
    {
        "a", "an", "and", "the", "to", "of", "for", "with", "use", "using", "via",
        "on", "in", "by", "as", "at", "it", "is", "be", "we", "i", "then", "that",
        "this", "or", "from", "into", "approach", "implement", "implementation",
        "try", "trying", "apply", "make", "build", "create", "small", "simple",
    }
)


def _utcstamp() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _normalize_tokens(text: str) -> set[str]:
    return {token for token in _TOKEN_RE.findall(text.lower()) if token not in _STOPWORDS}


def _signature(text: str) -> str:
    tokens = sorted(_normalize_tokens(text))
    digest = hashlib.sha1(" ".join(tokens).encode("utf-8")).hexdigest()
    return digest[:16]


def _jaccard(left: set[str], right: set[str]) -> float:
    if not left or not right:
        return 0.0
    intersection = len(left & right)
    union = len(left | right)
    return intersection / union if union else 0.0


@dataclass(slots=True)
class Attempt:
    """One recorded attempt at a work packet."""

    attempt_id: str
    packet_id: str
    generation: int
    approach: str
    outcome: str  # "success" | "failure"
    error_class: str = ""
    detail: str = ""
    signature: str = ""
    tokens: list[str] = field(default_factory=list)
    timestamp: str = field(default_factory=_utcstamp)

    @classmethod
    def create(
        cls,
        *,
        attempt_id: str,
        packet_id: str,
        generation: int,
        approach: str,
        outcome: str,
        error_class: str = "",
        detail: str = "",
    ) -> "Attempt":
        return cls(
            attempt_id=attempt_id,
            packet_id=packet_id,
            generation=generation,
            approach=approach.strip(),
            outcome=outcome,
            error_class=error_class,
            detail=detail.strip(),
            signature=_signature(approach),
            tokens=sorted(_normalize_tokens(approach)),
        )

    @property
    def failed(self) -> bool:
        return self.outcome == "failure"


@dataclass(slots=True)
class BlockedMatch:
    """A prior failed attempt that closely matches a proposed approach."""

    attempt: Attempt
    similarity: float


class ResearchLedger:
    """Append-only store of attempts with near-duplicate failure detection."""

    def __init__(self, similarity_threshold: float = 0.8) -> None:
        self.attempts: list[Attempt] = []
        self.similarity_threshold = similarity_threshold

    # ----- persistence ------------------------------------------------------
    @classmethod
    def load_json(cls, path: Path, *, similarity_threshold: float = 0.8) -> "ResearchLedger":
        ledger = cls(similarity_threshold=similarity_threshold)
        if path.exists():
            data = json.loads(path.read_text(encoding="utf-8"))
            ledger.similarity_threshold = data.get("similarity_threshold", similarity_threshold)
            for raw in data.get("attempts", []):
                ledger.attempts.append(Attempt(**raw))
        return ledger

    def save_json(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "similarity_threshold": self.similarity_threshold,
            "attempts": [asdict(attempt) for attempt in self.attempts],
        }
        path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")

    # ----- recording --------------------------------------------------------
    def record(self, attempt: Attempt) -> None:
        self.attempts.append(attempt)

    # ----- querying ---------------------------------------------------------
    def failures(self) -> list[Attempt]:
        return [attempt for attempt in self.attempts if attempt.failed]

    def find_blocking_failure(self, approach: str) -> BlockedMatch | None:
        """Return the closest prior *failed* approach if it is a near-duplicate."""
        proposed = _normalize_tokens(approach)
        proposed_sig = _signature(approach)
        best: BlockedMatch | None = None
        for attempt in self.failures():
            if attempt.signature and attempt.signature == proposed_sig:
                return BlockedMatch(attempt=attempt, similarity=1.0)
            similarity = _jaccard(proposed, set(attempt.tokens))
            if similarity >= self.similarity_threshold and (best is None or similarity > best.similarity):
                best = BlockedMatch(attempt=attempt, similarity=similarity)
        return best

    def is_blocked(self, approach: str) -> bool:
        return self.find_blocking_failure(approach) is not None

    def avoid_list(self, limit: int = 12) -> list[Attempt]:
        """Most recent failed attempts, newest first."""
        return list(reversed(self.failures()))[:limit]

    def stats(self) -> dict[str, int]:
        successes = sum(1 for attempt in self.attempts if attempt.outcome == "success")
        failures = len(self.failures())
        return {
            "attempts": len(self.attempts),
            "successes": successes,
            "failures": failures,
        }

    # ----- rendering --------------------------------------------------------
    def to_markdown(self) -> str:
        stats = self.stats()
        lines = [
            "# Research Ledger",
            "",
            f"_{stats['attempts']} attempts — {stats['successes']} succeeded, {stats['failures']} failed._",
            "",
            "## Avoid these failed approaches",
        ]
        avoid = self.avoid_list()
        if not avoid:
            lines.append("- (none yet)")
        else:
            for attempt in avoid:
                reason = attempt.error_class or "failed"
                lines.append(
                    f"- gen {attempt.generation} · packet `{attempt.packet_id}` · "
                    f"**{reason}**: {attempt.approach}"
                )
        successes = [a for a in self.attempts if a.outcome == "success"]
        if successes:
            lines.append("")
            lines.append("## Approaches that worked")
            for attempt in successes[-6:]:
                lines.append(
                    f"- gen {attempt.generation} · packet `{attempt.packet_id}`: {attempt.approach}"
                )
        return "\n".join(lines) + "\n"

    def avoid_prompt_block(self, limit: int = 8) -> str:
        """Compact text to inject into a Scientist prompt."""
        avoid = self.avoid_list(limit=limit)
        if not avoid:
            return "No prior failed approaches on record."
        lines = ["Previously failed approaches (do NOT repeat or slightly tweak these):"]
        for index, attempt in enumerate(avoid, start=1):
            reason = attempt.error_class or "failed"
            lines.append(f"{index}. [{reason}] {attempt.approach}")
        return "\n".join(lines)


def iter_signatures(approaches: Iterable[str]) -> list[str]:
    return [_signature(text) for text in approaches]
