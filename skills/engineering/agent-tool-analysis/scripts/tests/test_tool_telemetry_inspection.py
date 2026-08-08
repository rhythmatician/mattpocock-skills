from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any

import pytest
from tool_definition_registry import DefinitionRecord
from telemetry_ingestion import (
    DynamicToolGroup,
    Session,
    extract_codex_calls,
    extract_codex_dynamic_tool_groups,
    extract_codex_exposures,
    extract_codex_provider_metadata,
    find_raw_tool_call,
    normalize_tool_name,
)
from exposure_models import baseline_exposure_states, provider_availability_diagnostics
from cost_evaluation import cluster_exposure_economics
from clustering import (
    build_session_index,
    cluster_boundary_metrics,
    tool_boundary_metrics,
)
from exposure_reporting import build_exposure_matrix, exposure_matrix_summary

ROOT = Path(__file__).parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _load_module(name: str, filename: str) -> Any:
    path = ROOT / "tmp" / filename
    if not path.exists():
        path = ROOT / filename
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


pipeline = _load_module("analysis_pipeline", "analysis_pipeline.py")
sys.modules["analysis_pipeline"] = pipeline
inspector = _load_module("inspect_codex_telemetry", "inspect_codex_telemetry.py")


def make_definition(
    name: str,
    serialized_chars: int | None,
    estimated_tokens: int | None,
    runtime: str = "codex",
) -> DefinitionRecord:
    return DefinitionRecord(
        name,
        runtime,
        "telemetry",
        name,
        None,
        None,
        serialized_chars,
        estimated_tokens,
        f"telemetry:{runtime}",
        "direct_telemetry",
        "recovered_definition",
    )


def test_codex_payload_function_call_name_is_joined_to_catalog() -> None:
    event = {
        "type": "response_item",
        "payload": {
            "type": "function_call",
            "name": "exec",
            "arguments": "not emitted by the inspector",
        },
    }

    assert find_raw_tool_call(event) == "exec"


def test_codex_extractor_returns_native_and_invocation_calls() -> None:
    event = {
        "type": "response_item",
        "payload": {
            "type": "mcp_tool_call",
            "name": "exec",
            "invocation": {"tool": "github.fetch_file"},
        },
    }

    assert extract_codex_calls(event) == ["exec", "github.fetch_file"]
    assert (
        find_raw_tool_call(
            {
                "payload": {
                    "type": "mcp_tool_call_end",
                    "invocation": {"tool": "github.fetch_file"},
                }
            }
        )
        == "github.fetch_file"
    )


def test_inspector_reports_calls_and_definitions_without_payload_values() -> None:
    events = [
        {
            "type": "response_item",
            "payload": {
                "type": "function_call",
                "name": "exec",
                "arguments": "secret command",
            },
        },
        {
            "type": "response_item",
            "payload": {
                "dynamic_tools": [
                    {
                        "name": "codex_app",
                        "tools": [
                            {
                                "name": "create_thread",
                                "description": "private description",
                                "inputSchema": {"type": "object"},
                            }
                        ],
                    }
                ]
            },
        },
    ]

    report = inspector.inspect_events(events)

    assert report["events_scanned"] == 2
    assert report["event_discriminator_paths"] == {
        "payload.type": [{"type": "function_call", "appearances": 1}],
        "type": [{"type": "response_item", "appearances": 2}],
    }
    assert report["candidates_by_tool"]["exec"] == [
        {"path": "payload.name", "role": "call", "appearances": 1}
    ]
    assert report["candidates_by_tool"]["create_thread"] == [
        {
            "path": "payload.dynamic_tools[].tools[].name",
            "role": "definition",
            "appearances": 1,
        }
    ]
    serialized = str(report)
    assert "secret command" not in serialized
    assert "private description" not in serialized


def test_inspector_call_counts_match_optimizer_call_extraction() -> None:
    events = [
        {
            "type": "response_item",
            "payload": {
                "type": "function_call",
                "name": "exec",
            },
        },
        {
            "type": "event_msg",
            "payload": {
                "type": "mcp_tool_call_end",
                "invocation": {"tool": "github.fetch_issue"},
            },
        },
    ]

    inspection = inspector.inspect_events(events)
    inspector_calls = {
        name: sum(
            occurrence["appearances"]
            for occurrence in occurrences
            if occurrence["role"] == "call"
        )
        for name, occurrences in inspection["candidates_by_tool"].items()
    }
    optimizer_calls = {}
    for event in events:
        for raw_name in extract_codex_calls(event):
            name = normalize_tool_name(raw_name)
            assert name is not None
            optimizer_calls[name] = optimizer_calls.get(name, 0) + 1

    assert inspector_calls == optimizer_calls


def test_cost_coverage_separates_catalog_and_usage_weighted_rates() -> None:
    sessions = [Session("one", "codex", ["used", "unknown"])]
    definitions = {
        "catalog_only": make_definition("catalog_only", 40, 10),
        "used": make_definition("used", 20, 5),
    }

    stats = pipeline.build_stats(sessions, definitions, {})
    coverage = pipeline.expected_known_token_cost(
        sessions=sessions,
        stats=stats,
        global_tools=set(),
        candidate_agents=[],
        delegation_overhead_tokens=0,
    )["known_cost_coverage"]

    assert coverage["catalog_coverage_rate"] == 2 / 3
    assert coverage["observed_tools_with_known_cost"] == 1
    assert coverage["observed_tools_total"] == 2
    assert coverage["observed_tool_coverage_rate"] == 0.5
    assert coverage["calls_with_known_cost"] == 1
    assert coverage["total_calls"] == 2
    assert coverage["usage_weighted_coverage_rate"] == 0.5


