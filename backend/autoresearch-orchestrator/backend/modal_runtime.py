"""Modal sandbox session via langchain_modal for Deep Agents builder runs."""

from __future__ import annotations

from dataclasses import dataclass
import textwrap
from typing import Any

from config import Settings, settings

BLACKBOARD_ROUTE = "/blackboard/"


@dataclass(frozen=True, slots=True)
class ExecuteSummary:
    """Compressed execute result surfaced to the builder agent."""

    ok: bool
    summary: str
    exit_code: int | None = None
    output_tail: str = ""


def summarize_execute_output(*, output: str, exit_code: int | None) -> ExecuteSummary:
    """Turn raw sandbox stdout/stderr into a compact agent-visible summary."""
    tail = output[-2000:] if len(output) > 2000 else output
    if exit_code == 0:
        return ExecuteSummary(ok=True, summary="Modal execute passed.", exit_code=exit_code, output_tail=tail)
    lines = [line.strip() for line in tail.splitlines() if line.strip()]
    if not lines:
        return ExecuteSummary(
            ok=False,
            summary="Modal execute failed without output.",
            exit_code=exit_code,
            output_tail=tail,
        )
    return ExecuteSummary(
        ok=False,
        summary=textwrap.shorten(lines[-1], width=180, placeholder="..."),
        exit_code=exit_code,
        output_tail=tail,
    )


class ModalSandboxSession:
    """Lifecycle wrapper around a Modal sandbox used as a Deep Agents backend."""

    def __init__(self, cfg: Settings = settings) -> None:
        self.cfg = cfg
        self._sandbox: Any | None = None
        self._modal_backend: Any | None = None

    @property
    def modal_backend(self) -> Any:
        if self._modal_backend is None:
            raise RuntimeError("Modal sandbox has not been created yet.")
        return self._modal_backend

    def create(self) -> Any:
        """Provision a Modal sandbox and return the langchain_modal backend."""
        try:
            import modal
            from langchain_modal import ModalSandbox
        except ImportError as exc:
            raise RuntimeError(
                "Install `modal` and `langchain-modal`, then run `modal setup`."
            ) from exc

        app = modal.App.lookup(self.cfg.modal_app_name, create_if_missing=True)
        image = modal.Image.debian_slim(python_version=self.cfg.modal_python_version).pip_install(
            "pytest"
        )
        self._sandbox = modal.Sandbox.create(
            app=app,
            image=image,
            timeout=self.cfg.modal_timeout_seconds,
        )
        self._modal_backend = ModalSandbox(sandbox=self._sandbox)
        return self._modal_backend

    def builder_backend(self, *, blackboard_root: str) -> Any:
        """Composite backend: Modal execute by default, blackboard files under /blackboard/."""
        from deepagents.backends import CompositeBackend, FilesystemBackend

        return CompositeBackend(
            default=self.modal_backend,
            routes={
                BLACKBOARD_ROUTE: FilesystemBackend(
                    root_dir=blackboard_root,
                    virtual_mode=True,
                ),
            },
        )

    def terminate(self) -> None:
        if self._sandbox is not None:
            self._sandbox.terminate()
        self._sandbox = None
        self._modal_backend = None

    def __enter__(self) -> ModalSandboxSession:
        self.create()
        return self

    def __exit__(self, *_exc: object) -> None:
        self.terminate()


def blackboard_backend(*, blackboard_root: str) -> Any:
    """Filesystem backend for Filter/Router with internal paths kept in agent state."""
    from deepagents.backends import CompositeBackend, FilesystemBackend, StateBackend

    return CompositeBackend(
        default=StateBackend(),
        routes={
            BLACKBOARD_ROUTE: FilesystemBackend(
                root_dir=blackboard_root,
                virtual_mode=True,
            ),
        },
    )
