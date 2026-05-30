"""CLI entry point for token-efficient autoresearch generations."""

from __future__ import annotations

import argparse
import asyncio
from pathlib import Path

from agents.swarm import AutoresearchSwarm


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the autoresearch swarm.")
    parser.add_argument(
        "goal",
        nargs="?",
        default="",
        help="Research or implementation goal (general mode). Omit when using --experiment-repo.",
    )
    parser.add_argument(
        "--raw",
        default="",
        help="Raw research material. Prefer --raw-file for large inputs.",
    )
    parser.add_argument(
        "--raw-file",
        type=Path,
        help="Path to raw docs, notes, scrape output, or paper text for The Filter.",
    )
    parser.add_argument(
        "--experiment-repo",
        type=Path,
        help="Path to a repo containing program.md; runs the experiment (keep/discard) loop.",
    )
    parser.add_argument(
        "--max-experiments",
        type=int,
        default=None,
        help="Override the experiment budget (experiment mode only).",
    )
    return parser.parse_args()


async def async_main() -> None:
    args = parse_args()

    if args.experiment_repo:
        from agents.experiment_swarm import ExperimentSwarm
        from config import settings

        runner = None
        if settings.experiment_use_modal:
            from backend.experiment.modal_runner import ModalExperimentRunner
            runner = ModalExperimentRunner()

        swarm = ExperimentSwarm(runner=runner)
        result = await swarm.run(args.experiment_repo, max_experiments=args.max_experiments)
        print(
            f"[EXPERIMENT] best={result.best_value} kept={result.kept}/{result.experiments_run} "
            f"head={result.head_commit}"
        )
        print(f"[EXPERIMENT] results: {result.results_path}")
        return

    if not args.goal:
        raise SystemExit("Provide a goal, or use --experiment-repo PATH for experiment mode.")

    raw = args.raw
    if args.raw_file:
        raw = args.raw_file.read_text(encoding="utf-8")

    swarm = AutoresearchSwarm()
    result = await swarm.run(args.goal, raw)
    print(result.final_summary)
    print(f"[PI] blackboard: {result.blackboard_root}")


if __name__ == "__main__":
    asyncio.run(async_main())
