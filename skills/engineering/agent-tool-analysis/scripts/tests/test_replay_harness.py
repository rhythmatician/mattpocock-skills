from __future__ import annotations

import pytest
from optimize_agent_tools.replay_harness import (  # noqa: E402
    BASELINE_ARCHITECTURE_ID,
    ReplayObservation,
    ReplayTask,
    build_architecture_manifest,
    compare_to_benchmark,
    historical_tool_capability_coverage,
    replay_recorded_observations,
    run_replay,
)
from replay_architectures import build_report  # noqa: E402

HISTORICAL_TOOLS = frozenset({"exec", "review_tool", "file_tool"})


def manifest_raw() -> dict:
    baseline_tools = ["exec"]
    return {
        "baseline_architecture_id": BASELINE_ARCHITECTURE_ID,
        "historical_tool_capability_tools": sorted(baseline_tools),
        "architectures": [
            {
                "architecture_id": BASELINE_ARCHITECTURE_ID,
                "parent_tools": baseline_tools,
                "agents": {},
            },
            {
                "architecture_id": "two_agents",
                "parent_tools": ["exec"],
                "agents": {
                    "review_agent": ["review_tool"],
                    "file_agent": ["file_tool"],
                },
            },
        ],
    }


def observation(
    task_id: str,
    *,
    path: tuple[str, ...] = (),
    covered: bool = True,
    context: int = 10,
    delegation: int = 0,
    communication: int = 0,
) -> ReplayObservation:
    return ReplayObservation(
        task_id=task_id,
        task_success=True,
        observed_replay_capability_covered=covered,
        quality_score=1.0,
        agent_activation_path=path,
        total_input_tokens=20,
        tool_definition_context_tokens=context,
        delegation_tokens=delegation,
        inter_agent_communication_tokens=communication,
        turns=2,
        wall_clock_seconds=0.5,
    )


def test_manifest_supports_arbitrary_architectures_and_owns_its_baseline() -> None:
    manifest = build_architecture_manifest(manifest_raw())

    assert manifest.architecture_ids == (
        BASELINE_ARCHITECTURE_ID,
        "two_agents",
    )
    assert manifest.baseline.parent_tools == frozenset({"exec"})
    assert manifest.architectures[1].agent_tools == {
        "review_agent": frozenset({"review_tool"}),
        "file_agent": frozenset({"file_tool"}),
    }


def test_manifest_requires_pruned_flat_baseline_name() -> None:
    raw = manifest_raw()
    raw["baseline_architecture_id"] = "some_other_baseline"

    with pytest.raises(ValueError, match="baseline must be pruned_flat_baseline"):
        build_architecture_manifest(raw)


def test_activation_path_supports_zero_one_and_multiple_handoffs() -> None:
    architecture = build_architecture_manifest(manifest_raw()).architectures[1]
    tasks = [
        ReplayTask("none"),
        ReplayTask("one", {"two_agents": ("review_agent",)}),
        ReplayTask(
            "two",
            {"two_agents": ("review_agent", "file_agent")},
        ),
    ]
    seen_paths: list[tuple[str, ...]] = []

    def executor(task, _architecture, path):
        seen_paths.append(path)
        return observation(
            task.task_id,
            path=path,
            delegation=len(path) * 3,
            communication=max(len(path) - 1, 0) * 5,
        )

    result = run_replay(
        tasks,
        architecture,
        executor,
        historical_tools=HISTORICAL_TOOLS,
    )

    assert seen_paths == [(), ("review_agent",), ("review_agent", "file_agent")]
    assert result.aggregate.agent_activations == 3
    assert result.aggregate.delegation_count == 1
    assert result.aggregate.inter_agent_handoffs == 1
    assert result.aggregate.delegation_tokens == 9
    assert result.aggregate.inter_agent_communication_tokens == 5
    assert result.aggregate.orchestration_tokens == 14


def test_historical_and_observed_capability_coverage_are_separate() -> None:
    architecture = build_architecture_manifest(manifest_raw()).architectures[1]
    result = replay_recorded_observations(
        [ReplayTask("task")],
        architecture,
        [observation("task", covered=False)],
        historical_tools=HISTORICAL_TOOLS,
    )

    assert historical_tool_capability_coverage(architecture, HISTORICAL_TOOLS) == 1.0
    assert result.aggregate.historical_tool_capability_coverage_rate == 1.0
    assert result.aggregate.observed_replay_capability_coverage_rate == 0.0


