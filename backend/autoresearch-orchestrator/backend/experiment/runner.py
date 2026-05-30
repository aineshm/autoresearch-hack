"""Execute a training run and return its raw log text.

The runner is abstracted so the loop can be exercised without a GPU (FakeRunner)
and later swapped for a GPU Modal sandbox. `LocalSubprocessRunner` runs the command
on the local machine (the reference loop is designed to run on the GPU box itself).
Full output is captured to the log file; only a compact reading is surfaced to agents.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from pathlib import Path
import subprocess
from typing import Protocol


@dataclass(slots=True)
class RunResult:
    log_text: str
    exit_code: int | None
    timed_out: bool = False


class ExperimentRunner(Protocol):
    async def run(self, *, command: str, cwd: Path, log_path: Path, timeout: int) -> RunResult: ...


class LocalSubprocessRunner:
    """Run the training command locally, capturing combined output to the log file."""

    async def run(self, *, command: str, cwd: Path, log_path: Path, timeout: int) -> RunResult:
        proc = await asyncio.create_subprocess_shell(
            command,
            cwd=str(cwd),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
        )
        timed_out = False
        try:
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout)
            output = stdout.decode("utf-8", errors="replace") if stdout else ""
            exit_code = proc.returncode
        except asyncio.TimeoutError:
            timed_out = True
            proc.kill()
            try:
                stdout, _ = await proc.communicate()
                output = stdout.decode("utf-8", errors="replace") if stdout else ""
            except Exception:  # noqa: BLE001
                output = ""
            output += f"\n[runner] killed after exceeding {timeout}s timeout.\n"
            exit_code = None
        log_path.parent.mkdir(parents=True, exist_ok=True)
        log_path.write_text(output, encoding="utf-8")
        return RunResult(log_text=output, exit_code=exit_code, timed_out=timed_out)


@dataclass(slots=True)
class FakeRunner:
    """Deterministic runner for tests: returns scripted log text per call."""

    logs: list[str] = field(default_factory=list)
    _index: int = 0

    async def run(self, *, command: str, cwd: Path, log_path: Path, timeout: int) -> RunResult:
        text = self.logs[self._index] if self._index < len(self.logs) else ""
        self._index += 1
        log_path.parent.mkdir(parents=True, exist_ok=True)
        log_path.write_text(text, encoding="utf-8")
        return RunResult(log_text=text, exit_code=0 if text else 1)
