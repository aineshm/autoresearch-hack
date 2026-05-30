"""Integration tests for ExperimentSwarm (no LLM)."""

from __future__ import annotations

from dataclasses import replace

import pytest

from agents.experiment_swarm import ExperimentSwarm
from backend.experiment import FakeRunner
from config import settings
from tests.conftest import make_run_log


@pytest.mark.asyncio
async def test_experiment_swarm_keep_discard_crash(git_repo) -> None:
    runner = FakeRunner(
        logs=[
            make_run_log("1.000000"),  # baseline
            make_run_log("0.990000"),  # keep
            make_run_log("1.020000"),  # discard
            make_run_log(None),  # crash
        ]
    )
    ideas = [
        ("increase LR to 0.04", "DEPTH = 8\nLR = 0.04\n"),
        ("switch to GeLU", "DEPTH = 8\nACT = gelu\n"),
        ("double width OOM", "DEPTH = 8\nWIDTH = 2\n"),
    ]
    calls = {"n": 0}

    async def proposer(*, spec, current_code, best, ledger, results_tail):  # noqa: ANN001
        i = calls["n"]
        calls["n"] += 1
        if i < len(ideas):
            return ideas[i]
        return ("", "")

    cfg = replace(settings, ledger_enabled=True, raindrop_enabled=False, max_experiments=10)
    swarm = ExperimentSwarm(cfg, runner=runner, idea_proposer=proposer)
    result = await swarm.run(git_repo, max_experiments=4)

    assert result.best_value == pytest.approx(0.99)
    assert result.experiments_run == 3
    assert result.kept == 1

    train = (git_repo / "train.py").read_text(encoding="utf-8")
    assert "LR = 0.04" in train
    assert "WIDTH" not in train

    tsv_lines = (git_repo / "results.tsv").read_text(encoding="utf-8").strip().splitlines()
    statuses = [line.split("\t")[3] for line in tsv_lines[1:]]
    assert statuses == ["keep", "keep", "discard", "crash"]


@pytest.mark.asyncio
async def test_experiment_swarm_skips_blocked_idea_after_discard(git_repo) -> None:
    """After a discarded experiment, retrying the same idea should be skipped."""
    runner = FakeRunner(
        logs=[
            make_run_log("1.000000"),  # baseline
            make_run_log("1.050000"),  # worse -> discard
        ]
    )
    description = "increase learning rate to 0.04"

    async def proposer(*, spec, current_code, best, ledger, results_tail):  # noqa: ANN001
        return (description, "DEPTH = 8\nLR = 0.04\n")

    cfg = replace(settings, raindrop_enabled=False, ledger_enabled=True)
    swarm = ExperimentSwarm(cfg, runner=runner, idea_proposer=proposer)
    result = await swarm.run(git_repo, max_experiments=3)

    # baseline + one discard; further iterations skip blocked duplicate
    assert result.experiments_run == 1
    assert result.best_value == pytest.approx(1.0)

    ledger = swarm._load_ledger(result.run_id)
    assert ledger.is_blocked(description) is True