def test_codex_exposure_extractor_uses_dynamic_tool_definitions_only() -> None:
    event = {
        "type": "session_meta",
        "payload": {
            "dynamic_tools": [
                {
                    "name": "github",
                    "tools": [
                        {"name": "github.fetch_issue", "description": "x"},
                        {"name": "github.fetch_pr", "inputSchema": {}},
                    ],
                }
            ]
        },
    }

    assert extract_codex_exposures(event) == {
        "github.fetch_issue",
        "github.fetch_pr",
    }
    assert (
        extract_codex_exposures(
            {"payload": {"type": "function_call", "name": "exec"}}
        )
        == set()
    )


def test_codex_provider_metadata_requires_named_dynamic_tool_group() -> None:
    event = {
        "payload": {
            "dynamic_tools": [
                {
                    "name": "github",
                    "tools": [
                        {"name": "github.fetch_issue"},
                        {"name": "github.fetch_pr"},
                    ],
                },
                {"tools": [{"name": "unscoped.tool"}]},
            ]
        }
    }

    providers, provider_tools = extract_codex_provider_metadata(event)

    assert providers == {"github"}
    assert provider_tools == {
        "github": {"github.fetch_issue", "github.fetch_pr"}
    }


def test_dynamic_tool_group_inventory_is_structural_and_privacy_safe() -> None:
    event = {
        "payload": {
            "dynamic_tools": [
                {
                    "type": "app",
                    "name": "codex_app",
                    "description": "private provider description",
                    "tools": [
                        {
                            "name": "create_thread",
                            "description": "private tool description",
                            "inputSchema": {"secret": "schema value"},
                        }
                    ],
                }
            ],
            "messages": ["private prompt"],
        }
    }

    groups = extract_codex_dynamic_tool_groups(event)

    assert groups == [
        DynamicToolGroup(
            path="payload.dynamic_tools",
            group_index=0,
            group_keys=("description", "name", "tools", "type"),
            provider=None,
            name="codex_app",
            identifier=None,
            tool_count=1,
            raw_tool_names=("create_thread",),
            normalized_tool_names=("create_thread",),
        )
    ]
    assert "private" not in str(groups)
    assert "schema value" not in str(groups)


def test_dynamic_tool_group_inventory_finds_nested_structures() -> None:
    event = {
        "payload": {
            "wrapper": {
                "dynamic_tools": [
                    {"id": "nested_app", "tools": [{"name": "nested.tool"}]}
                ]
            }
        }
    }

    groups = extract_codex_dynamic_tool_groups(event)

    assert len(groups) == 1
    assert groups[0].path == "payload.wrapper.dynamic_tools"
    assert groups[0].identifier == "nested_app"
    assert groups[0].normalized_tool_names == ("nested.tool",)


def test_provider_diagnostics_never_treat_github_calls_as_availability() -> None:
    sessions = [
        Session(
            "advertised",
            "codex",
            ["create_thread"],
            {"create_thread"},
            provider_availability={"codex_app"},
            provider_tools={"codex_app": {"create_thread"}},
            dynamic_tool_groups=[
                DynamicToolGroup(
                    path="payload.dynamic_tools",
                    group_index=0,
                    group_keys=("name", "tools", "type"),
                    provider=None,
                    name="codex_app",
                    identifier=None,
                    tool_count=1,
                    raw_tool_names=("create_thread",),
                    normalized_tool_names=("create_thread",),
                )
            ],
        ),
        Session("called-only", "codex", ["github.fetch_issue"]),
    ]

    diagnostics = provider_availability_diagnostics(sessions)

    assert diagnostics["provider_groups_observed"] == [
        {
            "provider": "codex_app",
            "group_count": 1,
            "session_count": 1,
            "sessions": ["advertised"],
            "tools_advertised": ["create_thread"],
        }
    ]
    assert diagnostics["runtime_called_tools_mapped_to_advertised_definitions"] == [
        {
            "runtime_tool": "create_thread",
            "advertised_tool": "create_thread",
            "provider": "codex_app",
            "match_type": "exact_name",
        }
    ]
    assert diagnostics["unmatched_runtime_tools"] == ["github.fetch_issue"]
    assert diagnostics["unmatched_advertised_tools"] == []
    assert diagnostics["github"] == {
        "sessions_with_github_like_provider_evidence": 0,
        "advertised_github_like_tools": [],
        "runtime_github_tools": ["github.fetch_issue"],
        "exact_name_matches": [],
        "normalized_or_alias_matches": [],
        "unresolved_mappings": ["github.fetch_issue"],
    }

    states = baseline_exposure_states(sessions, "provider_scoped")
    assert states["called-only"].inferred_baseline_exposure == frozenset()


def test_exposure_matrix_does_not_turn_usage_into_exposure() -> None:
    sessions = [
        Session(
            "one",
            "codex",
            ["used"],
            exposed_tools=set(),
        )
    ]
    definitions = {"used": make_definition("used", 40, 10)}
    stats = pipeline.build_stats(sessions, definitions, {})

    row = build_exposure_matrix(sessions, stats)[0]
    assert row["called"] is True
    assert row["exposed"] is False
    assert row["exposure_source"] == "not_observed"
    assert stats["used"].sessions_called == 1
    assert stats["used"].call_given_exposed is None
    assert (
        pipeline.exposure_consistency(sessions)["called_tools_without_direct_exposure"]
        == 1
    )


def test_definition_tokens_account_for_exposed_but_unused_sessions() -> None:
    sessions = [
        Session("used", "codex", ["tool"], {"tool"}),
        Session("unused", "codex", [], {"tool"}),
    ]
    definitions = {"tool": make_definition("tool", 40, 10)}

    stat = pipeline.build_stats(sessions, definitions, {})["tool"]

    assert stat.sessions_exposed == 2
    assert stat.sessions_called == 1
    assert stat.call_given_exposed == 0.5
    assert stat.expected_unused_tokens_per_session == 5


