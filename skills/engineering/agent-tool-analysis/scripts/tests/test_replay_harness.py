from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from replay_harness import (  # noqa: E402
    FROZEN_PRUNED_FLAT_BASELINE_TOOLS,
    ReplayObservation,
    ReplayTask,
    build_benchmark_architectures,
    compare_to_benchmark,
    replay_recorded_observations,
    run_replay,
)
from replay_architectures import build_report  # noqa: E402


def test_benchmark_architectures_freeze_parent_and_candidate_surfaces() -> None:
    parent_tools = {
        "exec",
        "github.add_review_to_pr",
        "github.reply_to_review_comment",
        "github.fetch_file",
        "github.list_pr_changed_filenames",
    }

    architectures = build_benchmark_architectures(parent_tools)

    assert [architecture.architecture_id for architecture in architectures] == [
        "pruned_flat_baseline",
        "pareto_02",
        "pareto_03",
    ]
    baseline, pareto_02, pareto_03 = architectures
    assert baseline.parent_tools == frozenset(parent_tools)
    assert pareto_02.parent_tools == frozenset(
        parent_tools - {
            "github.add_review_to_pr",
            "github.reply_to_review_comment",
        }
    )
    assert pareto_02.specialist_tools == {
        "pareto_02": frozenset(
            {"github.add_review_to_pr", "github.reply_to_review_comment"}
        )
    }
    assert pareto_03.parent_tools == frozenset(
        parent_tools
        - {"github.fetch_file", "github.list_pr_changed_filenames"}
    )


def test_run_replay_uses_only_explicit_task_routes() -> None:
    tasks = [
        ReplayTask("review", required_specialist="pareto_02"),
        ReplayTask("fetch", required_specialist="pareto_03"),
        ReplayTask("general"),
    ]
    architectures = build_benchmark_architectures(
        {
            "exec",
            "github.add_review_to_pr",
            "github.reply_to_review_comment",
            "github.fetch_file",
            "github.list_pr_changed_filenames",
        }
    )
    seen_routes: list[tuple[str, str, str | None]] = []

    def executor(
        task: ReplayTask, architecture, specialist_id: str | None
    ) -> ReplayObservation:
        seen_routes.append((architecture.architecture_id, task.task_id, specialist_id))
        return ReplayObservation(
            task_id=task.task_id,
            task_success=True,
            capability_covered=True,
            quality_score=1.0,
            specialist_activated=specialist_id,
            total_input_tokens=10,
            tool_definition_context_tokens=5,
            turns=1,
            wall_clock_seconds=0.1,
        )

    result = run_replay(tasks, architectures[1], executor)

    assert seen_routes == [
        ("pareto_02", "review", "pareto_02"),
        ("pareto_02", "fetch", None),
        ("pareto_02", "general", None),
    ]
    assert result.aggregate.task_success_rate == 1.0
    assert result.aggregate.specialist_handoffs == 1
    assert result.aggregate.total_tool_context_tokens == 15


def test_recorded_replay_aggregates_all_requested_operational_metrics() -> None:
    tasks = [ReplayTask("review", required_specialist="pareto_02")]
    architecture = build_benchmark_architectures({"exec"})[1]
    result = replay_recorded_observations(
        tasks,
        architecture,
        [
            ReplayObservation(
                task_id="review",
                task_success=True,
                capability_covered=True,
                quality_score=0.95,
                specialist_activated="pareto_02",
                tool_call_failures=2,
                total_input_tokens=120,
                tool_definition_context_tokens=40,
                turns=3,
                wall_clock_seconds=2.5,
            )
        ],
    )

    assert result.aggregate.task_success_rate == 1.0
    assert result.aggregate.tool_call_failures == 2
    assert result.aggregate.routing_failures == 0
    assert result.aggregate.missed_specialist_activations == 0
    assert result.aggregate.unnecessary_specialist_activations == 0
    assert result.aggregate.total_input_tokens == 120
    assert result.aggregate.tool_definition_context_tokens == 40
    assert result.aggregate.turns == 3
    assert result.aggregate.specialist_handoffs == 1
    assert result.aggregate.wall_clock_seconds == 2.5


