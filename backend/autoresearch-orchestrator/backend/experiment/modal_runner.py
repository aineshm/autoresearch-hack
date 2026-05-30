"""Modal-based experiment runner.

Executes training commands inside a Modal sandbox instead of a local
subprocess.  The runner satisfies the same `ExperimentRunner` Protocol as
`LocalSubprocessRunner` and returns the identical `RunResult` dataclass so it
is a transparent drop-in replacement.

Lazy imports: `modal` is only imported inside `_exec_in_sandbox`, so this
module can be imported without Modal credentials or the `modal` package
installed.  The feature is guarded by `settings.experiment_use_modal` so the
default code path (LocalSubprocessRunner) is unaffected.

Design: fresh sandbox per experiment
- Each call to `run()` creates a NEW sandbox, execs the command, reads output,
  then terminates the sandbox in a try/finally so it always tears down.
- The repo at `cwd` is mounted into the image via `add_local_dir` so that
  train.py and data files exist at /repo inside the sandbox.
- A per-call timeout is honoured (the prior stub ignored it).
"""

from __future__ import annotations

import asyncio
from pathlib import Path

from backend.experiment.runner import RunResult
from config import settings as _default_settings, Settings


class ModalExperimentRunner:
    """Run the training command inside a fresh Modal Sandbox per experiment.

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
        """Execute *command* in a fresh Modal sandbox and return captured output.

        A new sandbox is created and torn down for every call — no sandbox
        reuse across experiments.
        """
        timed_out = False
        output = ""
        exit_code: int | None = None

        try:
            exit_code, output = await asyncio.to_thread(
                self._exec_in_sandbox, cwd, command, timeout
            )
        except (TimeoutError, asyncio.TimeoutError):
            timed_out = True
            output += f"\n[runner] killed after exceeding {timeout}s timeout.\n"
            exit_code = None

        log_path.parent.mkdir(parents=True, exist_ok=True)
        log_path.write_text(output, encoding="utf-8")

        return RunResult(log_text=output, exit_code=exit_code, timed_out=timed_out)

    # ------------------------------------------------------------------
    # Overridable sandbox layer (monkeypatched in tests)
    # ------------------------------------------------------------------

    def _exec_in_sandbox(self, repo_path: Path, command: str, timeout: int) -> tuple[int | None, str]:
        """Provision a fresh Modal sandbox, exec *command*, and return (exit_code, output).

        This is a synchronous method called via asyncio.to_thread so it does
        not block the event loop.  Import `modal` lazily so the module can be
        loaded without Modal credentials.

        A try/finally ensures `sandbox.terminate()` is always called, even if
        exec raises an exception or times out.

        On Modal timeout, re-raises as builtin TimeoutError so `run()` can set
        timed_out=True without importing modal.exception in the outer layer.
        """
        try:
            import modal  # noqa: PLC0415 — intentional lazy import
            import modal.exception as modal_exc  # noqa: PLC0415
        except ImportError as exc:
            raise RuntimeError(
                "The `modal` package is required to use ModalExperimentRunner. "
                "Install it with: pip install modal"
            ) from exc

        app = modal.App.lookup(self.cfg.modal_app_name, create_if_missing=True)
        image = (
            modal.Image.debian_slim(python_version=self.cfg.modal_python_version)
            .add_local_dir(str(repo_path), remote_path="/repo")
        )
        # Give the sandbox a little headroom beyond the per-exec timeout so the
        # sandbox isn't reaped before the exec's own timeout fires.
        sandbox_timeout = timeout + 60
        sandbox = modal.Sandbox.create(
            app=app,
            image=image,
            timeout=sandbox_timeout,
            workdir="/repo",
        )
        try:
            process = sandbox.exec("bash", "-c", command, timeout=timeout, text=True)
            stdout = process.stdout.read() if process.stdout else ""
            stderr = process.stderr.read() if process.stderr else ""
            process.wait()
            output = stdout + ("\n" + stderr if stderr else "")
            exit_code: int | None = process.returncode
        except (
            modal_exc.SandboxTimeoutError,
            modal_exc.TimeoutError,
            modal_exc.ExecTimeoutError,
        ) as exc:
            raise TimeoutError(f"Modal sandbox timed out after {timeout}s") from exc
        finally:
            sandbox.terminate()

        return (exit_code, output)
