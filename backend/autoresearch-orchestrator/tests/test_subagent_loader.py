"""Tests for subagent AGENTS.md loader."""

from __future__ import annotations

from pathlib import Path

import pytest

from agents.subagent_loader import load_subagent, load_subagent_by_name, load_subagents_dir

_PACKAGE = Path(__file__).resolve().parent.parent
_AGENTS_DIR = _PACKAGE / ".deepagents" / "agents"


def test_load_subagents_dir_finds_all_personas() -> None:
    specs = load_subagents_dir(_AGENTS_DIR)
    names = {s["name"] for s in specs}
    assert names >= {"filter", "scientist", "developer", "reviewer", "diagnostic", "experimenter"}


def test_load_subagent_by_name_scientist() -> None:
    spec = load_subagent_by_name(_AGENTS_DIR, "scientist")
    assert spec["name"] == "scientist"
    assert "Modal sandbox" in spec["system_prompt"] or "sandbox" in spec["system_prompt"].lower()


def test_load_subagent_requires_frontmatter(tmp_path: Path) -> None:
    bad = tmp_path / "AGENTS.md"
    bad.write_text("No frontmatter here.", encoding="utf-8")
    with pytest.raises(ValueError, match="frontmatter"):
        load_subagent(bad)


def test_load_subagent_requires_name_and_description(tmp_path: Path) -> None:
    bad = tmp_path / "AGENTS.md"
    bad.write_text("---\nname: only\n---\nbody", encoding="utf-8")
    with pytest.raises(ValueError, match="description"):
        load_subagent(bad)


def test_load_subagent_parses_optional_model(tmp_path: Path) -> None:
    path = tmp_path / "AGENTS.md"
    path.write_text(
        "---\nname: demo\ndescription: test agent\nmodel: anthropic:claude-sonnet\n---\nPrompt body.",
        encoding="utf-8",
    )
    spec = load_subagent(path)
    assert spec["model"] == "anthropic:claude-sonnet"
    assert spec["system_prompt"] == "Prompt body."


def test_load_subagent_by_name_mismatch(tmp_path: Path) -> None:
    folder = tmp_path / "wrong"
    folder.mkdir()
    (folder / "AGENTS.md").write_text(
        "---\nname: other\ndescription: x\n---\nbody",
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="must match folder"):
        load_subagent_by_name(tmp_path, "wrong")
