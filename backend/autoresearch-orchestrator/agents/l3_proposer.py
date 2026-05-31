"""L3 -> L2 write-back seam: directives steer the experiment loop.

`make_l3_proposer` wraps an existing `idea_proposer` so that, before each next
idea, the L3 strategist analyzes the latest results and writes a directive. The
wrapper reads that directive and acts on its verdict:

* ``COMMIT`` / ``ESCALATE`` -> return ``("", "")`` to STOP L2's loop.
* ``CONTINUE`` / ``RETRY`` / ``PIVOT`` -> delegate to the inner proposer,
  optionally forwarding ``next_hypotheses`` as a ``hint=`` kwarg.

The inner proposer must match L2's call signature (see
``agents.experiment_swarm.ExperimentSwarm._propose_idea``): it is invoked with
keyword args ``spec=, current_code=, best=, ledger=, results_tail=`` and returns
``(description, new_code)``. The wrapper accepts ``**kwargs`` and forwards them
unchanged.
"""

from __future__ import annotations

import inspect
import json
import subprocess
from pathlib import Path
from typing import Awaitable, Callable

# Resolve <repo>/orchestration/bin/synthesize.js. This file lives at
# <repo>/backend/autoresearch-orchestrator/agents/l3_proposer.py, so:
#   parents[0] = agents
#   parents[1] = autoresearch-orchestrator
#   parents[2] = backend
#   parents[3] = <repo root> (contains both backend/ and orchestration/)
L3_CLI = Path(__file__).resolve().parents[3] / "orchestration" / "bin" / "synthesize.js"

# Verdicts that terminate L2's experiment loop.
STOP_VERDICTS = {"COMMIT", "ESCALATE"}

IdeaProposer = Callable[..., Awaitable[tuple[str, str]]]


def _invoke_l3(run_dir: Path) -> None:
    """Shell out to the L3 CLI to analyze `run_dir` and write its directive.

    Kept as a module-level function so tests can monkeypatch
    ``agents.l3_proposer._invoke_l3`` and avoid spawning node. Failures are
    non-fatal: if L3 cannot produce a directive, the wrapper falls through to
    the inner proposer (no directive read -> delegate).
    """
    subprocess.run(
        ["node", str(L3_CLI), "--l2", str(run_dir)],
        check=False,
        capture_output=True,
    )


def _read_latest_directive(run_dir: Path, pass_no: int) -> dict | None:
    """Read `run_dir/directives/pass-{pass_no}.json`; return its dict or None."""
    path = Path(run_dir) / "directives" / f"pass-{pass_no}.json"
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
    return data if isinstance(data, dict) else None


def make_l3_proposer(
    run_dir: str | Path,
    *,
    inner: IdeaProposer,
    latest_pass: Callable[[], int],
) -> IdeaProposer:
    """Wrap `inner` so L3 directives steer L2's experiment loop.

    Args:
        run_dir: The L2 run directory the L3 CLI reads (and writes directives to).
        inner: The fallback idea_proposer to delegate to on non-stop verdicts.
        latest_pass: Returns the pass number whose directive to act on.

    Returns:
        An async callable with the same contract as L2's idea_proposer.
    """
    run_path = Path(run_dir)
    inner_accepts_hint = "hint" in inspect.signature(inner).parameters

    async def proposer(**kwargs) -> tuple[str, str]:
        # 1) Let L3 analyze the latest results and write a directive.
        _invoke_l3(run_path)

        # 2) Read the directive L3 just wrote (after invocation produced it).
        pass_no = latest_pass()
        directive = _read_latest_directive(run_path, pass_no)

        # 3) Act on the verdict.
        verdict = directive.get("verdict") if directive else None
        if verdict in STOP_VERDICTS:
            return ("", "")

        if inner_accepts_hint and directive:
            next_hypotheses = directive.get("next_hypotheses")
            if next_hypotheses:
                return await inner(**kwargs, hint=next_hypotheses)

        return await inner(**kwargs)

    return proposer
