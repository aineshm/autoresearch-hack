"""Tests for MarkdownBlackboard and swarm parsing helpers."""

from __future__ import annotations

import pytest

from agents.swarm import (
    AutoresearchSwarm,
    MarkdownBlackboard,
    ReviewVerdict,
    WorkerOutcome,
    _extract_approach,
    _extract_error_class,
    _extract_text,
    _is_environment_error,
    _parse_review,
)
from config import Settings, settings


@pytest.mark.asyncio
async def test_blackboard_write_read_append(tmp_workspace) -> None:
    bb = MarkdownBlackboard(tmp_workspace, visible_files=("a.md",))
    await bb.write("a.md", "# Hello")
    assert await bb.read("a.md") == "# Hello"
    await bb.append("a.md", "More")
    assert "Hello" in await bb.read("a.md")
    assert "More" in await bb.read("a.md")


@pytest.mark.asyncio
async def test_blackboard_rejects_non_markdown(tmp_workspace) -> None:
    bb = MarkdownBlackboard(tmp_workspace, visible_files=())
    with pytest.raises(ValueError, match="markdown"):
        await bb.write("data.json", "{}")


@pytest.mark.asyncio
async def test_blackboard_rejects_path_traversal(tmp_workspace) -> None:
    bb = MarkdownBlackboard(tmp_workspace, visible_files=())
    with pytest.raises(ValueError, match="Unsafe|escapes"):
        await bb.write("../escape.md", "x")


@pytest.mark.asyncio
async def test_blackboard_worker_subpaths(tmp_workspace) -> None:
    bb = MarkdownBlackboard(tmp_workspace, visible_files=())
    await bb.write("workers/p1/plan.md", "plan")
    assert await bb.read("workers/p1/plan.md") == "plan"


@pytest.mark.asyncio
async def test_parent_context_only_visible_files(tmp_workspace) -> None:
    bb = MarkdownBlackboard(tmp_workspace, visible_files=("visible.md",))
    await bb.write("visible.md", "yes")
    await bb.write("hidden.md", "no")
    ctx = await bb.parent_context()
    assert "visible.md" in ctx
    assert "yes" in ctx
    assert "hidden.md" not in ctx


def test_extract_text_from_mapping() -> None:
    assert _extract_text({"messages": [{"role": "assistant", "content": "done"}]}) == "done"
    assert _extract_text({"messages": []}) == "{'messages': []}"


def test_extract_approach() -> None:
    plan = "1. **Approach** — fine-tune BERT on the dataset.\n2. Files written"
    assert "BERT" in _extract_approach(plan, fallback="x")
    assert _extract_approach("", fallback="fallback") == "fallback"


def test_extract_error_class() -> None:
    err = "p2\nModuleNotFoundError\nFull trace logged to Raindrop."
    assert _extract_error_class(err) == "ModuleNotFoundError"
    assert _extract_error_class("") == ""


def test_is_environment_error() -> None:
    assert _is_environment_error("ModuleNotFoundError", "no module named torch")
    assert not _is_environment_error("AssertionError", "assert 1 == 2")


def test_parse_review_verdict_and_score() -> None:
    accept = _parse_review("SCORE: 0.82\nVERDICT: accept\n", 0.7)
    assert accept.accepted is True
    assert accept.score == 0.82

    revise = _parse_review("SCORE: 0.4\nVERDICT: revise\n", 0.7)
    assert revise.accepted is False

    fallback = _parse_review("SCORE: 0.75\n", 0.7)
    assert fallback.accepted is True
    assert isinstance(fallback, ReviewVerdict)


@pytest.mark.asyncio
async def test_merge_worker_results(tmp_workspace) -> None:
    from dataclasses import replace

    from config import settings

    cfg = replace(settings, workspace_root=tmp_workspace.resolve(), raindrop_enabled=False)
    swarm = AutoresearchSwarm(cfg)
    outcomes = [
        WorkerOutcome(
            packet_id="p1",
            packet="build parser",
            success=True,
            approach="PEG parser",
            result_md="Outcome: works.",
        ),
        WorkerOutcome(
            packet_id="p2",
            packet="train model",
            success=False,
            approach="fine-tune BERT",
            error_class="ModuleNotFoundError",
            error_md="p2\nModuleNotFoundError\nRaindrop.",
            diagnostic_ran=True,
        ),
    ]
    await swarm._merge_worker_results(1, outcomes)

    builder = await swarm.blackboard.read("builder_result.md")
    assert "p1" in builder
    assert "works" in builder
    assert "ModuleNotFoundError" in builder

    errors = await swarm.blackboard.read("error_summary.md")
    assert "p2" in errors

    await swarm._merge_worker_results(
        2,
        [
            WorkerOutcome(
                packet_id="p1",
                packet="ok",
                success=True,
                approach="done",
                result_md="ok",
            )
        ],
    )
    assert await swarm.blackboard.read("error_summary.md") == ""
