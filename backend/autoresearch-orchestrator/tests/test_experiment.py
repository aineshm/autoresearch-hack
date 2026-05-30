"""Tests for experiment spec, metrics, workspace, results, runner."""

from __future__ import annotations

from pathlib import Path

import pytest

from backend.experiment import (
    ExperimentSpec,
    ExperimentWorkspace,
    FakeRunner,
    LocalSubprocessRunner,
    MetricReading,
    ResultRow,
    ResultsTsv,
    is_improvement,
    parse_log,
)
from tests.conftest import make_run_log


def test_experiment_spec_from_repo(git_repo: Path) -> None:
    spec = ExperimentSpec.from_repo(git_repo, timeout_seconds=120)
    assert spec.metric_name == "val_bpb"
    assert spec.lower_is_better is True
    assert spec.allow_install is False
    assert spec.run_command == "uv run train.py"
    assert spec.primary_edit_file == "train.py"
    assert "train.py" in spec.constraints_summary()


def test_experiment_spec_custom_hints(tmp_path: Path) -> None:
    repo = tmp_path / "r"
    repo.mkdir()
    (repo / "program.md").write_text(
        "Maximize accuracy. Run `python train.py`. Do not install new packages.\n"
        "Log to custom.log and results.tsv.",
        encoding="utf-8",
    )
    spec = ExperimentSpec.from_repo(repo)
    assert spec.metric_name == "accuracy"
    assert spec.lower_is_better is False
    assert spec.run_command == "python train.py"
    assert spec.log_file == "custom.log"


def test_experiment_spec_missing_program(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError):
        ExperimentSpec.from_repo(tmp_path)


def test_parse_log_success_and_crash() -> None:
    spec = ExperimentSpec(
        repo_path=Path("."),
        program_md="",
        metric_pattern=r"^val_bpb:\s*([0-9.]+)",
        memory_pattern=r"^peak_vram_mb:\s*([0-9.]+)",
    )
    ok = parse_log(make_run_log("0.991000"), spec)
    assert ok.ok is True
    assert ok.value == pytest.approx(0.991)
    assert ok.memory_gb == pytest.approx(43.9, abs=0.2)

    crash = parse_log("Traceback...\n", spec)
    assert crash.crashed is True
    assert crash.value is None


def test_is_improvement_lower_is_better() -> None:
    assert is_improvement(0.99, 1.0, lower_is_better=True) is True
    assert is_improvement(1.0, 0.99, lower_is_better=True) is False
    assert is_improvement(0.99, 0.99, lower_is_better=True) is False
    assert is_improvement(0.5, None, lower_is_better=True) is True


def test_is_improvement_higher_is_better() -> None:
    assert is_improvement(0.9, 0.8, lower_is_better=False) is True
    assert is_improvement(0.7, 0.8, lower_is_better=False) is False


def test_experiment_workspace_git(git_repo: Path) -> None:
    ws = ExperimentWorkspace(git_repo)
    head = ws.head()
    assert len(head) >= 7
    ws.write("train.py", "DEPTH = 4\n")
    info = ws.commit("lower depth", paths=["train.py"])
    assert info.short_hash == ws.head()
    ws.revert_to(head)
    assert "DEPTH = 8" in ws.read("train.py")


def test_experiment_workspace_checkout_branch(git_repo: Path) -> None:
    ws = ExperimentWorkspace(git_repo)
    ws.checkout_branch("autoresearch/test", create=True)
    assert ws.current_branch() == "autoresearch/test"


def test_results_tsv(tmp_path: Path) -> None:
    path = tmp_path / "results.tsv"
    tsv = ResultsTsv(path)
    tsv.append(
        ResultRow(
            commit="abc1234",
            value=0.991,
            memory_gb=44.0,
            status="keep",
            description="baseline",
        )
    )
    tsv.append(
        ResultRow(
            commit="def5678",
            value=None,
            memory_gb=None,
            status="crash",
            description="OOM",
        )
    )
    text = path.read_text(encoding="utf-8")
    assert "commit\tval_bpb" in text
    assert "abc1234" in text
    assert "0.000000" in text
    assert tsv.tail(1).count("\n") >= 1


@pytest.mark.asyncio
async def test_fake_runner(tmp_path: Path) -> None:
    runner = FakeRunner(logs=[make_run_log("1.0"), make_run_log("0.9")])
    log_path = tmp_path / "run.log"
    r1 = await runner.run(command="echo", cwd=tmp_path, log_path=log_path, timeout=5)
    assert "val_bpb" in r1.log_text
    r2 = await runner.run(command="echo", cwd=tmp_path, log_path=log_path, timeout=5)
    assert "0.9" in r2.log_text


@pytest.mark.asyncio
async def test_local_subprocess_runner(tmp_path: Path) -> None:
    runner = LocalSubprocessRunner()
    log_path = tmp_path / "out.log"
    result = await runner.run(
        command="printf 'val_bpb: 1.234567\\npeak_vram_mb: 1024.0\\n'",
        cwd=tmp_path,
        log_path=log_path,
        timeout=10,
    )
    assert result.exit_code == 0
    assert log_path.exists()
    assert "val_bpb" in log_path.read_text(encoding="utf-8")


def test_metric_reading_summary() -> None:
    ok = MetricReading(value=0.99, memory_gb=40.0)
    assert ok.ok is True
    assert "val_bpb=0.990000" in ok.summary("val_bpb")
    crash = MetricReading(value=None, crashed=True)
    assert "crashed" in crash.summary("val_bpb")
