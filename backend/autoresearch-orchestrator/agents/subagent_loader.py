"""Load Deep Agents subagent specs from AGENTS.md files (dcode-compatible layout)."""

from __future__ import annotations

from pathlib import Path
import re
from typing import Any

_FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n(.*)", re.DOTALL)


def _parse_frontmatter(text: str) -> tuple[dict[str, str], str]:
    match = _FRONTMATTER_RE.match(text.strip())
    if not match:
        raise ValueError("Subagent AGENTS.md must start with YAML frontmatter (--- ... ---).")
    raw_frontmatter, body = match.groups()
    metadata: dict[str, str] = {}
    for line in raw_frontmatter.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if ":" not in stripped:
            continue
        key, value = stripped.split(":", 1)
        metadata[key.strip()] = value.strip().strip("'\"")
    return metadata, body.strip()


def load_subagent(path: Path) -> dict[str, Any]:
    """Parse one subagent AGENTS.md into a create_deep_agent subagents dict entry."""
    text = path.read_text(encoding="utf-8")
    metadata, body = _parse_frontmatter(text)
    name = metadata.get("name")
    description = metadata.get("description")
    if not name or not description:
        raise ValueError(f"{path}: frontmatter requires 'name' and 'description'.")
    spec: dict[str, Any] = {
        "name": name,
        "description": description,
        "system_prompt": body,
    }
    if model := metadata.get("model"):
        spec["model"] = model
    return spec


def load_subagents_dir(agents_dir: Path) -> list[dict[str, Any]]:
    """Load all subagents from `.deepagents/agents/{name}/AGENTS.md`."""
    if not agents_dir.is_dir():
        return []
    specs: list[dict[str, Any]] = []
    for folder in sorted(agents_dir.iterdir()):
        if not folder.is_dir():
            continue
        agents_md = folder / "AGENTS.md"
        if agents_md.is_file():
            specs.append(load_subagent(agents_md))
    return specs


def load_subagent_by_name(agents_dir: Path, name: str) -> dict[str, Any]:
    """Load a single subagent spec by folder name."""
    path = agents_dir / name / "AGENTS.md"
    if not path.is_file():
        raise FileNotFoundError(f"Missing subagent definition: {path}")
    spec = load_subagent(path)
    if spec["name"] != name:
        raise ValueError(f"{path}: frontmatter name '{spec['name']}' must match folder '{name}'.")
    return spec
