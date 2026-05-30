"""Real Modal smoke test for ModalExperimentRunner.

Creates a throwaway temp dir with a trivial train.py, then runs the ACTUAL
ModalExperimentRunner (no monkeypatch) against it to prove:
  - repo is mounted at /repo inside the sandbox
  - python train.py executes and prints val_bpb: 0.42
  - RunResult is captured with exit_code=0 and timed_out=False
  - sandbox terminates cleanly

Usage:
    cd backend/autoresearch-orchestrator
    source .venv/bin/activate
    python scripts/modal_smoke.py

Requires Modal to be authenticated (~/.modal.toml) and the
autoresearch-swarm-runtime app to be accessible.

Sandbox: debian_slim (no GPU), exits in seconds, costs pennies.
"""

from __future__ import annotations

import asyncio
import sys
import tempfile
from pathlib import Path

# Ensure the project root is on the path
_project_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_project_root))

from backend.experiment.modal_runner import ModalExperimentRunner  # noqa: E402
from config import settings  # noqa: E402


TRAIN_PY = """\
# Trivial smoke-test training script.
# Prints the metric line that ExperimentSwarm looks for and exits 0.
print("val_bpb: 0.42")
print("peak_vram_mb: 0.0")
print("training_seconds: 0.001")
"""


async def main() -> None:
    print("=== Modal Smoke Test ===")
    print(f"Modal app: {settings.modal_app_name}")
    print(f"Python version in image: {settings.modal_python_version}")
    print()

    with tempfile.TemporaryDirectory(prefix="modal_smoke_") as tmpdir:
        repo_path = Path(tmpdir)
        (repo_path / "train.py").write_text(TRAIN_PY, encoding="utf-8")
        log_path = repo_path / "run.log"

        print(f"Repo path: {repo_path}")
        print(f"train.py contents:\n---\n{TRAIN_PY}---\n")

        runner = ModalExperimentRunner()

        print("Starting Modal sandbox (debian_slim, no GPU)...")
        print("This may take ~30-60s for cold image build on first run.\n")

        result = await runner.run(
            command="python train.py",
            cwd=repo_path,
            log_path=log_path,
            timeout=120,
        )

    print("=== RunResult ===")
    print(f"exit_code : {result.exit_code}")
    print(f"timed_out : {result.timed_out}")
    print(f"log_text  :\n{result.log_text}")

    # Assertions
    if result.exit_code != 0:
        print(f"FAIL: expected exit_code=0, got {result.exit_code}")
        sys.exit(1)

    if result.timed_out:
        print("FAIL: unexpected timeout")
        sys.exit(1)

    if "val_bpb: 0.42" not in result.log_text:
        print(f"FAIL: 'val_bpb: 0.42' not found in log_text:\n{result.log_text}")
        sys.exit(1)

    print("\nSMOKE TEST PASSED: val_bpb: 0.42 found, exit_code=0, timed_out=False")


if __name__ == "__main__":
    asyncio.run(main())
