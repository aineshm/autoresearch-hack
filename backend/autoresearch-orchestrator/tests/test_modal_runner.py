"""Unit tests for ModalExperimentRunner.

Two test strategies are used:

1. Monkeypatch `_exec_in_sandbox` — verifies RunResult fields, log-write,
   exit-code propagation, and timed_out=False/True.  Fast, fully offline,
   no real Modal required.

2. Inject a fake `modal` module into sys.modules — lets the *real*
   `_exec_in_sandbox` body run against fakes so we can assert that
   Sandbox.create, add_local_dir, terminate, etc. are called correctly.
   This tests the Modal plumbing contract without credentials.
"""

from __future__ import annotations

import sys
import types
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, call

import pytest

from backend.experiment.runner import RunResult
from backend.experiment.modal_runner import ModalExperimentRunner
from tests.conftest import make_run_log


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_CANNED_OUTPUT = make_run_log("0.950000", peak_vram_mb=32000.0)


def _make_fake_modal(
    sandbox: MagicMock | None = None,
    *,
    exec_raises: Exception | None = None,
) -> types.ModuleType:
    """Return a minimal fake `modal` module suitable for sys.modules injection.

    The fake supports:
      - modal.App.lookup(...)
      - modal.Image.debian_slim(...).add_local_dir(...)
      - modal.Sandbox.create(...)  → sandbox mock
      - sandbox.exec(...)          → process mock (optionally raises)
    """
    if sandbox is None:
        sandbox = MagicMock(name="sandbox")

    # Build a process mock whose stdout/stderr return strings
    process = MagicMock(name="process")
    process.stdout.read.return_value = _CANNED_OUTPUT
    process.stderr.read.return_value = ""
    process.returncode = 0

    if exec_raises is not None:
        sandbox.exec.side_effect = exec_raises
    else:
        sandbox.exec.return_value = process

    # Image chain: debian_slim().add_local_dir() both return the same mock
    image_mock = MagicMock(name="image")
    image_mock.add_local_dir.return_value = image_mock

    # App + Image static-method mocks
    app_mock = MagicMock(name="app")

    fake_modal = types.ModuleType("modal")
    fake_modal.App = MagicMock(name="modal.App")  # type: ignore[attr-defined]
    fake_modal.App.lookup.return_value = app_mock  # type: ignore[attr-defined]
    fake_modal.Image = MagicMock(name="modal.Image")  # type: ignore[attr-defined]
    fake_modal.Image.debian_slim.return_value = image_mock  # type: ignore[attr-defined]
    fake_modal.Sandbox = MagicMock(name="modal.Sandbox")  # type: ignore[attr-defined]
    fake_modal.Sandbox.create.return_value = sandbox  # type: ignore[attr-defined]

    # modal.exception sub-module with the timeout classes _exec_in_sandbox catches
    exc_mod = types.ModuleType("modal.exception")

    class _SandboxTimeoutError(Exception):
        pass

    class _TimeoutError(Exception):
        pass

    class _ExecTimeoutError(Exception):
        pass

    exc_mod.SandboxTimeoutError = _SandboxTimeoutError  # type: ignore[attr-defined]
    exc_mod.TimeoutError = _TimeoutError  # type: ignore[attr-defined]
    exc_mod.ExecTimeoutError = _ExecTimeoutError  # type: ignore[attr-defined]

    fake_modal.exception = exc_mod  # type: ignore[attr-defined]

    return fake_modal


# ---------------------------------------------------------------------------
# Tests using _exec_in_sandbox monkeypatch (fast/offline RunResult contract)
# ---------------------------------------------------------------------------


async def test_modal_runner_returns_run_result(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """ModalExperimentRunner.run() returns a RunResult with correct field values."""
    runner = ModalExperimentRunner()

    def fake_exec_in_sandbox(repo_path: Path, command: str, timeout: int) -> tuple[int, str]:
        return (0, _CANNED_OUTPUT)

    monkeypatch.setattr(runner, "_exec_in_sandbox", fake_exec_in_sandbox)

    log_path = tmp_path / "logs" / "run.log"
    result = await runner.run(
        command="uv run train.py",
        cwd=tmp_path,
        log_path=log_path,
        timeout=60,
    )

    assert isinstance(result, RunResult)
    assert "val_bpb:" in result.log_text
    assert "0.950000" in result.log_text
    assert result.exit_code == 0
    assert result.timed_out is False


async def test_modal_runner_writes_log_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """ModalExperimentRunner.run() writes output to log_path (matching LocalSubprocessRunner behaviour)."""
    runner = ModalExperimentRunner()

    def fake_exec_in_sandbox(repo_path: Path, command: str, timeout: int) -> tuple[int, str]:
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

    crash_output = make_run_log(None)

    def fake_exec_in_sandbox(repo_path: Path, command: str, timeout: int) -> tuple[int, str]:
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
        lambda repo_path, command, timeout: (0, _CANNED_OUTPUT),
    )

    result = await runner.run(
        command="uv run train.py",
        cwd=tmp_path,
        log_path=tmp_path / "run.log",
        timeout=300,
    )
    assert result.timed_out is False


