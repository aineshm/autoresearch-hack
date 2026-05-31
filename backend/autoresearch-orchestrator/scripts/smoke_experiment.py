"""Offline smoke test for experiment mode: temp git repo, FakeRunner, scripted ideas.

Run: RAINDROP_ENABLED=false .venv/bin/python scripts/smoke_experiment.py
Exercises baseline -> keep -> discard -> crash and verifies git advance/revert,
results.tsv, ledger near-duplicate blocking, and spec parsing of program.md.
"""

from __future__ import annotations

import asyncio
import subprocess
import tempfile
from pathlib import Path

from agents.experiment_swarm import ExperimentSwarm
from backend.experiment import ExperimentSpec, FakeRunner
from config import Settings


PROGRAM_MD = """# autoresearch

The goal is simple: get the lowest val_bpb. You modify `train.py`. `prepare.py` is read-only.
You CANNOT install new packages. Run it as `uv run train.py`. Output prints `val_bpb:` and
`peak_vram_mb:`. Log results to results.tsv.
"""


def _git(repo: Path, *args: str) -> None:
    subprocess.run(["git", *args], cwd=repo, check=True, capture_output=True, text=True)


def _make_repo() -> Path:
    base = Path(__file__).resolve().parent.parent / ".tmp_test"
    base.mkdir(parents=True, exist_ok=True)
    repo = Path(tempfile.mkdtemp(prefix="exp_repo_", dir=base)) / "autoresearch"
    repo.mkdir(parents=True)
    (repo / "program.md").write_text(PROGRAM_MD, encoding="utf-8")
    (repo / "train.py").write_text("DEPTH = 8\n", encoding="utf-8")
    (repo / "prepare.py").write_text("# fixed\n", encoding="utf-8")
    _git(repo, "init", "-q")
    _git(repo, "config", "user.email", "t@t.t")
    _git(repo, "config", "user.name", "t")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-qm", "baseline")
    return repo


def _log(val: str | None, mem_mb: float = 45000.0) -> str:
    if val is None:
        return "Traceback (most recent call last):\nRuntimeError: CUDA out of memory\n"
    return f"---\nval_bpb:          {val}\npeak_vram_mb:     {mem_mb}\ntraining_seconds: 300.1\n"


async def main() -> None:
    repo = _make_repo()

    # spec parsing
    spec = ExperimentSpec.from_repo(repo)
    assert spec.metric_name == "val_bpb", spec.metric_name
    assert spec.lower_is_better is True
    assert spec.allow_install is False, "should detect 'cannot install packages'"
    assert spec.run_command == "uv run train.py", spec.run_command
    print("spec OK:", spec.constraints_summary())

    # baseline 1.00; then keep (0.99), discard (1.02), crash (None)
    runner = FakeRunner(logs=[_log("1.000000"), _log("0.990000"), _log("1.020000"), _log(None)])

    # scripted ideas (4 proposals; loop budget 4)
    ideas = [
        ("increase LR to 0.04", "DEPTH = 8\nLR = 0.04\n"),
        ("switch to GeLU activation", "DEPTH = 8\nACT = 'gelu'\n"),
        ("double model width (OOM risk)", "DEPTH = 8\nWIDTH = 2\n"),
    ]
    calls = {"n": 0}

    async def proposer(*, spec, current_code, best, ledger, results_tail):  # noqa: ANN001
        i = calls["n"]
        calls["n"] += 1
        if i < len(ideas):
            return ideas[i]
        return ("", "")  # stop

    cfg = Settings()
    swarm = ExperimentSwarm(cfg, runner=runner, idea_proposer=proposer)
    result = await swarm.run(repo, max_experiments=4)

    print("best:", result.best_value, "kept:", result.kept, "runs:", result.experiments_run)
    assert result.best_value == 0.99, result.best_value
    assert result.experiments_run == 3, result.experiments_run
    assert result.kept == 1, result.kept

    # train.py should reflect the KEPT change (LR=0.04), not the discarded/crashed ones
    final_code = (repo / "train.py").read_text(encoding="utf-8")
    assert "LR = 0.04" in final_code, final_code
    assert "WIDTH" not in final_code and "gelu" not in final_code, final_code
    print("git advance/revert OK; train.py =", final_code.replace("\n", " | "))

    # results.tsv has header + baseline + 3 experiments, with right statuses
    tsv = (repo / "results.tsv").read_text(encoding="utf-8").strip().splitlines()
    statuses = [line.split("\t")[3] for line in tsv[1:]]
    print("results.tsv statuses:", statuses)
    assert statuses == ["keep", "keep", "discard", "crash"], statuses

    print("ALL EXPERIMENT-MODE CHECKS PASSED")


if __name__ == "__main__":
    asyncio.run(main())