def test_boundary_metrics_measure_internal_and_external_affinity() -> None:
    pairs = {
        ("a", "b"): {"affinity": 0.8},
        ("a", "c"): {"affinity": 0.3},
        ("b", "c"): {"affinity": 0.2},
    }
    metrics = tool_boundary_metrics("a", {"a", "b"}, pairs, ["a", "b", "c"])

    assert metrics == {
        "mean_internal_affinity": 0.8,
        "best_external_affinity": 0.3,
        "boundary_margin": 0.5,
    }


def test_cluster_boundary_metrics_reports_exclusive_and_overlapping_coverage() -> None:
    sessions = [
        Session("one", "codex", ["a"], {"a"}),
        Session("two", "codex", ["a", "c"], {"a", "c"}),
        Session("three", "codex", ["c"], {"c"}),
    ]
    clusters = [{"a", "b"}, {"c"}]
    session_index = build_session_index(sessions)
    pairs = {
        ("a", "b"): {"affinity": 0.8},
        ("a", "c"): {"affinity": 0.3},
        ("b", "c"): {"affinity": 0.2},
    }

    metrics = cluster_boundary_metrics(
        clusters[0], clusters, pairs, ["a", "b", "c"], session_index, sessions
    )

    assert metrics["internal_affinity"] == 0.8
    assert metrics["max_external_affinity"] == 0.3
    assert metrics["mean_boundary_margin"] == 0.55
    assert metrics["session_coverage"] == 2 / 3
    assert metrics["exclusive_session_coverage"] == 1 / 3
    assert metrics["overlapping_session_coverage"] == 1 / 3


def test_session_population_summary_keeps_call_and_exposure_denominators_separate() -> None:
    sessions = [
        Session("call", "codex", ["exec"], set()),
        Session("both", "codex", ["exec"], {"exec"}),
        Session("exposure", "codex", [], {"create_thread"}),
    ]

    assert pipeline.session_population_summary(sessions) == {
        "sessions_total": 3,
        "sessions_with_calls": 2,
        "sessions_with_direct_exposure": 2,
        "sessions_with_calls_and_exposure": 1,
        "sessions_with_calls_without_exposure": 1,
        "sessions_with_exposure_without_calls": 1,
    }


def test_usage_rate_uses_call_bearing_sessions_only() -> None:
    sessions = [
        Session("call", "codex", ["exec"]),
        Session("call-two", "codex", ["other"]),
        Session("exposure-only", "codex", [], {"exec"}),
    ]

    stats = pipeline.build_stats(sessions, {}, {})

    assert stats["exec"].usage_rate == 1 / 2
    assert stats["exec"].sessions_called == 1


def test_registry_precedence_preserves_unresolved_tools() -> None:
    from tool_definition_registry import (
        DefinitionRecord,
        DefinitionRegistry,
        MappingDefinitionProvider,
    )

    telemetry = DefinitionRecord(
        "exec", "codex", "telemetry", "exec", "telemetry", {}, 40, 10,
        "telemetry:codex", "direct_telemetry", "recovered_definition",
    )
    manifest = DefinitionRecord(
        "exec", "codex", "runtime_manifest", "exec", "manifest", {}, 80, 20,
        "manifest.json", "direct_manifest", "advertised_definition",
    )
    explicit = DefinitionRecord(
        "exec", "any", "explicit", "exec", None, None, None, 30,
        "explicit.json", "explicit", "user_supplied_cost",
    )
    registry = DefinitionRegistry(
        [
            MappingDefinitionProvider([explicit], precedence=300),
            MappingDefinitionProvider([telemetry], precedence=200),
            MappingDefinitionProvider([manifest], precedence=100),
        ]
    )

    assert registry.resolve("exec") == explicit
    assert registry.resolve("missing") is None


def test_definition_record_preserves_unknown_estimated_tokens() -> None:
    definition = DefinitionRecord(
            "unknown",
            "codex",
            "runtime_manifest",
            "unknown",
            None,
            None,
            None,
            None,
            "manifest.json",
            "unresolved",
            "unresolved",
        )

    assert definition.estimated_tokens is None
    assert definition.serialized_chars is None


def test_unresolved_cost_estimates_are_separate_empirical_quantiles() -> None:
    sessions = [
        Session("one", "codex", ["resolved_low", "unknown"]),
        Session("two", "codex", ["resolved_high"], {"unknown"}),
    ]
    definitions = {
        "resolved_low": make_definition("resolved_low", 40, 10),
        "resolved_high": make_definition("resolved_high", 80, 20),
        "unknown": make_definition("unknown", None, None, "unknown"),
    }

    stats = pipeline.build_stats(sessions, definitions, {})

    unknown = stats["unknown"]
    assert unknown.definition_tokens is None
    assert (unknown.estimated_cost_low, unknown.estimated_cost_mid, unknown.estimated_cost_high) == (
        12.5,
        15.0,
        17.5,
    )
    assert unknown.estimation_basis == pipeline.ESTIMATION_BASIS
    assert unknown.estimation_confidence == "low"
    assert unknown.estimated_cost_low <= unknown.estimated_cost_mid
    assert unknown.estimated_cost_mid <= unknown.estimated_cost_high

    for name, expected in (("resolved_low", 10), ("resolved_high", 20)):
        assert stats[name].definition_tokens == expected
        assert stats[name].estimated_cost_low is None
        assert stats[name].estimated_cost_mid is None
        assert stats[name].estimated_cost_high is None


def test_relative_reduction_calculation_is_correct() -> None:
    assert pipeline.reduction_metrics(100, 75) == {
        "baseline_tokens_per_session": 100,
        "proposed_tokens_per_session": 75,
        "absolute_token_reduction_per_session": 25,
        "relative_token_reduction": 0.25,
    }


