from __future__ import annotations

from types import SimpleNamespace

from optimize_agent_tools.analysis_pipeline import analyze
from optimize_agent_tools.partition_search import search_partitions
from optimize_agent_tools.replay_harness import (
    build_architecture_manifest,
)
from optimize_agent_tools.telemetry_ingestion import Session
from optimize_agent_tools.tool_definition_registry import DefinitionRecord


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


def _definition(name: str, tokens: int) -> DefinitionRecord:
    return DefinitionRecord(
        name,
        "codex",
        "test",
        name,
        None,
        None,
        tokens * 4,
        tokens,
        "test",
        "explicit",
        "recovered_definition",
    )


def test_normal_analysis_workflow_includes_generic_specialist_recommendation() -> None:
    sessions = [
        Session("one", "codex", ["a", "b"], {"a", "b"}),
        Session("two", "codex", ["a"], {"a", "b"}),
    ]
    definitions = {
        name: _definition(name, tokens) for name, tokens in {"a": 10, "b": 20}.items()
    }

    report = analyze(
        sessions,
        definitions,
        {},
        explicit_path=None,
        definition_roots=[],
        min_tool_sessions=1,
        similarity_threshold=0.35,
        global_usage_threshold=1.0,
        min_cluster_size=2,
        min_cluster_sessions=1,
        delegation_overhead_tokens=0,
        max_agents=2,
    )

    recommendation = report["specialist_recommendation"]
    assert recommendation["action"] == "inspect_pareto_architectures"
    assert recommendation["pareto_candidate_ids"]
    assert report["architecture_manifest"]["baseline_architecture_id"] == (
        "pruned_flat_baseline"
    )
    assert report["partition_search"]["search"]["max_agents"] == 2


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
            tool for tools in architecture["agents"].values() for tool in tools
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
    assert candidate.expected_delegation_count == 1 / 3
    assert candidate.expected_context_cost_before_communication == 100 / 3
    assert candidate.expected_context_cost_after_communication == 136 / 3
    assert candidate.dependency_closed is True


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
    )

    assert result.pareto_candidates
    assert all(candidate.is_pareto_optimal for candidate in result.pareto_candidates)
    assert {candidate.architecture_id for candidate in result.pareto_candidates} <= {
        candidate.architecture_id for candidate in result.all_candidates
    }
    assert len(
        {candidate.architecture_id for candidate in result.pareto_candidates}
    ) == len(result.pareto_candidates)


def test_generated_manifest_uses_the_run_baseline() -> None:
    result = search_partitions(
        sessions=[Session("one", "codex", ["exec"], {"exec"})],
        stats={"exec": SimpleNamespace(definition_tokens=10)},
        required_tools={"exec"},
        max_agents=1,
    )

    manifest = build_architecture_manifest(result.manifest)
    assert manifest.baseline.parent_tools == frozenset({"exec"})


def test_missing_observed_exposure_is_not_treated_as_zero_context() -> None:
    result = search_partitions(
        sessions=[Session("one", "codex", ["a"], exposure_source="not_observed")],
        stats={"a": SimpleNamespace(definition_tokens=10)},
        required_tools={"a"},
        max_agents=1,
    )

    candidate = result.all_candidates[0]
    assert candidate.expected_context_cost_before_communication is None
    assert candidate.expected_context_cost_after_communication is None
    assert candidate.is_cost_complete is False


def test_delegation_excludes_initial_handling_agent_and_keeps_handoffs_separate() -> (
    None
):
    result = search_partitions(
        sessions=[Session("one", "codex", ["a", "b"], {"a", "b"})],
        stats=_stats(),
        required_tools={"a", "b"},
        max_agents=2,
        communication_tokens_per_handoff=4,
        delegation_tokens_per_activation=2,
    )

    candidate = next(
        candidate for candidate in result.all_candidates if candidate.agent_count == 2
    )
    assert candidate.expected_delegation_count == 1.0
    assert candidate.expected_handoff_count == 1.0
    assert candidate.expected_context_cost_after_communication == 36.0


def test_search_reports_pareto_scope_for_exhaustive_and_bounded_search() -> None:
    sessions = [Session("one", "codex", ["a", "b"], {"a", "b"})]
    exhaustive = search_partitions(
        sessions=sessions,
        stats=_stats(),
        required_tools={"a", "b"},
        max_agents=2,
    )
    bounded = search_partitions(
        sessions=sessions,
        stats=_stats(),
        required_tools={"a", "b"},
        max_agents=2,
        max_exhaustive_units=1,
    )

    assert exhaustive.pareto_scope == "global"
    assert exhaustive.search_strategy == "exhaustive"
    assert exhaustive.report["search"]["pareto_scope"] == "global"
    assert all(
        candidate.pareto_scope == "global" for candidate in exhaustive.pareto_candidates
    )
    assert bounded.pareto_scope == "evaluated_subset"
    assert bounded.search_strategy == "bounded"
    assert all(
        candidate.pareto_scope == "evaluated_subset"
        for candidate in bounded.pareto_candidates
    )


def test_all_runtime_exposure_model_can_evaluate_missing_direct_exposure() -> None:
    result = search_partitions(
        sessions=[Session("one", "codex", ["a"], exposure_source="not_observed")],
        stats={"a": SimpleNamespace(definition_tokens=10)},
        required_tools={"a"},
        max_agents=1,
        exposure_model="all_runtime_tools",
    )

    candidate = result.all_candidates[0]
    assert candidate.expected_context_cost_before_communication == 10.0
    assert candidate.expected_context_cost_after_communication == 10.0
    assert candidate.is_cost_complete is True


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
    )

    candidate = next(
        candidate for candidate in result.all_candidates if candidate.agent_count == 1
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
    )

    assert [candidate.agent_count for candidate in result.all_candidates] == [1]
    assert result.all_candidates[0].agent_tools == ((),)
    assert result.manifest["architectures"][0]["architecture_id"] == (
        "pruned_flat_baseline"
    )
