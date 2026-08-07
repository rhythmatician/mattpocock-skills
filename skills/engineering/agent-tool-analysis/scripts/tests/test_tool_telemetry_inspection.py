from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any


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


optimizer = _load_module("optimize_agent_tools", "optimize_agent_tools.py")
sys.modules["optimize_agent_tools"] = optimizer
inspector = _load_module("inspect_codex_telemetry", "inspect_codex_telemetry.py")


def test_codex_payload_function_call_name_is_joined_to_catalog() -> None:
    event = {
        "type": "response_item",
        "payload": {
            "type": "function_call",
            "name": "exec",
            "arguments": "not emitted by the inspector",
        },
    }

    assert optimizer.find_raw_tool_call(event) == "exec"


def test_codex_extractor_returns_native_and_invocation_calls() -> None:
    event = {
        "type": "response_item",
        "payload": {
            "type": "mcp_tool_call",
            "name": "exec",
            "invocation": {"tool": "github.fetch_file"},
        },
    }

    assert optimizer.extract_codex_calls(event) == ["exec", "github.fetch_file"]
    assert (
        optimizer.find_raw_tool_call(
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
        for raw_name in optimizer.extract_codex_calls(event):
            name = optimizer.normalize_tool_name(raw_name)
            assert name is not None
            optimizer_calls[name] = optimizer_calls.get(name, 0) + 1

    assert inspector_calls == optimizer_calls


def test_cost_coverage_separates_catalog_and_usage_weighted_rates() -> None:
    sessions = [optimizer.Session("one", "codex", ["used", "unknown"])]
    definitions = {
        "catalog_only": optimizer.ToolDefinition("catalog_only", 40, 10, "codex"),
        "used": optimizer.ToolDefinition("used", 20, 5, "codex"),
    }

    stats = optimizer.build_stats(sessions, definitions, {})
    coverage = optimizer.expected_known_token_cost(
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

    assert optimizer.extract_codex_exposures(event) == {
        "github.fetch_issue",
        "github.fetch_pr",
    }
    assert (
        optimizer.extract_codex_exposures(
            {"payload": {"type": "function_call", "name": "exec"}}
        )
        == set()
    )


def test_exposure_matrix_does_not_turn_usage_into_exposure() -> None:
    sessions = [
        optimizer.Session(
            "one",
            "codex",
            ["used"],
            exposed_tools=set(),
        )
    ]
    definitions = {"used": optimizer.ToolDefinition("used", 40, 10, "codex")}
    stats = optimizer.build_stats(sessions, definitions, {})

    row = optimizer.build_exposure_matrix(sessions, stats)[0]
    assert row["called"] is True
    assert row["exposed"] is False
    assert row["exposure_source"] == "not_observed"
    assert stats["used"].sessions_called == 1
    assert stats["used"].call_given_exposed is None
    assert (
        optimizer.exposure_consistency(sessions)["called_tools_without_direct_exposure"]
        == 1
    )


def test_definition_tokens_account_for_exposed_but_unused_sessions() -> None:
    sessions = [
        optimizer.Session("used", "codex", ["tool"], {"tool"}),
        optimizer.Session("unused", "codex", [], {"tool"}),
    ]
    definitions = {"tool": optimizer.ToolDefinition("tool", 40, 10, "codex")}

    stat = optimizer.build_stats(sessions, definitions, {})["tool"]

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
    metrics = optimizer.tool_boundary_metrics("a", {"a", "b"}, pairs, ["a", "b", "c"])

    assert metrics == {
        "mean_internal_affinity": 0.8,
        "best_external_affinity": 0.3,
        "boundary_margin": 0.5,
    }


def test_cluster_boundary_metrics_reports_exclusive_and_overlapping_coverage() -> None:
    sessions = [
        optimizer.Session("one", "codex", ["a"], {"a"}),
        optimizer.Session("two", "codex", ["a", "c"], {"a", "c"}),
        optimizer.Session("three", "codex", ["c"], {"c"}),
    ]
    clusters = [{"a", "b"}, {"c"}]
    session_index = optimizer.build_session_index(sessions)
    pairs = {
        ("a", "b"): {"affinity": 0.8},
        ("a", "c"): {"affinity": 0.3},
        ("b", "c"): {"affinity": 0.2},
    }

    metrics = optimizer.cluster_boundary_metrics(
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
        optimizer.Session("call", "codex", ["exec"], set()),
        optimizer.Session("both", "codex", ["exec"], {"exec"}),
        optimizer.Session("exposure", "codex", [], {"create_thread"}),
    ]

    assert optimizer.session_population_summary(sessions) == {
        "sessions_total": 3,
        "sessions_with_calls": 2,
        "sessions_with_direct_exposure": 2,
        "sessions_with_calls_and_exposure": 1,
        "sessions_with_calls_without_exposure": 1,
        "sessions_with_exposure_without_calls": 1,
    }


def test_usage_rate_uses_call_bearing_sessions_only() -> None:
    sessions = [
        optimizer.Session("call", "codex", ["exec"]),
        optimizer.Session("call-two", "codex", ["other"]),
        optimizer.Session("exposure-only", "codex", [], {"exec"}),
    ]

    stats = optimizer.build_stats(sessions, {}, {})

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


def test_definition_from_record_preserves_unknown_estimated_tokens() -> None:
    from tool_definition_registry import DefinitionRecord

    definition = optimizer.definition_from_record(
        DefinitionRecord(
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
    )

    assert definition.estimated_tokens is None
    assert definition.serialized_chars is None


def test_unresolved_cost_estimates_are_separate_empirical_quantiles() -> None:
    sessions = [
        optimizer.Session("one", "codex", ["resolved_low", "unknown"]),
        optimizer.Session("two", "codex", ["resolved_high"], {"unknown"}),
    ]
    definitions = {
        "resolved_low": optimizer.ToolDefinition("resolved_low", 40, 10, "codex"),
        "resolved_high": optimizer.ToolDefinition("resolved_high", 80, 20, "codex"),
        "unknown": optimizer.ToolDefinition("unknown", None, None, "unknown"),
    }

    stats = optimizer.build_stats(sessions, definitions, {})

    unknown = stats["unknown"]
    assert unknown.definition_tokens is None
    assert (unknown.estimated_cost_low, unknown.estimated_cost_mid, unknown.estimated_cost_high) == (
        12.5,
        15.0,
        17.5,
    )
    assert unknown.estimation_basis == optimizer.ESTIMATION_BASIS
    assert unknown.estimation_confidence == "low"
    assert unknown.estimated_cost_low <= unknown.estimated_cost_mid
    assert unknown.estimated_cost_mid <= unknown.estimated_cost_high

    for name, expected in (("resolved_low", 10), ("resolved_high", 20)):
        assert stats[name].definition_tokens == expected
        assert stats[name].estimated_cost_low is None
        assert stats[name].estimated_cost_mid is None
        assert stats[name].estimated_cost_high is None


def test_relative_reduction_calculation_is_correct() -> None:
    assert optimizer.reduction_metrics(100, 75) == {
        "baseline_tokens_per_session": 100,
        "proposed_tokens_per_session": 75,
        "absolute_token_reduction_per_session": 25,
        "relative_token_reduction": 0.25,
    }


def test_cost_scenarios_measure_raw_cluster_reduction() -> None:
    sessions = [
        optimizer.Session("one", "codex", ["resolved", "unknown"], {"resolved", "unknown"}),
        optimizer.Session("two", "codex", ["resolved"], {"resolved", "unknown"}),
    ]
    definitions = {
        "resolved": optimizer.ToolDefinition("resolved", 40, 10, "codex"),
        "unknown": optimizer.ToolDefinition("unknown", None, None, "unknown"),
    }
    stats = optimizer.build_stats(sessions, definitions, {})
    agents = [{"candidate_id": "cluster_01", "tools": ["unknown"]}]

    scenarios = optimizer.expected_token_cost_scenarios(
        sessions=sessions,
        stats=stats,
        global_tools=set(),
        candidate_agents=agents,
        delegation_overhead_tokens=0,
    )

    assert optimizer.scenario_cost(stats["resolved"], "low") == 10.0
    assert optimizer.scenario_cost(stats["resolved"], "mid") == 10.0
    assert optimizer.scenario_cost(stats["resolved"], "high") == 10.0
    assert scenarios["low"] == {
        "baseline_tokens_per_session": 20.0,
        "proposed_tokens_per_session": 15.0,
        "absolute_token_reduction_per_session": 5.0,
        "relative_token_reduction": 0.25,
    }
    assert scenarios["low"]["baseline_tokens_per_session"] <= scenarios["high"]["baseline_tokens_per_session"]
    assert scenarios["low"]["proposed_tokens_per_session"] <= scenarios["high"]["proposed_tokens_per_session"]


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
        [str(tmp_path)], optimizer.normalize_tool_name, runtime="codex"
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
        optimizer.Session("one", "codex", ["used"]),
        optimizer.Session("two", "codex", [], {"unused"}),
    ]
    definitions = {
        "used": optimizer.ToolDefinition("used", 40, 10, "codex"),
        "unused": optimizer.ToolDefinition("unused", 40, 10, "codex"),
        "never": optimizer.ToolDefinition("never", 40, 10, "codex"),
    }
    stats = optimizer.build_stats(sessions, definitions, {})

    matrix = optimizer.build_exposure_matrix(sessions, stats)

    assert {(row["session_id"], row["tool_name"]) for row in matrix} == {
        ("one", "used"),
        ("two", "unused"),
    }
    assert optimizer.exposure_matrix_summary(sessions, stats) == {
        "sessions": 2,
        "known_tools": 3,
        "possible_rows": 6,
        "observed_rows": 2,
    }