def test_cost_scenarios_measure_raw_cluster_reduction() -> None:
    sessions = [
        Session("one", "codex", ["resolved", "unknown"], {"resolved", "unknown"}),
        Session("two", "codex", ["resolved"], {"resolved", "unknown"}),
    ]
    definitions = {
        "resolved": make_definition("resolved", 40, 10),
        "unknown": make_definition("unknown", None, None, "unknown"),
    }
    stats = pipeline.build_stats(sessions, definitions, {})
    agents = [{"candidate_id": "cluster_01", "tools": ["unknown"]}]

    scenarios = pipeline.expected_token_cost_scenarios(
        sessions=sessions,
        stats=stats,
        global_tools=set(),
        candidate_agents=agents,
        delegation_overhead_tokens=0,
    )

    assert pipeline.scenario_cost(stats["resolved"], "low") == 10.0
    assert pipeline.scenario_cost(stats["resolved"], "mid") == 10.0
    assert pipeline.scenario_cost(stats["resolved"], "high") == 10.0
    assert scenarios["low"] == {
        "baseline_tokens_per_session": 20.0,
        "proposed_tokens_per_session": 15.0,
        "absolute_token_reduction_per_session": 5.0,
        "relative_token_reduction": 0.25,
    }
    assert scenarios["low"]["baseline_tokens_per_session"] <= scenarios["high"]["baseline_tokens_per_session"]
    assert scenarios["low"]["proposed_tokens_per_session"] <= scenarios["high"]["proposed_tokens_per_session"]


def _variant_test_stats() -> dict[str, pipeline.ToolStat]:
    sessions = [
        Session("one", "codex", ["a", "b"], {"a", "b", "c", "d"}),
        Session("two", "codex", ["c"], {"a", "b", "c", "d"}),
    ]
    definitions = {
        name: make_definition(name, tokens * 4, tokens)
        for name, tokens in {"a": 10, "b": 20, "c": 30, "d": 40}.items()
    }
    return pipeline.build_stats(sessions, definitions, {})


def test_independent_variant_with_overhead_reports_negative_reduction() -> None:
    sessions = [
        Session("one", "codex", ["a"], {"a", "b"}),
        Session("two", "codex", ["b"], {"a", "b"}),
    ]
    definitions = {
        name: make_definition(name, tokens * 4, tokens)
        for name, tokens in {"a": 10, "b": 10}.items()
    }
    stats = pipeline.build_stats(sessions, definitions, {})

    result = pipeline.evaluate_architecture_variants(
        sessions=sessions,
        stats=stats,
        global_tools=set(),
        candidate_agents=[{"candidate_id": "cluster_01", "tools": ["a", "b"]}],
        boundary_by_tool={
            "a": {"boundary_margin": 1.0},
            "b": {"boundary_margin": 1.0},
        },
        delegation_overhead_tokens=5,
    )

    raw = next(item for item in result if item["variant_id"] == "cluster_01")
    assert raw["scenarios"]["mid"]["absolute_token_reduction_per_session"] == -5
    assert raw["scenarios"]["mid"]["relative_token_reduction"] < 0


def test_independent_variant_does_not_move_tools_from_other_clusters() -> None:
    sessions = [Session("one", "codex", ["a", "c"], {"a", "c"})]
    definitions = {
        name: make_definition(name, tokens * 4, tokens)
        for name, tokens in {"a": 10, "b": 20, "c": 30}.items()
    }
    stats = pipeline.build_stats(sessions, definitions, {})

    result = pipeline.evaluate_architecture_variants(
        sessions=sessions,
        stats=stats,
        global_tools=set(),
        candidate_agents=[
            {"candidate_id": "cluster_01", "tools": ["a", "b"]},
            {"candidate_id": "cluster_02", "tools": ["c"]},
        ],
        boundary_by_tool={},
        delegation_overhead_tokens=0,
    )

    raw = next(item for item in result if item["variant_id"] == "cluster_01")
    assert raw["scenarios"]["mid"]["proposed_tokens_per_session"] == 60
    assert raw["specialist_tools"] == ["a", "b"]


def test_boundary_pruning_keeps_pruned_tools_on_parent() -> None:
    sessions = [
        Session("one", "codex", ["a", "b"], {"a", "b", "c"}),
        Session("two", "codex", ["c"], {"a", "b", "c"}),
    ]
    definitions = {
        name: make_definition(name, tokens * 4, tokens)
        for name, tokens in {"a": 10, "b": 20, "c": 30}.items()
    }
    stats = pipeline.build_stats(sessions, definitions, {})

    result = pipeline.evaluate_architecture_variants(
        sessions=sessions,
        stats=stats,
        global_tools=set(),
        candidate_agents=[{"candidate_id": "cluster_01", "tools": ["a", "b", "c"]}],
        boundary_by_tool={
            "a": {"boundary_margin": 0.2},
            "b": {"boundary_margin": 0.1},
            "c": {"boundary_margin": 0.0},
        },
        delegation_overhead_tokens=0,
    )

    pruned = next(
        item for item in result if item["variant_id"] == "cluster_01_boundary_pruned"
    )
    assert pruned["specialist_tools"] == ["a", "b"]
    assert pruned["pruned_tools"] == ["c"]
    assert pruned["scenarios"]["mid"]["proposed_tokens_per_session"] == 45


def test_variants_preserve_historical_called_tool_coverage() -> None:
    sessions = [
        Session("one", "codex", ["a", "b", "c"], {"a", "b", "c"})
    ]
    definitions = {
        name: make_definition(name, tokens * 4, tokens)
        for name, tokens in {"a": 10, "b": 20, "c": 30}.items()
    }
    stats = pipeline.build_stats(sessions, definitions, {})

    result = pipeline.evaluate_architecture_variants(
        sessions=sessions,
        stats=stats,
        global_tools=set(),
        candidate_agents=[{"candidate_id": "cluster_01", "tools": ["a", "b"]}],
        boundary_by_tool={},
        delegation_overhead_tokens=0,
    )

    assert all(
        item["historical_called_tool_coverage_rate"] == 1.0 for item in result
    )


