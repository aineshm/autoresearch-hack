"""Tests for config.Settings helpers."""

from __future__ import annotations

import importlib
import os

import pytest


def test_env_bool(monkeypatch: pytest.MonkeyPatch) -> None:
    import config as config_module

    importlib.reload(config_module)
    _env_bool = config_module._env_bool

    monkeypatch.delenv("TEST_BOOL", raising=False)
    assert _env_bool("TEST_BOOL", True) is True
    assert _env_bool("TEST_BOOL", False) is False

    for truthy in ("1", "true", "TRUE", "yes", "on"):
        monkeypatch.setenv("TEST_BOOL", truthy)
        assert _env_bool("TEST_BOOL", False) is True

    monkeypatch.setenv("TEST_BOOL", "false")
    assert _env_bool("TEST_BOOL", True) is False


def test_settings_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    import config as config_module

    for key in list(os.environ):
        if key.startswith(
            (
                "AUTORESEARCH_",
                "MODAL_",
                "RAINDROP_",
                "LITERATURE_",
                "DISTILLED_",
            )
        ):
            monkeypatch.delenv(key, raising=False)

    importlib.reload(config_module)
    s = config_module.Settings()

    assert s.max_generations == 3
    assert s.max_workers == 3
    assert s.ledger_similarity_threshold == 0.8
    assert s.reviewer_enabled is True
    assert "distilled_brief.md" in s.parent_visible_files
    assert s.experiment_timeout_seconds == 600