async def test_modal_runner_timed_out_true_when_timeout_raised(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """timed_out is True when _exec_in_sandbox raises TimeoutError."""
    runner = ModalExperimentRunner()

    def fake_exec_in_sandbox(repo_path: Path, command: str, timeout: int) -> tuple[int, str]:
        raise TimeoutError(f"timed out after {timeout}s")

    monkeypatch.setattr(runner, "_exec_in_sandbox", fake_exec_in_sandbox)

    result = await runner.run(
        command="uv run train.py",
        cwd=tmp_path,
        log_path=tmp_path / "run.log",
        timeout=5,
    )

    assert result.timed_out is True
    assert result.exit_code is None
    assert "timeout" in result.log_text.lower()


# ---------------------------------------------------------------------------
# Tests using fake modal module in sys.modules (Modal plumbing contract)
# ---------------------------------------------------------------------------


async def test_fresh_sandbox_per_run_and_repo_mounted(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Each run() creates a new sandbox with the repo mounted at /repo."""
    sandbox = MagicMock(name="sandbox")
    process = MagicMock(name="process")
    process.stdout.read.return_value = _CANNED_OUTPUT
    process.stderr.read.return_value = ""
    process.returncode = 0
    sandbox.exec.return_value = process

    fake_modal = _make_fake_modal(sandbox=sandbox)

    monkeypatch.setitem(sys.modules, "modal", fake_modal)
    monkeypatch.setitem(sys.modules, "modal.exception", fake_modal.exception)

    runner = ModalExperimentRunner()
    log_path = tmp_path / "run.log"

    await runner.run(command="python train.py", cwd=tmp_path, log_path=log_path, timeout=60)

    # Sandbox must have been created exactly once per run
    fake_modal.Sandbox.create.assert_called_once()

    # image was built with add_local_dir pointing at cwd → /repo
    image_mock = fake_modal.Image.debian_slim.return_value
    image_mock.add_local_dir.assert_called_once_with(str(tmp_path), remote_path="/repo")

    # terminate always called (try/finally)
    sandbox.terminate.assert_called_once()


async def test_fresh_sandbox_created_for_each_independent_run(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Two separate run() calls each get their own fresh sandbox (no reuse)."""
    sandbox1 = MagicMock(name="sandbox1")
    sandbox2 = MagicMock(name="sandbox2")

    for sb in (sandbox1, sandbox2):
        p = MagicMock(name="process")
        p.stdout.read.return_value = _CANNED_OUTPUT
        p.stderr.read.return_value = ""
        p.returncode = 0
        sb.exec.return_value = p

    fake_modal = _make_fake_modal()
    # Override Sandbox.create to return distinct sandboxes on successive calls
    fake_modal.Sandbox.create.side_effect = [sandbox1, sandbox2]

    monkeypatch.setitem(sys.modules, "modal", fake_modal)
    monkeypatch.setitem(sys.modules, "modal.exception", fake_modal.exception)

    runner = ModalExperimentRunner()
    log1 = tmp_path / "run1.log"
    log2 = tmp_path / "run2.log"

    await runner.run(command="python train.py", cwd=tmp_path, log_path=log1, timeout=60)
    await runner.run(command="python train.py", cwd=tmp_path, log_path=log2, timeout=60)

    assert fake_modal.Sandbox.create.call_count == 2, "must create two distinct sandboxes"
    sandbox1.terminate.assert_called_once()
    sandbox2.terminate.assert_called_once()


async def test_terminate_called_even_when_exec_raises(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """sandbox.terminate() is always called via try/finally, even when exec raises."""
    sandbox = MagicMock(name="sandbox")
    # Make exec raise a Modal-style timeout; _exec_in_sandbox translates to TimeoutError
    fake_modal = _make_fake_modal(
        sandbox=sandbox,
        exec_raises=Exception("simulated modal exec failure"),
    )
    # For the re-raise path to be TimeoutError we need the class in modal.exception
    # but here we test ANY exception → sandbox.terminate() still fires.
    monkeypatch.setitem(sys.modules, "modal", fake_modal)
    monkeypatch.setitem(sys.modules, "modal.exception", fake_modal.exception)

    runner = ModalExperimentRunner()

    with pytest.raises(Exception, match="simulated modal exec failure"):
        runner._exec_in_sandbox(tmp_path, "python train.py", 60)

    sandbox.terminate.assert_called_once()


async def test_timeout_is_passed_to_exec(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The per-call timeout is forwarded to sandbox.exec (not hardcoded)."""
    sandbox = MagicMock(name="sandbox")
    process = MagicMock(name="process")
    process.stdout.read.return_value = _CANNED_OUTPUT
    process.stderr.read.return_value = ""
    process.returncode = 0
    sandbox.exec.return_value = process

    fake_modal = _make_fake_modal(sandbox=sandbox)
    monkeypatch.setitem(sys.modules, "modal", fake_modal)
    monkeypatch.setitem(sys.modules, "modal.exception", fake_modal.exception)

    runner = ModalExperimentRunner()
    await runner.run(
        command="python train.py",
        cwd=tmp_path,
        log_path=tmp_path / "run.log",
        timeout=42,
    )

    # exec must have received timeout=42
    _args, kwargs = sandbox.exec.call_args
    assert kwargs.get("timeout") == 42, f"expected timeout=42, got {kwargs}"
