"""Tests for the L3 proposer seam that steers L2's experiment loop.

The wrapper invokes the L3 CLI (monkeypatched here so no node/subprocess runs),
reads the directive it writes to `directives/pass-N.json`, and acts on the verdict:
COMMIT/ESCALATE stop the loop (return ('', '')); CONTINUE/RETRY/PIVOT delegate to
the inner proposer.
"""

from __future__ import annotations

import json
from pathlib import Path

import agents.l3_proposer as l3_proposer
from agents.l3_proposer import make_l3_proposer


def _write_directive(run_dir: Path, pass_no: int, verdict: str, *, next_hypotheses=None) -> None:
    directives_dir = run_dir / "directives"
    directives_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "pass": pass_no,
        "verdict": verdict,
        "checks": {},
        "changes": [],
        "rationale": "test rationale",
        "next_hypotheses": next_hypotheses or [],
    }
    (directives_dir / f"pass-{pass_no}.json").write_text(json.dumps(payload), encoding="utf-8")


def _stub_invoker(monkeypatch):
    """Replace the real node shell-out with a no-op; track that it was called."""
    calls: list[Path] = []

    def fake_invoke(run_dir):
        calls.append(Path(run_dir))

    monkeypatch.setattr(l3_proposer, "_invoke_l3", fake_invoke)
    return calls


# --- inner proposer doubles -------------------------------------------------

def make_inner(result=("an idea", "new code")):
    """An async idea_proposer-compatible double matching L2's kwarg signature."""
    state = {"called": False, "kwargs": None}

    async def inner(*, spec, current_code, best, ledger, results_tail):
        state["called"] = True
        state["kwargs"] = {
            "spec": spec,
            "current_code": current_code,
            "best": best,
            "ledger": ledger,
            "results_tail": results_tail,
        }
        return result

    return inner, state


def make_inner_with_hint(result=("hinted idea", "hinted code")):
    """An inner that accepts an explicit `hint=` kwarg, so inspection finds it."""
    state = {"called": False, "hint": "UNSET"}

    async def inner(*, spec, current_code, best, ledger, results_tail, hint=None):
        state["called"] = True
        state["hint"] = hint
        return result

    return inner, state


# L2 calls the proposer with these exact keyword args (experiment_swarm._propose_idea).
def _l2_kwargs():
    return {
        "spec": object(),
        "current_code": "old code",
        "best": 1.23,
        "ledger": object(),
        "results_tail": "row1\nrow2",
    }


async def test_commit_verdict_stops_loop_inner_not_called(tmp_path, monkeypatch):
    calls = _stub_invoker(monkeypatch)
    _write_directive(tmp_path, 3, "COMMIT")
    inner, state = make_inner()

    proposer = make_l3_proposer(tmp_path, inner=inner, latest_pass=lambda: 3)
    result = await proposer(**_l2_kwargs())

    assert result == ("", "")
    assert state["called"] is False
    assert calls == [tmp_path]  # L3 was still invoked to produce the directive


async def test_escalate_verdict_stops_loop(tmp_path, monkeypatch):
    _stub_invoker(monkeypatch)
    _write_directive(tmp_path, 2, "ESCALATE")
    inner, state = make_inner()

    proposer = make_l3_proposer(tmp_path, inner=inner, latest_pass=lambda: 2)
    result = await proposer(**_l2_kwargs())

    assert result == ("", "")
    assert state["called"] is False


async def test_continue_verdict_delegates_to_inner(tmp_path, monkeypatch):
    _stub_invoker(monkeypatch)
    _write_directive(tmp_path, 1, "CONTINUE")
    inner, state = make_inner(result=("delegated desc", "delegated code"))

    proposer = make_l3_proposer(tmp_path, inner=inner, latest_pass=lambda: 1)
    kwargs = _l2_kwargs()
    result = await proposer(**kwargs)

    assert result == ("delegated desc", "delegated code")
    assert state["called"] is True
    assert state["kwargs"]["current_code"] == "old code"
    assert state["kwargs"]["best"] == 1.23


async def test_pivot_verdict_passes_next_hypotheses_as_hint(tmp_path, monkeypatch):
    _stub_invoker(monkeypatch)
    _write_directive(tmp_path, 4, "PIVOT", next_hypotheses=["try bigger lr", "add dropout"])
    inner, state = make_inner_with_hint()

    proposer = make_l3_proposer(tmp_path, inner=inner, latest_pass=lambda: 4)
    result = await proposer(**_l2_kwargs())

    assert result == ("hinted idea", "hinted code")
    assert state["called"] is True
    assert state["hint"] == ["try bigger lr", "add dropout"]


async def test_missing_directive_falls_through_to_inner(tmp_path, monkeypatch):
    _stub_invoker(monkeypatch)
    # No directive file written.
    inner, state = make_inner(result=("fallback", "fallback code"))

    proposer = make_l3_proposer(tmp_path, inner=inner, latest_pass=lambda: 7)
    result = await proposer(**_l2_kwargs())

    assert result == ("fallback", "fallback code")
    assert state["called"] is True


async def test_invoke_runs_before_directive_read(tmp_path, monkeypatch):
    """latest_pass()'s file must be read AFTER _invoke_l3 produces it."""
    order: list[str] = []

    def fake_invoke(run_dir):
        order.append("invoke")
        _write_directive(Path(run_dir), 5, "CONTINUE")

    monkeypatch.setattr(l3_proposer, "_invoke_l3", fake_invoke)

    inner, state = make_inner(result=("after invoke", "code"))

    proposer = make_l3_proposer(tmp_path, inner=inner, latest_pass=lambda: 5)
    result = await proposer(**_l2_kwargs())

    assert order == ["invoke"]
    assert result == ("after invoke", "code")
