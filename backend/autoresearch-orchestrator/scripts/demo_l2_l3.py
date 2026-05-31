"""End-to-end smoke: L2 experiment loop steered by L3 directives (no Modal/GPU).

Wires an ExperimentSwarm with a FakeRunner (scripted metrics) and an L3-driven
idea_proposer. Each generation, L2 writes results.tsv; the L3 proposer invokes the
real L3 CLI (node orchestration/bin/synthesize.js --l2 <repo>) which reads the
results + program.md, asks the LLM (or its deterministic fallback) for a directive,
and writes directives/pass-N.json. L2 reads the verdict back: COMMIT/ESCALATE stops,
else the inner proposer supplies the next experiment.

Run: python scripts/demo_l2_l3.py
"""
from __future__ import annotations

import asyncio
import tempfile
from pathlib import Path

from backend.experiment.runner import FakeRunner
from agents.experiment_swarm import ExperimentSwarm
from agents.l3_proposer import make_l3_proposer


PROGRAM_MD = """# Speedrun: minimize val_bpb on the toy task

Edit `train.py`. Run with `python train.py`. The metric is `val_bpb` (lower is better).
Goal: get val_bpb below 0.95.
"""

TRAIN_PY = "print('val_bpb: 1.0')\nprint('peak_vram_mb: 10.0')\n"

# Scripted training logs the FakeRunner returns per call: baseline + 3 experiments.
# Metric plateaus after gen 2 -> L3 should eventually PIVOT/COMMIT.
FAKE_LOGS = [
    "val_bpb: 1.000\npeak_vram_mb: 10.0\n",   # baseline
    "val_bpb: 0.990\npeak_vram_mb: 10.0\n",   # gen 1: improves -> keep
    "val_bpb: 0.991\npeak_vram_mb: 10.0\n",   # gen 2: no improve -> discard
    "val_bpb: 0.990\npeak_vram_mb: 10.0\n",   # gen 3: tie -> discard (plateau)
]

# A simple inner proposer: scripted edits so we don't need the LLM experimenter agent.
# Each edit must produce DISTINCT file content (a unique comment) so git has
# something to commit every generation.
EDITS = [
    ("increase LR to 0.04", "# exp1: lr=0.04\nprint('val_bpb: 0.990')\n"),
    ("switch to GeLU", "# exp2: gelu\nprint('val_bpb: 0.991')\n"),
    ("add dropout 0.1", "# exp3: dropout=0.1\nprint('val_bpb: 0.990')\n"),
    ("", ""),  # nothing left -> stop
]


def make_inner():
    state = {"i": 0}

    async def inner(*, spec, current_code, best, ledger, results_tail, hint=None):
        i = state["i"]
        state["i"] += 1
        if i >= len(EDITS):
            return ("", "")
        desc, code = EDITS[i]
        if hint:
            print(f"   inner received hint: {hint}")
        return (desc, code)

    return inner


async def main() -> None:
    tmp = Path(tempfile.mkdtemp(prefix="l2l3-demo-"))
    repo = tmp / "repo"
    repo.mkdir()
    (repo / "program.md").write_text(PROGRAM_MD)
    (repo / "train.py").write_text(TRAIN_PY)

    # git init so the swarm's commit/revert works
    import subprocess
    subprocess.run(["git", "init", "-q"], cwd=repo, check=True)
    subprocess.run(["git", "add", "-A"], cwd=repo, check=True)
    subprocess.run(["git", "-c", "user.email=demo@x.io", "-c", "user.name=demo",
                    "commit", "-q", "-m", "baseline"], cwd=repo, check=True)

    runner = FakeRunner(logs=FAKE_LOGS)

    # latest_pass = number of result rows so far = lines in results.tsv minus header.
    def latest_pass() -> int:
        tsv = repo / "results.tsv"
        if not tsv.exists():
            return 0
        lines = [l for l in tsv.read_text().splitlines() if l.strip()]
        return max(0, len(lines) - 1)

    proposer = make_l3_proposer(repo, inner=make_inner(), latest_pass=latest_pass)
    swarm = ExperimentSwarm(runner=runner, idea_proposer=proposer)

    print(f"[demo] run dir: {repo}")
    result = await swarm.run(repo, max_experiments=4)

    print("\n=== RESULT ===")
    print(f"best val_bpb: {result.best_value}")
    print(f"experiments_run: {result.experiments_run}  kept: {result.kept}")

    print("\n=== results.tsv ===")
    print((repo / "results.tsv").read_text() if (repo / "results.tsv").exists() else "(none)")

    dirs = sorted((repo / "directives").glob("pass-*.json")) if (repo / "directives").exists() else []
    print(f"\n=== L3 directives written: {len(dirs)} ===")
    for d in dirs:
        import json
        data = json.loads(d.read_text())
        print(f"  {d.name}: verdict={data['verdict']}  rationale={data['rationale'][:80]}")

    if dirs:
        print("\nSMOKE PASSED: L2 ran generations AND L3 wrote directives that steered the loop.")
    else:
        print("\nSMOKE INCOMPLETE: no L3 directives were written — check the bridge.")


if __name__ == "__main__":
    asyncio.run(main())