def test_strict_gate_uses_historical_coverage_quality_and_context() -> None:
    baseline_architecture = build_architecture_manifest(manifest_raw()).architectures[0]
    candidate_architecture = build_architecture_manifest(manifest_raw()).architectures[
        1
    ]
    tasks = [ReplayTask("task")]
    baseline = replay_recorded_observations(
        tasks,
        baseline_architecture,
        [observation("task", context=100)],
        historical_tools=HISTORICAL_TOOLS,
    )
    candidate = replay_recorded_observations(
        tasks,
        candidate_architecture,
        [observation("task", context=80)],
        historical_tools=HISTORICAL_TOOLS,
    )

    comparison = compare_to_benchmark(baseline, candidate)

    assert comparison.passed is True
    assert comparison.historical_capability_coverage_preserved is True
    assert comparison.observed_replay_capability_coverage_preserved is True
    assert comparison.quality_preserved is True
    assert comparison.context_tokens_reduced is True


def test_report_evaluates_every_manifest_architecture_without_hard_coded_ids() -> None:
    raw_manifest = manifest_raw()
    bundle = {
        "tasks": [
            {
                "task_id": "task",
                "activation_paths": {"two_agents": ["review_agent", "file_agent"]},
            }
        ],
        "observations": {
            BASELINE_ARCHITECTURE_ID: [
                {
                    "task_id": "task",
                    "task_success": True,
                    "observed_replay_capability_covered": True,
                    "quality_score": 1.0,
                    "agent_activation_path": [],
                    "tool_call_failures": 0,
                    "routing_failure": False,
                    "missed_agent_activation": False,
                    "unnecessary_agent_activation": False,
                    "total_input_tokens": 20,
                    "tool_definition_context_tokens": 100,
                    "delegation_tokens": 0,
                    "inter_agent_communication_tokens": 0,
                    "turns": 2,
                    "wall_clock_seconds": 0.5,
                }
            ],
            "two_agents": [
                {
                    "task_id": "task",
                    "task_success": True,
                    "observed_replay_capability_covered": True,
                    "quality_score": 1.0,
                    "agent_activation_path": ["review_agent", "file_agent"],
                    "tool_call_failures": 0,
                    "routing_failure": False,
                    "missed_agent_activation": False,
                    "unnecessary_agent_activation": False,
                    "total_input_tokens": 20,
                    "tool_definition_context_tokens": 80,
                    "delegation_tokens": 6,
                    "inter_agent_communication_tokens": 5,
                    "turns": 2,
                    "wall_clock_seconds": 0.5,
                }
            ],
        },
    }
    benchmark = {"pruned_flat_baseline": {"tools_retained": ["exec"]}}

    report = build_report(bundle, benchmark, raw_manifest)

    assert set(report["architectures"]) == {BASELINE_ARCHITECTURE_ID, "two_agents"}
    assert set(report["comparisons"]) == {"two_agents"}
    assert report["architectures"]["two_agents"]["inter_agent_handoffs"] == 1
    assert report["architectures"]["two_agents"]["orchestration_tokens"] == 11


def test_report_rejects_baseline_drift_against_analysis_artifact() -> None:
    with pytest.raises(ValueError, match="does not match manifest"):
        build_report(
            {"tasks": [], "observations": {}},
            {"pruned_flat_baseline": {"tools_retained": ["different_tool"]}},
            manifest_raw(),
        )


def test_report_rejects_incomplete_operational_measurements() -> None:
    raw_manifest = manifest_raw()
    with pytest.raises(ValueError, match="missing: tool_call_failures"):
        build_report(
            {
                "tasks": [{"task_id": "task"}],
                "observations": {
                    architecture_id: [
                        {
                            "task_id": "task",
                            "task_success": True,
                            "observed_replay_capability_covered": True,
                            "quality_score": 1.0,
                        }
                    ]
                    for architecture_id in (BASELINE_ARCHITECTURE_ID, "two_agents")
                },
            },
            {"pruned_flat_baseline": {"tools_retained": ["exec"]}},
            raw_manifest,
        )


def test_report_rejects_malformed_actual_activation_path() -> None:
    raw_manifest = manifest_raw()
    with pytest.raises(ValueError, match="activation path must be a list"):
        build_report(
            {
                "tasks": [{"task_id": "task"}],
                "observations": {
                    architecture_id: [
                        {
                            "task_id": "task",
                            "task_success": True,
                            "observed_replay_capability_covered": True,
                            "quality_score": 1.0,
                            "agent_activation_path": "review_agent",
                            "tool_call_failures": 0,
                            "routing_failure": False,
                            "missed_agent_activation": False,
                            "unnecessary_agent_activation": False,
                            "total_input_tokens": 0,
                            "tool_definition_context_tokens": 0,
                            "delegation_tokens": 0,
                            "inter_agent_communication_tokens": 0,
                            "turns": 0,
                            "wall_clock_seconds": 0.0,
                        }
                    ]
                    for architecture_id in (BASELINE_ARCHITECTURE_ID, "two_agents")
                },
            },
            {"pruned_flat_baseline": {"tools_retained": ["exec"]}},
            raw_manifest,
        )
