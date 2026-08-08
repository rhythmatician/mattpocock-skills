#!/usr/bin/env python3
"""Evaluate recorded observations against an arbitrary architecture manifest."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from optimize_agent_tools.replay_harness import (
    ArchitectureManifest,
    ReplayObservation,
    ReplayTask,
    build_architecture_manifest,
    compare_to_benchmark,
    replay_recorded_observations,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Compare recorded replay observations against a tool architecture manifest."
    )
    parser.add_argument(
        "--benchmark-report",
        default="agent_tool_analysis/agent_tool_analysis.json",
        help="Analysis JSON containing pruned_flat_baseline.tools_retained.",
    )
    parser.add_argument(
        "--architecture-manifest",
        required=True,
        help="JSON manifest describing the baseline and arbitrary candidate architectures.",
    )
    parser.add_argument(
        "--replay-input",
        required=True,
        help="JSON bundle containing tasks and observations by architecture ID.",
    )
    parser.add_argument(
        "--output",
        default=None,
        help="Optional path for the comparison JSON report.",
    )
    return parser.parse_args()


def _observation(raw: dict[str, Any]) -> ReplayObservation:
    required_measurements = (
        "task_success",
        "observed_replay_capability_covered",
        "quality_score",
        "tool_call_failures",
        "routing_failure",
        "missed_agent_activation",
        "unnecessary_agent_activation",
        "total_input_tokens",
        "tool_definition_context_tokens",
        "delegation_tokens",
        "inter_agent_communication_tokens",
        "turns",
        "wall_clock_seconds",
    )
    missing = [field for field in required_measurements if field not in raw]
    if missing:
        raise ValueError(
            f"Observation {raw.get('task_id', '<unknown>')!r} is missing: "
            + ", ".join(missing)
        )
    raw_path = raw.get("agent_activation_path", [])
    if not isinstance(raw_path, list) or not all(
        isinstance(agent_id, str) and agent_id for agent_id in raw_path
    ):
        raise ValueError(
            f"Observation {raw.get('task_id', '<unknown>')!r} activation path "
            "must be a list of non-empty strings."
        )
    return ReplayObservation(
        task_id=raw["task_id"],
        task_success=raw["task_success"],
        observed_replay_capability_covered=raw["observed_replay_capability_covered"],
        quality_score=raw["quality_score"],
        agent_activation_path=tuple(raw_path),
        tool_call_failures=raw["tool_call_failures"],
        routing_failure=raw["routing_failure"],
        missed_agent_activation=raw["missed_agent_activation"],
        unnecessary_agent_activation=raw["unnecessary_agent_activation"],
        total_input_tokens=raw["total_input_tokens"],
        tool_definition_context_tokens=raw["tool_definition_context_tokens"],
        delegation_tokens=raw["delegation_tokens"],
        inter_agent_communication_tokens=raw["inter_agent_communication_tokens"],
        turns=raw["turns"],
        wall_clock_seconds=raw["wall_clock_seconds"],
    )


def _task(raw: dict[str, Any], architecture_ids: tuple[str, ...]) -> ReplayTask:
    raw_paths = raw.get("activation_paths", {})
    if not isinstance(raw_paths, dict):
        raise ValueError(
            f"Task {raw.get('task_id', '<unknown>')!r} paths must be an object."
        )
    unknown = set(raw_paths) - set(architecture_ids)
    if unknown:
        raise ValueError(
            f"Task {raw.get('task_id', '<unknown>')!r} names unknown architectures: "
            + ", ".join(sorted(unknown))
        )
    paths: dict[str, tuple[str, ...]] = {}
    for architecture_id, path in raw_paths.items():
        if not isinstance(path, list) or not all(
            isinstance(agent_id, str) and agent_id for agent_id in path
        ):
            raise ValueError(
                f"Task {raw.get('task_id', '<unknown>')!r} activation paths must be string lists."
            )
        paths[architecture_id] = tuple(path)
    return ReplayTask(task_id=raw["task_id"], activation_paths=paths)


def _aggregate_report(result: Any) -> dict[str, Any]:
    aggregate = result.aggregate
    return {
        "architecture_id": result.architecture_id,
        "task_count": aggregate.task_count,
        "task_success_rate": aggregate.task_success_rate,
        "historical_tool_capability_coverage_rate": aggregate.historical_tool_capability_coverage_rate,
        "observed_replay_capability_coverage_rate": aggregate.observed_replay_capability_coverage_rate,
        "mean_quality_score": aggregate.mean_quality_score,
        "tool_call_failures": aggregate.tool_call_failures,
        "routing_failures": aggregate.routing_failures,
        "missed_agent_activations": aggregate.missed_agent_activations,
        "unnecessary_agent_activations": aggregate.unnecessary_agent_activations,
        "total_input_tokens": aggregate.total_input_tokens,
        "tool_definition_context_tokens": aggregate.tool_definition_context_tokens,
        "total_tool_context_tokens": aggregate.total_tool_context_tokens,
        "delegation_tokens": aggregate.delegation_tokens,
        "inter_agent_communication_tokens": aggregate.inter_agent_communication_tokens,
        "orchestration_tokens": aggregate.orchestration_tokens,
        "turns": aggregate.turns,
        "agent_activations": aggregate.agent_activations,
        "delegation_count": aggregate.delegation_count,
        "inter_agent_handoffs": aggregate.inter_agent_handoffs,
        "wall_clock_seconds": aggregate.wall_clock_seconds,
    }


def _manifest_report(manifest: ArchitectureManifest) -> dict[str, Any]:
    return {
        "baseline_architecture_id": manifest.baseline_architecture_id,
        "historical_tool_capability_tools": sorted(
            manifest.historical_tool_capability_tools
        ),
        "architectures": {
            architecture.architecture_id: {
                "parent_tools": sorted(architecture.parent_tools),
                "agents": {
                    agent_id: sorted(tools)
                    for agent_id, tools in architecture.agent_tools.items()
                },
            }
            for architecture in manifest.architectures
        },
    }


def build_report(
    bundle: dict[str, Any],
    benchmark: dict[str, Any],
    manifest_raw: dict[str, Any],
) -> dict[str, Any]:
    manifest = build_architecture_manifest(manifest_raw)
    report_tools = frozenset(
        benchmark[manifest.baseline_architecture_id]["tools_retained"]
    )
    if report_tools != manifest.baseline.parent_tools:
        raise ValueError(
            "Benchmark report does not match manifest pruned_flat_baseline tools."
        )
    tasks = [_task(raw, manifest.architecture_ids) for raw in bundle["tasks"]]
    supplied = bundle["observations"]
    missing = set(manifest.architecture_ids) - set(supplied)
    extra = set(supplied) - set(manifest.architecture_ids)
    if missing:
        raise ValueError(
            "Replay input is missing observations for: " + ", ".join(sorted(missing))
        )
    if extra:
        raise ValueError(
            "Replay input has unknown architecture observations for: "
            + ", ".join(sorted(extra))
        )

    results = {}
    for architecture in manifest.architectures:
        result = replay_recorded_observations(
            tasks,
            architecture,
            [_observation(raw) for raw in supplied[architecture.architecture_id]],
            historical_tools=manifest.historical_tool_capability_tools,
        )
        results[architecture.architecture_id] = result

    baseline = results[manifest.baseline_architecture_id]
    comparisons = {
        architecture_id: compare_to_benchmark(
            baseline, results[architecture_id]
        ).__dict__
        for architecture_id in manifest.architecture_ids
        if architecture_id != manifest.baseline_architecture_id
    }
    return {
        "benchmark": {
            "baseline_architecture_id": manifest.baseline_architecture_id,
            "manifest": _manifest_report(manifest),
            "candidate_success": {
                "historical_tool_capability_coverage": "100%",
                "task_quality": ">= pruned_flat_baseline",
                "total_tool_context_tokens": "< pruned_flat_baseline",
            },
            "routing_policy": "explicit per-architecture activation_paths only; no routing optimization",
        },
        "architectures": {
            architecture_id: _aggregate_report(results[architecture_id])
            for architecture_id in manifest.architecture_ids
        },
        "comparisons": comparisons,
    }


def main() -> int:
    args = parse_args()
    benchmark = json.loads(Path(args.benchmark_report).read_text(encoding="utf-8"))
    manifest = json.loads(Path(args.architecture_manifest).read_text(encoding="utf-8"))
    bundle = json.loads(Path(args.replay_input).read_text(encoding="utf-8"))
    report = build_report(bundle, benchmark, manifest)
    rendered = json.dumps(report, indent=2, ensure_ascii=False)
    if args.output:
        Path(args.output).write_text(rendered + "\n", encoding="utf-8")
    else:
        print(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
