"""Parse training run logs into a metric reading and compare improvements."""

from __future__ import annotations

from dataclasses import dataclass
import re
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from backend.experiment.spec import ExperimentSpec


@dataclass(slots=True)
class MetricReading:
    """Compact result of one training run, surfaced to agents and the ledger."""

    value: float | None
    memory_gb: float | None = None
    crashed: bool = False
    tail: str = ""

    @property
    def ok(self) -> bool:
        return not self.crashed and self.value is not None

    def summary(self, metric_name: str) -> str:
        if self.crashed or self.value is None:
            return "run crashed (no metric produced)"
        mem = f", peak {self.memory_gb:.1f} GB" if self.memory_gb is not None else ""
        return f"{metric_name}={self.value:.6f}{mem}"


def parse_log(text: str, spec: "ExperimentSpec") -> MetricReading:
    """Extract the metric and peak memory from a run log; crash if metric absent."""
    value = _search_float(spec.metric_pattern, text)
    memory_mb = _search_float(spec.memory_pattern, text)
    memory_gb = round(memory_mb / 1024, 1) if memory_mb is not None else None
    if value is None:
        return MetricReading(value=None, memory_gb=memory_gb, crashed=True, tail=_tail(text))
    return MetricReading(value=value, memory_gb=memory_gb, crashed=False, tail=_tail(text))


def is_improvement(new: float, best: float | None, *, lower_is_better: bool) -> bool:
    """True if `new` strictly beats the current best (ties do not improve)."""
    if best is None:
        return True
    return new < best if lower_is_better else new > best


def _search_float(pattern: str, text: str) -> float | None:
    match = re.search(pattern, text, re.MULTILINE)
    if not match:
        return None
    try:
        return float(match.group(1))
    except (TypeError, ValueError):
        return None


def _tail(text: str, lines: int = 50) -> str:
    return "\n".join(text.splitlines()[-lines:])