def test_cluster_one_subsets_are_exhaustive_and_keep_reference() -> None:
    sessions = [
        Session("a", "codex", ["a"]),
        Session("b", "codex", ["b"]),
        Session("c", "codex", ["c"]),
    ]
    definitions = {
        name: make_definition(name, tokens * 4, tokens)
        for name, tokens in {"a": 10, "b": 20, "c": 30}.items()
    }
    stats = pipeline.build_stats(sessions, definitions, {})
    pairs = {
        ("a", "b"): {"affinity": 0.8},
        ("a", "c"): {"affinity": 0.3},
        ("b", "c"): {"affinity": 0.2},
    }

    result = pipeline.evaluate_cluster_one_subsets(
        sessions=sessions,
        stats=stats,
        cluster_tools={"a", "b", "c"},
        pairs=pairs,
        all_clustered_tools={"a", "b", "c"},
        global_tools=set(),
        delegation_overhead_tokens=0,
        exposure_rates=(0.0, 0.25, 0.5, 1.0),
    )

    assert result is not None
    assert result["subset_count"] == 4
    assert {tuple(row["tools"]) for row in result["subsets"]} == {
        ("a", "b"),
        ("a", "c"),
        ("b", "c"),
        ("a", "b", "c"),
    }
    assert all(
        row["historical_called_tool_coverage_rate"] == 1.0
        for row in result["subsets"]
    )

    pair = next(row for row in result["subsets"] if row["tools"] == ["a", "b"])
    assert pair["activation_rate"] == 2 / 3
    assert pair["definition_tokens_low"] == 30
    assert pair["definition_tokens_mid"] == 30
    assert pair["definition_tokens_high"] == 30
    assert pair["break_even_exposure_rate_mid"] == 2 / 3
    assert pair["internal_affinity"] == 0.8
    assert pair["mean_boundary_margin"] == pytest.approx(0.55)
    assert pair["min_boundary_margin"] == 0.5
    assert pair["net_reduction_at_25%"] == -12.5
    assert pair["net_reduction_at_50%"] == -5
    assert pair["net_reduction_at_100%"] == 10

    reference = result["reference"]
    assert reference["tools"] == ["a", "b", "c"]
    assert reference["tool_count"] == 3
    assert reference["reference_cluster"] is True
    assert len(result["pareto_frontier"]) > 0
    assert set(result["best_subsets"]) == {
        "lowest_break_even_exposure_rate",
        "greatest_mid_case_savings_at_25_percent_exposure",
        "greatest_mid_case_savings_at_50_percent_exposure",
        "greatest_mid_case_savings_at_100_percent_exposure",
        "highest_internal_affinity_among_economically_viable_subsets",
    }


def test_subset_pareto_frontier_uses_all_three_economic_dimensions() -> None:
    rows = [
        {
            "tools": ["dominator"],
            "break_even_exposure_rate_mid": 0.2,
            "definition_tokens_mid": 10,
            "activation_rate": 0.1,
        },
        {
            "tools": ["dominated"],
            "break_even_exposure_rate_mid": 0.3,
            "definition_tokens_mid": 10,
            "activation_rate": 0.2,
        },
        {
            "tools": ["tradeoff"],
            "break_even_exposure_rate_mid": 0.1,
            "definition_tokens_mid": 20,
            "activation_rate": 0.1,
        },
    ]

    frontier = pipeline._pareto_frontier(rows)

    assert {tuple(row["tools"]) for row in frontier} == {
        ("dominator",),
        ("tradeoff",),
    }


def test_cluster_one_subset_retains_dependency_warnings() -> None:
    sessions = [
        Session("edit", "codex", ["apply_patch"]),
        Session("create", "codex", ["create_file"]),
        Session("test", "codex", ["execute/runTests"]),
    ]
    definitions = {
        name: make_definition(name, 40, 10)
        for name in ("apply_patch", "create_file", "execute/runTests")
    }
    stats = pipeline.build_stats(sessions, definitions, {})
    pairs = {("apply_patch", "create_file"): {"affinity": 0.5}}

    result = pipeline.evaluate_cluster_one_subsets(
        sessions=sessions,
        stats=stats,
        cluster_tools={"apply_patch", "create_file"},
        pairs=pairs,
        all_clustered_tools={"apply_patch", "create_file"},
        global_tools=set(),
        delegation_overhead_tokens=0,
        exposure_rates=(0.25, 0.5, 1.0),
    )

    assert result is not None
    assert result["reference"]["dependency_warnings"] == {
        "apply_patch": ["execute/runTests"]
    }


def test_pruned_flat_baseline_retains_used_tools_and_dependencies() -> None:
    sessions = [
        Session("used", "codex", ["apply_patch"]),
        Session("unused", "codex", [], {"unused"}),
    ]
    definitions = {
        name: make_definition(name, tokens * 4, tokens)
        for name, tokens in {
            "apply_patch": 10,
            "execute/runTests": 20,
            "create_file": 30,
            "unused": 40,
        }.items()
    }
    stats = pipeline.build_stats(sessions, definitions, {})

    baseline = pipeline.build_pruned_flat_baseline(
        sessions,
        stats,
        global_tools=set(),
    )

    assert baseline["tools_retained"] == [
        "apply_patch",
        "create_file",
        "execute/runTests",
    ]
    assert baseline["tools_removed"] == ["unused"]
    assert baseline["removed_definition_tokens"]["mid"] == 40
    assert baseline["historical_called_tool_coverage"] == 1.0
    assert baseline["dependency_preservation_warnings"] == []
    assert baseline["baseline_tokens_per_session_before_pruning"]["mid"] == 20
    assert baseline["baseline_tokens_per_session_after_pruning"]["mid"] == 0
    assert baseline["absolute_reduction"]["mid"] == 20
    assert baseline["relative_reduction"]["mid"] == 1.0