def test_flat_baseline_does_not_require_candidate_specialist_activation() -> None:
    task = ReplayTask("review", required_specialist="pareto_02")
    result = replay_recorded_observations(
        [task],
        build_benchmark_architectures({"exec"})[0],
        [
            ReplayObservation(
                task_id=task.task_id,
                task_success=True,
                capability_covered=True,
                quality_score=1.0,
            )
        ],
    )

    assert result.aggregate.routing_failures == 0
    assert result.aggregate.missed_specialist_activations == 0
    assert result.aggregate.unnecessary_specialist_activations == 0


def test_replay_report_rejects_benchmark_surface_drift() -> None:
    with pytest.raises(
        ValueError,
        match="does not match frozen pruned_flat_baseline tools",
    ):
        build_report(
            {"tasks": [], "observations": {}},
            {"pruned_flat_baseline": {"tools_retained": ["drifted_tool"]}},
        )


def test_recorded_observation_requires_all_operational_measurements() -> None:
    with pytest.raises(ValueError, match="missing: tool_call_failures"):
        build_report(
            {
                "tasks": [{"task_id": "review"}],
                "observations": {
                    architecture_id: [
                        {
                            "task_id": "review",
                            "task_success": True,
                            "capability_covered": True,
                            "quality_score": 1.0,
                        }
                    ]
                    for architecture_id in (
                        "pruned_flat_baseline",
                        "pareto_02",
                        "pareto_03",
                    )
                },
            },
            {
                "pruned_flat_baseline": {
                    "tools_retained": sorted(FROZEN_PRUNED_FLAT_BASELINE_TOOLS)
                }
            },
        )


def test_candidate_must_preserve_quality_and_capability_with_lower_context() -> None:
    baseline = run_replay(
        [ReplayTask("review"), ReplayTask("fetch")],
        build_benchmark_architectures({"exec"})[0],
        lambda task, architecture, specialist_id: ReplayObservation(
            task_id=task.task_id,
            task_success=True,
            capability_covered=True,
            quality_score=0.9,
            total_input_tokens=100,
            tool_definition_context_tokens=100,
            turns=2,
            wall_clock_seconds=1.0,
        ),
    )
    candidate = run_replay(
        [ReplayTask("review"), ReplayTask("fetch")],
        build_benchmark_architectures({"exec"})[1],
        lambda task, architecture, specialist_id: ReplayObservation(
            task_id=task.task_id,
            task_success=True,
            capability_covered=True,
            quality_score=0.9,
            total_input_tokens=90,
            tool_definition_context_tokens=80,
            turns=2,
            wall_clock_seconds=1.1,
        ),
    )

    comparison = compare_to_benchmark(baseline, candidate)

    assert comparison.passed is True
    assert comparison.capability_coverage_preserved is True
    assert comparison.quality_preserved is True
    assert comparison.context_tokens_reduced is True
    assert comparison.context_tokens_delta == -40


def test_candidate_failure_explains_gate_failure_and_routing_metrics() -> None:
    baseline = run_replay(
        [ReplayTask("review")],
        build_benchmark_architectures({"exec"})[0],
        lambda task, architecture, specialist_id: ReplayObservation(
            task_id=task.task_id,
            task_success=True,
            capability_covered=True,
            quality_score=1.0,
            total_input_tokens=10,
            tool_definition_context_tokens=10,
            turns=1,
            wall_clock_seconds=1.0,
        ),
    )
    candidate = run_replay(
        [ReplayTask("review", required_specialist="pareto_02")],
        build_benchmark_architectures({"exec"})[1],
        lambda task, architecture, specialist_id: ReplayObservation(
            task_id=task.task_id,
            task_success=False,
            capability_covered=False,
            quality_score=0.0,
            tool_call_failures=1,
            missed_specialist_activation=True,
            total_input_tokens=20,
            tool_definition_context_tokens=5,
            turns=2,
            wall_clock_seconds=1.5,
        ),
    )

    comparison = compare_to_benchmark(baseline, candidate)

    assert comparison.passed is False
    assert comparison.capability_coverage_preserved is False
    assert comparison.quality_preserved is False
    assert comparison.context_tokens_reduced is True
    assert candidate.aggregate.tool_call_failures == 1
    assert candidate.aggregate.missed_specialist_activations == 1
