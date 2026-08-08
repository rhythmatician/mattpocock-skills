from __future__ import annotations

from types import SimpleNamespace

from optimize_agent_tools.partition_search import search_partitions
from optimize_agent_tools.replay_harness import (
    FROZEN_PRUNED_FLAT_BASELINE_TOOLS,
    build_architecture_manifest,
)
from optimize_agent_tools.telemetry_ingestion import Session


def _stats() -> dict[str, SimpleNamespace]:
    return {
        name: SimpleNamespace(definition_tokens=cost)
        for name, cost in {
            "a": 10,
            "b": 20,
            "c": 30,
            "dep_a": 5,
            "shared": 7,
        }.items()
    }


def test_search_generates_closed_manifest_candidates_and_metrics() -> None:
    sessions = [
        Session("one", "codex", ["a", "b"], {"a", "b"}),
        Session("two", "codex", ["c"], {"c"}),
        Session("three", "codex", ["a", "c"], {"a", "c"}),
    ]

    result = search_partitions(
        sessions=sessions,
        stats=_stats(),
        required_tools={"a", "b", "c"},
        global_tools={"shared"},
        dependencies={"a": {"dep_a"}},
        max_agents=2,
        communication_tokens_per_handoff=4,
        delegation_tokens_per_activation=2,
        baseline_tools={"a", "b", "c", "dep_a", "shared"},
    )

    assert {candidate.agent_count for candidate in result.all_candidates} == {1, 2}
    assert result.manifest["baseline_architecture_id"] == "pruned_flat_baseline"
    assert result.manifest["historical_tool_capability_tools"] == [
        "a",
        "b",
        "c",
        "dep_a",
    ]

    for architecture in result.manifest["architectures"]:
        if architecture["architecture_id"] == "pruned_flat_baseline":
            continue
        assigned = set(architecture["parent_tools"])
        assigned.update(
            tool
            for tools in architecture["agents"].values()
            for tool in tools
        )
        assert set(result.manifest["historical_tool_capability_tools"]) <= assigned
        assert architecture["parent_tools"] == ["shared"]
        for tools in architecture["agents"].values():
            if "a" in tools:
                assert "dep_a" in tools

    candidate = next(
        candidate
        for candidate in result.all_candidates
        if candidate.agent_count == 2
        and any(set(agent) == {"a", "b", "dep_a"} for agent in candidate.agent_tools)
    )
    assert candidate.agent_definition_costs == (35.0, 30.0)
    assert candidate.historical_activation_rates == (2 / 3, 2 / 3)
    assert candidate.cross_agent_session_frequency == 1 / 3
    assert candidate.expected_handoff_count == 1 / 3
    assert candidate.expected_context_cost_before_communication == 100 / 3
    assert candidate.expected_context_cost_after_communication == 142 / 3


def test_search_retains_only_non_dominated_candidates_in_frontier() -> None:
    sessions = [
        Session("one", "codex", ["a"], {"a"}),
        Session("two", "codex", ["b"], {"b"}),
    ]
    result = search_partitions(
        sessions=sessions,
        stats={
            "a": SimpleNamespace(definition_tokens=10),
            "b": SimpleNamespace(definition_tokens=10),
        },
        required_tools={"a", "b"},
        max_agents=2,
        baseline_tools={"a", "b"},
    )

    assert result.pareto_candidates
    assert all(candidate.is_pareto_optimal for candidate in result.pareto_candidates)
    assert {
        candidate.architecture_id for candidate in result.pareto_candidates
    } <= {candidate.architecture_id for candidate in result.all_candidates}
    assert len({candidate.architecture_id for candidate in result.pareto_candidates}) == len(
        result.pareto_candidates
    )


def test_generated_manifest_is_consumable_by_replay_harness() -> None:
    result = search_partitions(
        sessions=[Session("one", "codex", ["exec"], {"exec"})],
        stats={"exec": SimpleNamespace(definition_tokens=10)},
        required_tools={"exec"},
        max_agents=1,
    )

    manifest = build_architecture_manifest(result.manifest)
    assert manifest.baseline.parent_tools == FROZEN_PRUNED_FLAT_BASELINE_TOOLS


def test_global_tool_dependencies_stay_on_parent_surface() -> None:
    result = search_partitions(
        sessions=[Session("one", "codex", ["shared"], {"shared"})],
        stats={
            "shared": SimpleNamespace(definition_tokens=10),
            "shared_dep": SimpleNamespace(definition_tokens=5),
            "other": SimpleNamespace(definition_tokens=20),
        },
        required_tools={"shared", "other"},
        global_tools={"shared"},
        dependencies={"shared": {"shared_dep"}},
        max_agents=1,
        baseline_tools={"shared", "shared_dep", "other"},
    )

    candidate = next(
        candidate
        for candidate in result.all_candidates
        if candidate.agent_count == 1
    )
    assert candidate.parent_tools == ("shared", "shared_dep")
    assert candidate.agent_tools == (("other",),)


def test_all_global_surface_still_emits_a_k_one_candidate() -> None:
    result = search_partitions(
        sessions=[Session("one", "codex", ["shared"], {"shared"})],
        stats={"shared": SimpleNamespace(definition_tokens=10)},
        required_tools={"shared"},
        global_tools={"shared"},
        max_agents=2,
        baseline_tools={"shared"},
    )

    assert [candidate.agent_count for candidate in result.all_candidates] == [1]
    assert result.all_candidates[0].agent_tools == ((),)
    assert result.manifest["architectures"][0]["architecture_id"] == (
        "pruned_flat_baseline"
    )
