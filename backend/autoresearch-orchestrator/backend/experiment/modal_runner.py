"""Modal-based experiment runner.

Executes training commands inside a Modal sandbox instead of a local
subprocess.  The runner satisfies the same `ExperimentRunner` Protocol as
`LocalSubprocessRunner` and returns the identical `RunResult` dataclass so it
is a transparent drop-in replacement.

Lazy imports: `modal` is only imported inside `_exec_in_sandbox`, so this
module can be imported without Modal credentials or the `modal` package
installed.  The feature is guarded by `settings.experiment_use_modal` so the
default code path (LocalSubprocessRunner) is unaffected.

Known limitation: the Modal sandbox is a fresh `debian_slim` image.  The repo
being trained on is NOT automatically mounted — that requires a separate volume
or file-sync step (out of scope for Task 5, gated by the feature flag).
"""

from __future__ import annotations

import asyncio
from pathlib import Path

from backend.experiment.runner import RunResult
from config import settings as _default_settings, Settings


class ModalExperimentRunner:
    """Run the training command inside a Modal Sandbox, returning a RunResult.

    The actual Modal I/O is isolated in `_exec_in_sandbox` so tests can
    monkeypatch it without needing Modal credentials.
    """

    def __init__(self, cfg: Settings = _default_settings) -> None:
        self.cfg = cfg

    # ------------------------------------------------------------------
    # ExperimentRunner Protocol implementation
    # ------------------------------------------------------------------

    async def run(
        self,
        *,
        command: str,
        cwd: Path,
        log_path: Path,
        timeout: int,
    ) -> RunResult:
        """Execute *command* in a Modal sandbox and return the captured output."""
        exit_code, output = await asyncio.to_thread(self._exec_in_sandbox, command, cwd)

        log_path.parent.mkdir(parents=True, exist_ok=True)
        log_path.write_text(output, encoding="utf-8")

        return RunResult(log_text=output, exit_code=exit_code, timed_out=False)

    # ------------------------------------------------------------------
    # Overridable sandbox layer (monkeypatched in tests)
    # ------------------------------------------------------------------

    def _exec_in_sandbox(self, command: str, cwd: Path) -> tuple[int, str]:
        """Provision a Modal sandbox, exec *command*, and return (exit_code, output).

        This is a synchronous method called via asyncio.to_thread so it does
        not block the event loop.  Import `modal` lazily so the module can be
        loaded without Modal credentials.

        NOTE: The sandbox uses a bare debian_slim image.  The repository at
        *cwd* is NOT mounted automatically.  This is a known Task 5 limitation
        — repo mounting is a subsequent integration step.
        """
        try:
            import modal  # noqa: PLC0415 — intentional lazy import
        except ImportError as exc:
            raise RuntimeError(
                "The `modal` package is required to use ModalExperimentRunner. "
                "Install it with: pip install modal"
            ) from exc

        app = modal.App.lookup(self.cfg.modal_app_name, create_if_missing=True)
        image = modal.Image.debian_slim(python_version=self.cfg.modal_python_version)
        sandbox = modal.Sandbox.create(
            app=app,
            image=image,
            timeout=self.cfg.modal_timeout_seconds,
        )
        try:
            process = sandbox.exec("bash", "-c", command, workdir=str(cwd))
            process.wait()
            stdout = process.stdout.read() if process.stdout else ""
            stderr = process.stderr.read() if process.stderr else ""
            output = stdout + ("\n" + stderr if stderr else "")
            exit_code: int | None = process.returncode
        finally:
            sandbox.terminate()

        return (exit_code, output)
