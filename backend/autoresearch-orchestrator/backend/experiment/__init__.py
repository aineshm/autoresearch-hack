"""Experiment mode: run a karpathy-style `program.md` training-research loop."""

from backend.experiment.metrics import MetricReading, is_improvement, parse_log
from backend.experiment.results import ResultRow, ResultsTsv
from backend.experiment.runner import (
    ExperimentRunner,
    FakeRunner,
    LocalSubprocessRunner,
    RunResult,
)
from backend.experiment.spec import ExperimentSpec
from backend.experiment.workspace import CommitInfo, ExperimentWorkspace, GitError

__all__ = [
    "ExperimentSpec",
    "ExperimentWorkspace",
    "CommitInfo",
    "GitError",
    "MetricReading",
    "parse_log",
    "is_improvement",
    "ResultRow",
    "ResultsTsv",
    "ExperimentRunner",
    "LocalSubprocessRunner",
    "FakeRunner",
    "RunResult",
]
