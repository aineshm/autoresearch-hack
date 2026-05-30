"""Unit tests for ModalExperimentRunner.

The test monkeypatches `_exec_in_sandbox` so no real Modal credentials are
needed. It verifies the runner satisfies the same ExperimentRunner Protocol as
LocalSubprocessRunner and returns a RunResult with the identical fields the
swarm reads (log_text, exit_code, timed_out).
"""

from __future__ import annotations

from pathlib import Path

import pytest

from backend.experiment.runner import RunResult
from backend.experiment.modal_runner import ModalExperimentRunner
from tests.conftest import make_run_log


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_CANNED_OUTPUT = make_run_log("0.950000", peak_vram_mb=32000.0)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


async def test_modal_runner_returns_run_result(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """ModalExperimentRunner.run() returns a RunResult with correct field values."""
    runner = ModalExperimentRunner()

    # Monkeypatch the internal method that talks to Modal.
    def fake_exec_in_sandbox(command: str, cwd: Path) -> tuple[int, str]:
        return (0, _CANNED_OUTPUT)

    monkeypatch.setattr(runner, "_exec_in_sandbox", fake_exec_in_sandbox)

    log_path = tmp_path / "logs" / "run.log"
    result = await runner.run(
        command="uv run train.py",
        cwd=tmp_path,
        log_path=log_path,
        timeout=60,
    )

    # Must return RunResult (the same type LocalSubprocessRunner returns)
    assert isinstance(result, RunResult)

    # RunResult fields: log_text, exit_code, timed_out
    assert "val_bpb:" in result.log_text
    assert "0.950000" in result.log_text
    assert result.exit_code == 0
    assert result.timed_out is False


async def test_modal_runner_writes_log_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """ModalExperimentRunner.run() writes output to log_path (matching LocalSubprocessRunner behaviour)."""
    runner = ModalExperimentRunner()

    def fake_exec_in_sandbox(command: str, cwd: Path) -> tuple[int, str]:
        return (0, _CANNED_OUTPUT)

    monkeypatch.setattr(runner, "_exec_in_sandbox", fake_exec_in_sandbox)

    log_path = tmp_path / "nested" / "dir" / "training.log"
    await runner.run(
        command="uv run train.py",
        cwd=tmp_path,
        log_path=log_path,
        timeout=60,
    )

    assert log_path.exists(), "log_path must be created by the runner"
    assert "val_bpb:" in log_path.read_text(encoding="utf-8")


async def test_modal_runner_propagates_nonzero_exit(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Non-zero exit code from the sandbox is reflected in RunResult.exit_code."""
    runner = ModalExperimentRunner()

    crash_output = make_run_log(None)  # error log, no metric

    def fake_exec_in_sandbox(command: str, cwd: Path) -> tuple[int, str]:
        return (1, crash_output)

    monkeypatch.setattr(runner, "_exec_in_sandbox", fake_exec_in_sandbox)

    log_path = tmp_path / "run.log"
    result = await runner.run(
        command="uv run train.py",
        cwd=tmp_path,
        log_path=log_path,
        timeout=60,
    )

    assert isinstance(result, RunResult)
    assert result.exit_code == 1
    assert result.timed_out is False
    assert "RuntimeError" in result.log_text


async def test_modal_runner_timed_out_false_on_success(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """timed_out is False when the sandbox finishes within timeout."""
    runner = ModalExperimentRunner()

    monkeypatch.setattr(
        runner,
        "_exec_in_sandbox",
        lambda command, cwd: (0, _CANNED_OUTPUT),
    )

    result = await runner.run(
        command="uv run train.py",
        cwd=tmp_path,
        log_path=tmp_path / "run.log",
        timeout=300,
    )
    assert result.timed_out is False