def test_pruned_flat_baseline_warns_for_unknown_required_dependency() -> None:
    sessions = [Session("used", "codex", ["apply_patch"])]
    definitions = {"apply_patch": make_definition("apply_patch", 40, 10)}
    stats = pipeline.build_stats(sessions, definitions, {})

    baseline = pipeline.build_pruned_flat_baseline(
        sessions,
        stats,
        global_tools=set(),
    )

    assert baseline["tools_retained"] == [
        "apply_patch",
        "create_file",
        "execute/runTests",
    ]
    assert baseline["dependency_preservation_warnings"] == [
        {
            "tool": "apply_patch",
            "missing_dependencies": ["create_file", "execute/runTests"],
        }
    ]


def test_architecture_variants_rebase_against_pruned_flat_baseline() -> None:
    sessions = [
        Session("used", "codex", ["specialist"], {"specialist", "helper"}),
        Session("unused", "codex", [], {"unused"}),
    ]
    definitions = {
        "specialist": make_definition("specialist", 40, 10),
        "helper": make_definition("helper", 40, 10),
        "unused": make_definition("unused", 80, 20),
    }
    stats = pipeline.build_stats(sessions, definitions, {})

    result = pipeline.evaluate_architecture_variants(
        sessions=sessions,
        stats=stats,
        global_tools=set(),
        candidate_agents=[
            {"candidate_id": "cluster_01", "tools": ["specialist", "helper"]}
        ],
        boundary_by_tool={},
        delegation_overhead_tokens=0,
        baseline_tools={"specialist", "helper"},
    )

    baseline = next(
        item for item in result if item["variant_id"] == "pruned_flat_baseline"
    )
    assert baseline["variant_id"] == "pruned_flat_baseline"
    assert baseline["baseline_architecture_id"] == "pruned_flat_baseline"
    assert baseline["scenarios"]["mid"]["baseline_tokens_per_session"] == 10
    assert baseline["scenarios"]["mid"]["proposed_tokens_per_session"] == 10
    assert baseline["scenarios"]["mid"]["absolute_token_reduction_per_session"] == 0

    specialist = next(item for item in result if item["variant_id"] == "cluster_01")
    assert specialist["baseline_architecture_id"] == "pruned_flat_baseline"
    assert specialist["scenarios"]["mid"]["baseline_tokens_per_session"] == 10
    assert specialist["scenarios"]["mid"]["proposed_tokens_per_session"] == 10


def test_candidate_decision_table_evaluates_fixed_grid_and_robustness() -> None:
    pareto = {
        "tools": ["a", "b"],
        "tool_count": 2,
        "activation_rate": 0.25,
        "definition_tokens_mid": 100.0,
        "internal_affinity": 0.8,
        "min_boundary_margin": 0.2,
    }
    reference = {
        "tools": ["a", "b", "c"],
        "tool_count": 3,
        "activation_rate": 0.5,
        "definition_tokens_mid": 200.0,
        "internal_affinity": 0.6,
        "min_boundary_margin": 0.1,
    }

    result = pipeline.build_candidate_decision_table(
        {"pareto_frontier": [pareto], "reference": reference}
    )

    assert result is not None
    assert result["cost_scenario"] == "mid"
    assert result["github_baseline_exposure_rates"] == [0.25, 0.5, 0.75, 1.0]
    assert result["delegation_overhead_tokens_per_activation"] == [0, 100, 250, 500]
    assert result["candidate_count"] == 2
    assert result["grid_cells_per_candidate"] == 16

    candidate = result["candidates"][0]
    assert candidate["candidate_id"] == "pareto_01"
    assert candidate["tools"] == ["a", "b"]
    assert len(candidate["cells"]) == 16
    zero_overhead = next(
        cell
        for cell in candidate["cells"]
        if cell["github_baseline_exposure_rate"] == 0.5
        and cell["delegation_overhead_tokens_per_activation"] == 0
    )
    assert zero_overhead == {
        "github_baseline_exposure_rate": 0.5,
        "delegation_overhead_tokens_per_activation": 0,
        "activation_rate": 0.25,
        "specialist_definition_tokens": 100.0,
        "expected_tokens_per_session": 25.0,
        "absolute_reduction_per_session": 25.0,
        "relative_reduction": 0.5,
        "break_even_github_exposure_rate": 0.25,
        "internal_affinity": 0.8,
        "minimum_boundary_margin": 0.2,
    }
    high_overhead = next(
        cell
        for cell in candidate["cells"]
        if cell["github_baseline_exposure_rate"] == 0.25
        and cell["delegation_overhead_tokens_per_activation"] == 500
    )
    assert high_overhead["expected_tokens_per_session"] == 150.0
    assert high_overhead["absolute_reduction_per_session"] == -125.0
    assert high_overhead["relative_reduction"] == -5.0
    assert high_overhead["break_even_github_exposure_rate"] == 1.5
    assert candidate["worst_case_positive_reduction"] == -125.0
    assert candidate["viable_cells"] == 6 / 16

    reference_candidate = result["candidates"][1]
    assert reference_candidate["candidate_id"] == "cluster_01_reference"
    assert reference_candidate["candidate_type"] == "reference"
    assert reference_candidate["tools"] == ["a", "b", "c"]


