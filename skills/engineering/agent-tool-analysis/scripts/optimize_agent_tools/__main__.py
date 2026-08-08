#!/usr/bin/env python3
"""CLI entry point for telemetry-driven agent tool exposure analysis."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from optimize_agent_tools.analysis_pipeline import (
    DEFAULT_GITHUB_EXPOSURE_RATES,
    analyze,
    load_explicit_tool_costs,
)
from optimize_agent_tools.reporting import print_summary, render_markdown
from optimize_agent_tools.telemetry_ingestion import (
    get_codex_sessions,
    get_vscode_sessions,
)

DEFAULT_VSCODE_WORKSPACE_STORAGE = os.path.expanduser(
    r"~\AppData\Roaming\Code\User\workspaceStorage"
)
DEFAULT_CODEX_SESSIONS_DIR = os.path.expanduser(r"~\.codex\sessions")
DEFAULT_CODEX_DEFINITION_ROOTS = tuple(
    path
    for path in (
        os.path.expanduser(r"~\.codex"),
        os.path.expanduser(r"~\.config\codex"),
        os.path.join(os.environ.get("APPDATA", ""), "Codex"),
    )
    if path
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Analyze historical coding-agent tool usage and propose lower-overhead tool exposure."
    )
    parser.add_argument(
        "--vscode-workspace-storage", default=DEFAULT_VSCODE_WORKSPACE_STORAGE
    )
    parser.add_argument("--codex-sessions-dir", default=DEFAULT_CODEX_SESSIONS_DIR)
    parser.add_argument(
        "--tool-costs",
        default=None,
        help="Optional JSON mapping of normalized tool names to token costs.",
    )
    parser.add_argument(
        "--definition-search-root",
        action="append",
        default=[],
        help="Additional runtime/provider root to scan.",
    )
    parser.add_argument("--output-dir", default="agent_tool_analysis")
    parser.add_argument("--min-tool-sessions", type=int, default=3)
    parser.add_argument("--similarity-threshold", type=float, default=0.35)
    parser.add_argument("--global-usage-threshold", type=float, default=0.60)
    parser.add_argument("--min-cluster-size", type=int, default=2)
    parser.add_argument("--min-cluster-sessions", type=int, default=3)
    parser.add_argument("--delegation-overhead-tokens", type=int, default=0)
    parser.add_argument(
        "--github-exposure-rates",
        default=",".join(f"{rate:g}" for rate in DEFAULT_GITHUB_EXPOSURE_RATES),
    )
    return parser.parse_args()


def _github_rates(raw: str) -> tuple[float, ...]:
    try:
        rates = tuple(float(value.strip()) for value in raw.split(",") if value.strip())
    except ValueError as error:
        raise SystemExit(
            "--github-exposure-rates must be comma-separated numbers"
        ) from error
    if not rates:
        raise SystemExit("--github-exposure-rates must contain at least one rate")
    if any(rate < 0 or rate > 1 for rate in rates):
        raise SystemExit("--github-exposure-rates values must be between 0 and 1")
    return rates


def _validate_args(args: argparse.Namespace, github_rates: tuple[float, ...]) -> None:
    if args.min_tool_sessions < 1:
        raise SystemExit("--min-tool-sessions must be >= 1")
    if not 0 <= args.similarity_threshold <= 1:
        raise SystemExit("--similarity-threshold must be between 0 and 1")
    if not 0 <= args.global_usage_threshold <= 1:
        raise SystemExit("--global-usage-threshold must be between 0 and 1")
    if args.min_cluster_size < 2:
        raise SystemExit("--min-cluster-size must be >= 2")
    if args.min_cluster_sessions < 1:
        raise SystemExit("--min-cluster-sessions must be >= 1")
    if args.delegation_overhead_tokens < 0:
        raise SystemExit("--delegation-overhead-tokens cannot be negative")
    if not github_rates:
        raise SystemExit("--github-exposure-rates must contain at least one rate")


def main() -> int:
    args = parse_args()
    github_rates = _github_rates(args.github_exposure_rates)
    _validate_args(args, github_rates)
    vscode_sessions, vscode_defs = get_vscode_sessions(args.vscode_workspace_storage)
    codex_sessions, codex_defs = get_codex_sessions(args.codex_sessions_dir)
    sessions = vscode_sessions + codex_sessions
    if not sessions:
        raise SystemExit(
            "No tool-using sessions were found. Check --vscode-workspace-storage and --codex-sessions-dir."
        )

    explicit_costs = load_explicit_tool_costs(args.tool_costs)
    report = analyze(
        sessions,
        vscode_defs,
        codex_defs,
        explicit_path=args.tool_costs,
        definition_roots=list(
            dict.fromkeys(
                [*DEFAULT_CODEX_DEFINITION_ROOTS, *args.definition_search_root]
            )
        ),
        min_tool_sessions=args.min_tool_sessions,
        similarity_threshold=args.similarity_threshold,
        global_usage_threshold=args.global_usage_threshold,
        min_cluster_size=args.min_cluster_size,
        min_cluster_sessions=args.min_cluster_sessions,
        delegation_overhead_tokens=args.delegation_overhead_tokens,
        github_exposure_rates=github_rates,
    )
    report["config"]["explicit_cost_entries"] = len(explicit_costs)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    json_path = output_dir / "agent_tool_analysis.json"
    markdown_path = output_dir / "agent_tool_analysis.md"
    json_path.write_text(
        json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    markdown_path.write_text(render_markdown(report), encoding="utf-8")
    print_summary(report, json_path, markdown_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
