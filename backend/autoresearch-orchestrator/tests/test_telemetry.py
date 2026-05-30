"""Tests for execute telemetry and modal runtime helpers."""

from __future__ import annotations

from backend.execute_telemetry import _parse_exit_code
from backend.modal_runtime import summarize_execute_output


def test_parse_exit_code() -> None:
    assert _parse_exit_code("Process finished with exit code 1") == 1
    assert _parse_exit_code("Exit Code 0") == 0
    assert _parse_exit_code("no code here") is None


def test_summarize_execute_output_success() -> None:
    summary = summarize_execute_output(output="all tests passed\n", exit_code=0)
    assert summary.ok is True
    assert summary.exit_code == 0
    assert "passed" in summary.output_tail


def test_summarize_execute_output_failure() -> None:
    output = "line1\nModuleNotFoundError: No module named 'torch'\n"
    summary = summarize_execute_output(output=output, exit_code=1)
    assert summary.ok is False
    assert "ModuleNotFoundError" in summary.summary or "module" in summary.summary.lower()


def test_summarize_execute_output_empty_failure() -> None:
    summary = summarize_execute_output(output="", exit_code=1)
    assert summary.ok is False
    assert "without output" in summary.summary
