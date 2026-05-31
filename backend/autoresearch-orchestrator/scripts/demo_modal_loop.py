"""Real Modal loop demo: prove a FRESH sandbox is created per experiment.

Runs the L2 experiment loop with the REAL ModalExperimentRunner (not FakeRunner).
Each experiment edits train.py, then the runner spins up a brand-new Modal sandbox,
mounts the repo, runs `python train.py`, captures `val_bpb:`, and tears the sandbox
down. You should see one distinct `[modal] fresh sandbox <id> created ... terminated`
pair per experiment — proving per-experiment isolation.

Costs a few pennies (tiny debian_slim sandboxes, no GPU). Requires Modal auth.

Run: PYTHONPATH=. python scripts/demo_modal_loop.py
"""
from __future__ import annotations

import asyncio
import subprocess
import tempfile
from pathlib import Path

from agents.experiment_swarm import ExperimentSwarm
from agents.l3_proposer import make_l3_proposer
from backend.experiment.modal_runner import ModalExperimentRunner


PROGRAM_MD = """# Speedrun: minimize val_bpb on a toy task

Edit `train.py`. Run with `python train.py`. The metric is `val_bpb` (lower is better).
Goal: get val_bpb below 0.95.
"""

# Each train.py prints a different metric so the loop has real keep/discard dynamics.
BASELINE_TRAIN = "print('val_bpb: 1.000')\nprint('peak_vram_mb: 10.0')\n"

EDITS = [
    ("lower learning rate", "print('val_bpb: 0.94')\nprint('peak_vram_mb: 10.0')\n"),
    ("add weight decay", "print('val_bpb: 0.96')\nprint('peak_vram_mb: 10.0')\n"),
    ("", ""),  # stop
]


def make_inner():
    state = {"i": 0}

    async def inner(*, spec, current_code, best, ledger, results_tail, hint=None):
        i = state["i"]
        state["i"] += 1
        if i >= len(EDITS):
            return ("", "")
        return EDITS[i]

    return inner


async def main() -> None:
    tmp = Path(tempfile.mkdtemp(prefix="modal-loop-"))
    repo = tmp / "repo"
    repo.mkdir()
    (repo / "program.md").write_text(PROGRAM_MD)
    (repo / "train.py").write_text(BASELINE_TRAIN)
    subprocess.run(["git", "init", "-q"], cwd=repo, check=True)
    subprocess.run(["git", "add", "-A"], cwd=repo, check=True)
    subprocess.run(["git", "-c", "user.email=demo@x.io", "-c", "user.name=demo",
                    "commit", "-q", "-m", "baseline"], cwd=repo, check=True)

    runner = ModalExperimentRunner()  # REAL Modal — fresh sandbox per experiment

    def latest_pass() -> int:
        tsv = repo / "results.tsv"
        if not tsv.exists():
            return 0
        return max(0, len([l for l in tsv.read_text().splitlines() if l.strip()]) - 1)

    proposer = make_l3_proposer(repo, inner=make_inner(), latest_pass=latest_pass)
    swarm = ExperimentSwarm(runner=runner, idea_proposer=proposer)

    print(f"[demo] run dir: {repo}")
    print("[demo] watch for one '[modal] fresh sandbox ... created/terminated' per experiment\n")
    result = await swarm.run(repo, max_experiments=3)

    print("\n=== RESULT ===")
    print(f"best val_bpb: {result.best_value}  experiments_run: {result.experiments_run}  kept: {result.kept}")
    print("\n=== results.tsv ===")
    print((repo / "results.tsv").read_text())


if __name__ == "__main__":
    asyncio.run(main())