def test_candidate_decision_table_keeps_all_pareto_rows_plus_reference() -> None:
    def row(name: str) -> dict[str, Any]:
        return {
            "tools": [name, f"{name}-helper"],
            "tool_count": 2,
            "activation_rate": 0.1,
            "definition_tokens_mid": 10.0,
            "internal_affinity": 0.5,
            "min_boundary_margin": 0.1,
        }

    frontier = [row(f"p{index}") for index in range(1, 5)]
    reference = row("reference")

    result = pipeline.build_candidate_decision_table(
        {"pareto_frontier": frontier, "reference": reference}
    )

    assert result is not None
    assert result["candidate_count"] == 5
    assert [candidate["candidate_id"] for candidate in result["candidates"]] == [
        "pareto_01",
        "pareto_02",
        "pareto_03",
        "pareto_04",
        "cluster_01_reference",
    ]
    assert sum(len(candidate["cells"]) for candidate in result["candidates"]) == 80


def test_baseline_variant_always_reports_zero_reduction() -> None:
    stats = _variant_test_stats()
    sessions = [
        Session("one", "codex", ["a", "b"], {"a", "b", "c", "d"}),
        Session("two", "codex", ["c"], {"a", "b", "c", "d"}),
    ]

    baseline = pipeline.evaluate_architecture_variants(
        sessions=sessions,
        stats=stats,
        global_tools=set(),
        candidate_agents=[],
        boundary_by_tool={},
        delegation_overhead_tokens=100,
    )[0]

    from cost_evaluation import COST_SCENARIOS

    for scenario in COST_SCENARIOS:
        metrics = baseline["scenarios"][scenario]
        assert metrics["absolute_token_reduction_per_session"] == 0
        assert metrics["relative_token_reduction"] == 0
        assert metrics["specialist_activation_rate"] == 0
        assert metrics["average_specialist_activations_per_session"] == 0
        assert metrics["sessions_requiring_specialist"] == 0


def test_manifest_provider_recovers_advertised_definition_without_fabrication(
    tmp_path: Path,
) -> None:
    from tool_definition_registry import ManifestDefinitionProvider

    manifest = tmp_path / "mcp-tools.json"
    manifest.write_text(
        '{"tools": [{"name": "github.fetch_issue", "description": "fetch", '
        '"inputSchema": {"type": "object"}}]}',
        encoding="utf-8",
    )

    provider = ManifestDefinitionProvider(
        [str(tmp_path)], normalize_tool_name, runtime="codex"
    )

    record = provider.resolve("github.fetch_issue")

    assert record is not None
    assert record.provider == "runtime_manifest"
    assert record.confidence == "direct_manifest"
    assert record.evidence_type == "advertised_definition"
    assert record.estimated_tokens is not None
    assert provider.resolve("github.missing") is None


def test_exposure_matrix_is_sparse() -> None:
    sessions = [
        Session("one", "codex", ["used"]),
        Session("two", "codex", [], {"unused"}),
    ]
    definitions = {
        "used": make_definition("used", 40, 10),
        "unused": make_definition("unused", 40, 10),
        "never": make_definition("never", 40, 10),
    }
    stats = pipeline.build_stats(sessions, definitions, {})

    matrix = build_exposure_matrix(sessions, stats)

    assert {(row["session_id"], row["tool_name"]) for row in matrix} == {
        ("one", "used"),
        ("two", "unused"),
    }
    assert exposure_matrix_summary(sessions, stats) == {
        "sessions": 2,
        "known_tools": 3,
        "possible_rows": 6,
        "observed_rows": 2,
    }


def test_called_tools_never_become_directly_observed_exposure() -> None:
    session = Session("one", "codex", ["called_only"])

    state = baseline_exposure_states(
        [session], "all_runtime_tools"
    )[session.session_id]

    assert state.actual_calls == frozenset({"called_only"})
    assert state.directly_observed_exposure == frozenset()
    assert state.inferred_baseline_exposure == frozenset({"called_only"})


def test_observed_only_reproduces_direct_exposure_without_call_oracle() -> None:
    sessions = [
        Session("called", "codex", ["called_only"]),
        Session("exposed", "codex", [], {"direct"}),
    ]
    definitions = {
        name: make_definition(name, tokens * 4, tokens)
        for name, tokens in {"called_only": 10, "direct": 20}.items()
    }
    stats = pipeline.build_stats(sessions, definitions, {})

    scenarios = pipeline.expected_token_cost_scenarios(
        sessions=sessions,
        stats=stats,
        global_tools=set(),
        candidate_agents=[],
        delegation_overhead_tokens=0,
        exposure_model="observed_only",
    )

    assert scenarios["mid"]["baseline_tokens_per_session"] == 10.0


def test_all_runtime_tools_charges_one_parent_runtime_surface() -> None:
    sessions = [
        Session("one", "codex", ["a"]),
        Session("two", "codex", ["b"]),
    ]
    definitions = {
        name: make_definition(name, tokens * 4, tokens)
        for name, tokens in {"a": 10, "b": 20}.items()
    }
    stats = pipeline.build_stats(sessions, definitions, {})

    scenarios = pipeline.expected_token_cost_scenarios(
        sessions=sessions,
        stats=stats,
        global_tools=set(),
        candidate_agents=[],
        delegation_overhead_tokens=0,
        exposure_model="all_runtime_tools",
    )

    assert scenarios["mid"]["baseline_tokens_per_session"] == 30.0


def test_specialist_tools_leave_parent_and_load_only_on_activation() -> None:
    sessions = [
        Session("idle", "codex", []),
        Session("active", "codex", ["specialist"]),
    ]
    definitions = {
        "parent": make_definition("parent", 80, 20),
        "specialist": make_definition("specialist", 40, 10),
    }
    stats = pipeline.build_stats(sessions, definitions, {})
    # Make both tools part of the observed runtime catalog without exposing
    # either one directly in the idle session.
    sessions[0].calls.append("parent")

    scenarios = pipeline.expected_token_cost_scenarios(
        sessions=sessions,
        stats=stats,
        global_tools=set(),
        candidate_agents=[{"candidate_id": "specialist", "tools": ["specialist"]}],
        delegation_overhead_tokens=0,
        exposure_model="all_runtime_tools",
    )

    assert scenarios["mid"]["baseline_tokens_per_session"] == 30.0
    assert scenarios["mid"]["proposed_tokens_per_session"] == 25.0


