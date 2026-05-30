"""Tests for RaindropTelemetry (offline, no network)."""

from __future__ import annotations

from dataclasses import replace

import pytest

from agents.swarm import RaindropTelemetry
from config import settings


@pytest.mark.asyncio
async def test_telemetry_disabled_returns_message(tmp_path) -> None:
    cfg = replace(settings, raindrop_enabled=False, workspace_root=tmp_path.resolve())
    telemetry = RaindropTelemetry(cfg)
    summary = await telemetry.summarize_run("nonexistent")
    assert "disabled" in summary.lower()


@pytest.mark.asyncio
async def test_telemetry_spools_locally(tmp_path) -> None:
    cfg = replace(
        settings,
        raindrop_enabled=True,
        raindrop_base_url="http://127.0.0.1:1",  # unreachable
        workspace_root=tmp_path.resolve(),
    )
    telemetry = RaindropTelemetry(cfg)
    await telemetry.log_trace(
        run_id="run-abc",
        span="test",
        level="info",
        detail="ModuleNotFoundError: No module named 'foo'",
    )
    spool = tmp_path / ".telemetry" / "run-abc.jsonl"
    assert spool.exists()
    text = spool.read_text(encoding="utf-8")
    assert "ModuleNotFoundError" in text


def test_semantic_root_cause_extracts_error() -> None:
    trace = [{"detail": "something ModuleNotFoundError: No module named 'torch' happened"}]
    cause = RaindropTelemetry._semantic_root_cause(trace)
    assert "ModuleNotFoundError" in cause


def test_semantic_root_cause_empty() -> None:
    assert "No Raindrop trace" in RaindropTelemetry._semantic_root_cause({})
