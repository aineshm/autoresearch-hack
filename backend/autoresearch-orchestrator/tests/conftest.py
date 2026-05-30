"""Shared pytest fixtures."""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

PROGRAM_MD = """# autoresearch

The goal is simple: get the lowest val_bpb. You modify `train.py`. `prepare.py` is read-only.
You CANNOT install new packages. Run it as `uv run train.py`. Output prints `val_bpb:` and
`peak_vram_mb:`. Log results to results.tsv.
"""


@pytest.fixture
def tmp_workspace(tmp_path: Path) -> Path:
    """Writable workspace root for blackboard tests."""
    root = tmp_path / "workspace"
    root.mkdir()
    return root


@pytest.fixture
def git_repo(tmp_path: Path) -> Path:
    """Minimal git repo with program.md + train.py (karpathy-style layout)."""
    repo = tmp_path / "repo"
    repo.mkdir()
    (repo / "program.md").write_text(PROGRAM_MD, encoding="utf-8")
    (repo / "train.py").write_text("DEPTH = 8\n", encoding="utf-8")
    (repo / "prepare.py").write_text("# fixed\n", encoding="utf-8")

    def git(*args: str) -> None:
        subprocess.run(["git", *args], cwd=repo, check=True, capture_output=True, text=True)

    git("init", "-q")
    git("config", "user.email", "test@example.com")
    git("config", "user.name", "Test")
    git("add", "-A")
    git("commit", "-qm", "baseline")
    return repo


def make_run_log(val_bpb: str | None, peak_vram_mb: float = 45000.0) -> str:
    if val_bpb is None:
        return "Traceback (most recent call last):\nRuntimeError: CUDA out of memory\n"
    return (
        f"---\nval_bpb:          {val_bpb}\n"
        f"peak_vram_mb:     {peak_vram_mb}\n"
        f"training_seconds: 300.1\n"
    )