def test_provider_scoped_requires_provider_availability_telemetry() -> None:
    sessions = [
        Session(
            "available",
            "codex",
            [],
            {"github.list"},
            provider_availability={"github"},
            provider_tools={"github": {"github.list", "github.get"}},
        ),
        Session("called", "codex", ["github.get"]),
    ]
    states = baseline_exposure_states(sessions, "provider_scoped")

    assert states["available"].inferred_baseline_exposure == frozenset({"github.get"})
    assert states["called"].inferred_baseline_exposure == frozenset()
    assert states["called"].actual_calls == frozenset({"github.get"})


def test_provider_scoped_does_not_infer_called_only_dotted_tools() -> None:
    sessions = [
        Session(
            "available",
            "codex",
            [],
            provider_availability={"github"},
        ),
        Session("called", "codex", ["github.get"]),
    ]

    states = baseline_exposure_states(sessions, "provider_scoped")

    assert states["available"].inferred_baseline_exposure == frozenset()


def test_sensitivity_summary_uses_all_models_but_sign_stability_uses_decision_models() -> None:
    scenarios = {
        model: {
            "mid": {"relative_token_reduction": value},
        }
        for model, value in {
            "observed_only": -0.5,
            "provider_scoped": 0.1,
            "all_runtime_tools": 0.2,
        }.items()
    }

    summary = pipeline.sensitivity_summary(scenarios)

    assert summary == {
        "min_mid_reduction": -0.5,
        "max_mid_reduction": 0.2,
        "exposure_model_at_min": "observed_only",
        "exposure_model_at_max": "all_runtime_tools",
        "sign_stable": True,
    }


def test_sensitivity_summary_is_not_stable_when_decision_models_disagree() -> None:
    scenarios = {
        model: {"mid": {"relative_token_reduction": value}}
        for model, value in {
            "observed_only": -0.5,
            "provider_scoped": -0.1,
            "all_runtime_tools": 0.2,
        }.items()
    }

    assert pipeline.sensitivity_summary(scenarios)["sign_stable"] is False


def test_cluster_exposure_economics_reports_break_even_and_tool_contributions() -> None:
    sessions = [
        Session(
            "active",
            "codex",
            ["github.one"],
            {"github.one", "github.two"},
        ),
        Session(
            "partial",
            "codex",
            ["github.two"],
            {"github.two"},
        ),
        Session("idle", "codex", [], set()),
    ]
    definitions = {
        "github.one": make_definition("github.one", 40, 10),
        "github.two": make_definition("github.two", 80, 20),
    }
    stats = pipeline.build_stats(sessions, definitions, {})

    diagnostics = cluster_exposure_economics(
        sessions=sessions,
        stats=stats,
        specialist_tools={"github.one", "github.two"},
        delegation_overhead_tokens=0,
    )

    assert diagnostics["specialist_tool_count"] == 2
    assert diagnostics["specialist_definition_tokens_mid"] == 30.0
    assert diagnostics["activation_sessions"] == 2
    assert diagnostics["activation_rate"] == 2 / 3

    observed = diagnostics["exposure_models"]["observed_only"]
    assert observed["sessions_with_any_specialist_tool_exposed"] == 2
    assert observed["sessions_with_all_specialist_tools_exposed"] == 1
    assert observed["average_specialist_tools_exposed_per_session"] == 1.0
    assert observed["baseline_specialist_tokens_per_session"]["mid"] == 50 / 3
    assert observed["loaded_specialist_tokens_per_session"]["mid"] == 20.0
    assert observed["net_specialist_token_reduction_per_session"]["mid"] == pytest.approx(-10 / 3)
    assert observed["break_even_baseline_tokens_per_session"]["mid"] == 20.0
    assert observed["break_even_full_cluster_exposure_rate"]["mid"] == 2 / 3

    one = next(row for row in observed["tools"] if row["tool"] == "github.one")
    assert one["sessions_baseline_exposed"] == 1
    assert one["exposure_rate"] == 1 / 3
    assert one["sessions_called"] == 1
    assert observed["net_specialist_token_reduction_per_session"]["mid"] == pytest.approx(-10 / 3)
    assert one["baseline_token_contribution"]["mid"] == 10 / 3


def test_cluster_exposure_economics_uses_provider_scoped_tool_membership() -> None:
    sessions = [
        Session(
            "github-available",
            "codex",
            [],
            set(),
            provider_availability={"github"},
            provider_tools={"github": {"github.one"}},
        ),
        Session(
            "other-provider",
            "codex",
            [],
            set(),
            provider_availability={"other"},
            provider_tools={"other": {"other.tool"}},
        ),
    ]
    definitions = {
        "github.one": make_definition("github.one", 40, 10),
        "github.two": make_definition("github.two", 80, 20),
    }
    stats = pipeline.build_stats(sessions, definitions, {})

    diagnostics = cluster_exposure_economics(
        sessions=sessions,
        stats=stats,
        specialist_tools={"github.one", "github.two"},
        delegation_overhead_tokens=0,
    )

    provider = diagnostics["exposure_models"]["provider_scoped"]
    assert provider["sessions_with_any_specialist_tool_exposed"] == 1
    assert provider["sessions_with_all_specialist_tools_exposed"] == 0
    assert provider["average_specialist_tools_exposed_per_session"] == 0.5
    assert provider["baseline_specialist_tokens_per_session"]["mid"] == 5.0
