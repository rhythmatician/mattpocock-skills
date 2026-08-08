#!/usr/bin/env python3
"""Run recorded replay observations against the frozen architecture benchmark."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from replay_harness import (
    ReplayObservation,
    ReplayTask,
    build_benchmark_architectures,
    compare_to_benchmark,
    FROZEN_PRUNED_FLAT_BASELINE_TOOLS,
    replay_recorded_observations,
)

ARCHITECTURE_IDS = (
    "pruned_flat_baseline",
    "pareto_02",
    "pareto_03",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Compare recorded replay observations against frozen tool architectures."
    )
    parser.add_argument(
        "--benchmark-report",
        default="agent_tool_analysis/agent_tool_analysis.json",
        help="Analysis JSON containing pruned_flat_baseline.tools_retained.",
    )
    parser.add_argument(
        "--replay-input",
        required=True,
        help="JSON bundle containing tasks and observations by architecture.",
    )
    parser.add_argument(
        "--output",
        default=None,
        help="Optional path for the comparison JSON report.",
    )
    return parser.parse_args()


def _observation(raw: dict[str, Any]) -> ReplayObservation:
    required_measurements = (
        "tool_call_failures",
        "routing_failure",
        "missed_specialist_activation",
        "total_input_tokens",
        "tool_definition_context_tokens",
        "turns",
        "wall_clock_seconds",
    )
    missing = [field for field in required_measurements if field not in raw]
    if missing:
        raise ValueError(
            f"Observation {raw.get('task_id', '<unknown>')!r} is missing: "
            + ", ".join(missing)
        )
    return ReplayObservation(
        task_id=raw["task_id"],
        task_success=raw["task_success"],
        capability_covered=raw["capability_covered"],
        quality_score=raw["quality_score"],
        specialist_activated=raw.get("specialist_activated"),
        tool_call_failures=raw["tool_call_failures"],
        routing_failure=raw["routing_failure"],
        missed_specialist_activation=raw["missed_specialist_activation"],
        total_input_tokens=raw["total_input_tokens"],
        tool_definition_context_tokens=raw["tool_definition_context_tokens"],
        turns=raw["turns"],
        wall_clock_seconds=raw["wall_clock_seconds"],
    )


def _task(raw: dict[str, Any]) -> ReplayTask:
    return ReplayTask(
        task_id=raw["task_id"],
        required_specialist=raw.get("required_specialist"),
    )


def _aggregate_report(result: Any) -> dict[str, Any]:
    aggregate = result.aggregate
    return {
        "architecture_id": result.architecture_id,
        "task_count": aggregate.task_count,
        "task_success_rate": aggregate.task_success_rate,
        "capability_coverage_rate": aggregate.capability_coverage_rate,
        "mean_quality_score": aggregate.mean_quality_score,
        "tool_call_failures": aggregate.tool_call_failures,
        "routing_failures": aggregate.routing_failures,
        "missed_specialist_activations": aggregate.missed_specialist_activations,
        "unnecessary_specialist_activations": aggregate.unnecessary_specialist_activations,
        "total_input_tokens": aggregate.total_input_tokens,
        "tool_definition_context_tokens": aggregate.tool_definition_context_tokens,
        "total_tool_context_tokens": aggregate.total_tool_context_tokens,
        "turns": aggregate.turns,
        "specialist_handoffs": aggregate.specialist_handoffs,
        "wall_clock_seconds": aggregate.wall_clock_seconds,
    }


def build_report(bundle: dict[str, Any], benchmark: dict[str, Any]) -> dict[str, Any]:
    tasks = [_task(raw) for raw in bundle["tasks"]]
    parent_tools = frozenset(
        benchmark["pruned_flat_baseline"]["tools_retained"]
    )
    if parent_tools != FROZEN_PRUNED_FLAT_BASELINE_TOOLS:
        raise ValueError(
            "Benchmark report does not match frozen pruned_flat_baseline tools."
        )
    architectures = build_benchmark_architectures(parent_tools)
    by_id = {architecture.architecture_id: architecture for architecture in architectures}
    supplied = bundle["observations"]
    missing = set(ARCHITECTURE_IDS) - set(supplied)
    if missing:
        raise ValueError(
            "Replay input is missing observations for: " + ", ".join(sorted(missing))
        )

    results = {}
    for architecture_id in ARCHITECTURE_IDS:
        result = replay_recorded_observations(
            tasks,
            by_id[architecture_id],
            [_observation(raw) for raw in supplied[architecture_id]],
        )
        results[architecture_id] = result

    baseline = results["pruned_flat_baseline"]
    comparisons = {
        architecture_id: compare_to_benchmark(baseline, results[architecture_id]).__dict__
        for architecture_id in ARCHITECTURE_IDS[1:]
    }
    return {
        "benchmark": {
            "baseline_architecture_id": "pruned_flat_baseline",
            "architectures": {
                architecture.architecture_id: {
                    "parent_tools": sorted(architecture.parent_tools),
                    "specialist_tools": {
                        specialist_id: sorted(tools)
                        for specialist_id, tools in architecture.specialist_tools.items()
                    },
                }
                for architecture in architectures
            },
            "candidate_success": {
                "historical_capability_coverage": "100%",
                "task_quality": ">= pruned_flat_baseline",
                "total_tool_context_tokens": "< pruned_flat_baseline",
            },
            "routing_policy": "explicit task.required_specialist only; no routing optimization",
        },
        "architectures": {
            architecture_id: _aggregate_report(results[architecture_id])
            for architecture_id in ARCHITECTURE_IDS
        },
        "comparisons": comparisons,
    }


def main() -> int:
    args = parse_args()
    benchmark_path = Path(args.benchmark_report)
    replay_path = Path(args.replay_input)
    benchmark = json.loads(benchmark_path.read_text(encoding="utf-8"))
    bundle = json.loads(replay_path.read_text(encoding="utf-8"))
    report = build_report(bundle, benchmark)
    rendered = json.dumps(report, indent=2, ensure_ascii=False)
    if args.output:
        Path(args.output).write_text(rendered + "\n", encoding="utf-8")
    else:
        print(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
