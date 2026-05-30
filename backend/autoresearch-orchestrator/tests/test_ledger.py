"""Tests for research ledger models and tools."""

from __future__ import annotations

import pytest

from backend.ledger import Attempt, ResearchLedger, create_ledger_tools


def test_ledger_records_and_stats() -> None:
    ledger = ResearchLedger()
    ledger.record(
        Attempt.create(
            attempt_id="a1",
            packet_id="p1",
            generation=1,
            approach="recursive descent parser with memoization",
            outcome="failure",
            error_class="AssertionError",
        )
    )
    ledger.record(
        Attempt.create(
            attempt_id="a2",
            packet_id="p2",
            generation=1,
            approach="train transformer from scratch",
            outcome="success",
        )
    )
    stats = ledger.stats()
    assert stats["attempts"] == 2
    assert stats["failures"] == 1
    assert stats["successes"] == 1


def test_ledger_blocks_exact_duplicate() -> None:
    ledger = ResearchLedger()
    approach = "use a recursive descent parser with memoization"
    ledger.record(
        Attempt.create(
            attempt_id="a1",
            packet_id="p1",
            generation=1,
            approach=approach,
            outcome="failure",
        )
    )
    assert ledger.is_blocked(approach) is True


def test_ledger_blocks_near_duplicate() -> None:
    ledger = ResearchLedger(similarity_threshold=0.8)
    ledger.record(
        Attempt.create(
            attempt_id="a1",
            packet_id="p1",
            generation=1,
            approach="recursive descent parser with memoization",
            outcome="failure",
        )
    )
    match = ledger.find_blocking_failure(
        "recursive descent parser with memoization for speed"
    )
    assert match is not None
    assert match.similarity >= 0.8


def test_ledger_does_not_block_different_approach() -> None:
    ledger = ResearchLedger()
    ledger.record(
        Attempt.create(
            attempt_id="a1",
            packet_id="p1",
            generation=1,
            approach="recursive descent parser",
            outcome="failure",
        )
    )
    assert ledger.find_blocking_failure("train a transformer from scratch") is None


def test_ledger_success_does_not_block() -> None:
    ledger = ResearchLedger()
    approach = "PEG parser implementation"
    ledger.record(
        Attempt.create(
            attempt_id="a1",
            packet_id="p1",
            generation=1,
            approach=approach,
            outcome="success",
        )
    )
    assert ledger.is_blocked(approach) is False


def test_ledger_persistence(tmp_path) -> None:
    path = tmp_path / "ledger.json"
    ledger = ResearchLedger()
    ledger.record(
        Attempt.create(
            attempt_id="a1",
            packet_id="p1",
            generation=1,
            approach="idea A",
            outcome="failure",
            error_class="crash",
        )
    )
    ledger.save_json(path)

    loaded = ResearchLedger.load_json(path)
    assert loaded.stats()["attempts"] == 1
    assert "idea A" in loaded.to_markdown()


@pytest.mark.asyncio
async def test_ledger_tools() -> None:
    ledger = ResearchLedger()
    ledger.record(
        Attempt.create(
            attempt_id="a1",
            packet_id="p1",
            generation=1,
            approach="failed idea xyz unique token",
            outcome="failure",
            error_class="OOM",
        )
    )
    check, list_failed = create_ledger_tools(ledger=ledger)

    blocked = await check("failed idea xyz unique token")
    assert "BLOCKED" in blocked

    ok = await check("completely unrelated quantum approach")
    assert "Safe to proceed" in ok

    listing = await list_failed()
    assert "failed idea" in listing
