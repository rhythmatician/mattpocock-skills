#!/usr/bin/env python3
"""Inspect Codex JSONL structure without exposing telemetry contents.

The report contains paths, event-type counts, normalized candidate tool names,
and call/definition classifications. It deliberately omits argument values,
prompts, messages, and tool output.
"""

from __future__ import annotations

import argparse
import glob
import json
import os
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

from optimize_agent_tools.telemetry_ingestion import normalize_tool_name
from optimize_agent_tools.tool_definition_registry import DEFINITION_KEYS

CALL_TYPES = {
    "custom_tool_call",
    "function_call",
    "mcp_tool_call",
}
TOOLISH_PATH_PARTS = {"dynamic_tools", "invocation", "tool", "tool_name"}


@dataclass
class Candidate:
    name: str
    path: str
    role: str
    appearances: int = 0


def walk_nodes(value: Any, path: str = "") -> Iterable[tuple[Any, str]]:
    yield value, path
    if isinstance(value, dict):
        for key, child in value.items():
            child_path = f"{path}.{key}" if path else key
            yield from walk_nodes(child, child_path)
    elif isinstance(value, list):
        for child in value:
            yield from walk_nodes(child, f"{path}[]")


def _is_definition(node: dict[str, Any], path: str) -> bool:
    return any(key in node for key in DEFINITION_KEYS) and (
        "dynamic_tools" in path or "inputSchema" in node or "parameters" in node
    )


def _is_call(node: dict[str, Any], path: str) -> bool:
    node_type = node.get("type")
    return node_type in CALL_TYPES or "invocation.tool" in path


def _candidate_role(node: dict[str, Any], path: str) -> str | None:
    if _is_definition(node, path):
        return "definition"
    if _is_call(node, path):
        return "call"
    return None


def inspect_events(events: Iterable[Any]) -> dict[str, Any]:
    path_counts: Counter[str] = Counter()
    discriminator_counts: dict[str, Counter[str]] = defaultdict(Counter)
    candidates: dict[tuple[str, str, str], Candidate] = {}
    event_count = 0

    for event in events:
        event_count += 1
        for node, path in walk_nodes(event):
            if not isinstance(node, dict):
                continue

            node_type = node.get("type")
            discriminator_path = f"{path}.type" if path else "type"
            if isinstance(node_type, str) and discriminator_path in {
                "type",
                "payload.type",
                "item.type",
                "response_item.type",
            }:
                discriminator_counts[discriminator_path][node_type] += 1

            for key in ("name", "tool", "tool_name"):
                raw_name = node.get(key)
                if not isinstance(raw_name, str):
                    continue

                candidate_path = f"{path}.{key}" if path else key
                role = _candidate_role(node, path)
                if role is None and key in {"tool", "tool_name"}:
                    role = "call"
                if role is None:
                    continue

                name = normalize_tool_name(raw_name)
                if name is None:
                    continue
                path_counts[candidate_path] += 1
                identity = (name, candidate_path, role)
                candidate = candidates.setdefault(
                    identity,
                    Candidate(name=name, path=candidate_path, role=role),
                )
                candidate.appearances += 1

    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for candidate in candidates.values():
        grouped[candidate.name].append(
            {
                "path": candidate.path,
                "role": candidate.role,
                "appearances": candidate.appearances,
            }
        )

    for values in grouped.values():
        values.sort(key=lambda value: (value["role"], value["path"]))

    return {
        "events_scanned": event_count,
        "event_discriminator_paths": {
            path: [
                {"type": name, "appearances": count}
                for name, count in sorted(values.items())
            ]
            for path, values in sorted(discriminator_counts.items())
        },
        "candidate_paths": [
            {"path": path, "appearances": count}
            for path, count in sorted(path_counts.items())
        ],
        "candidates_by_tool": {name: grouped[name] for name in sorted(grouped)},
    }


def load_events(sessions_dir: str) -> tuple[list[Any], int]:
    events: list[Any] = []
    files = glob.glob(os.path.join(sessions_dir, "**", "*.jsonl"), recursive=True)
    for file_path in files:
        try:
            with open(file_path, "r", encoding="utf-8", errors="ignore") as stream:
                for line in stream:
                    if not line.strip():
                        continue
                    try:
                        events.append(json.loads(line))
                    except json.JSONDecodeError:
                        continue
        except OSError:
            continue
    return events, len(files)


def render_markdown(report: dict[str, Any]) -> str:
    lines = [
        "# Codex Telemetry Structure Inspection",
        "",
        "This report contains structure and tool names only; payload contents are omitted.",
        "",
        f"- JSONL files scanned: {report['files_scanned']}",
        f"- Events scanned: {report['inspection']['events_scanned']}",
        "",
        "## Event discriminator paths",
        "",
    ]
    for path, values in report["inspection"]["event_discriminator_paths"].items():
        lines.extend([f"### `{path}`", "", "| Type | Appearances |", "|---|---:|"])
        lines.extend(f"| `{item['type']}` | {item['appearances']} |" for item in values)
        lines.append("")
    lines.extend(
        ["", "## Candidate tool paths", "", "| Path | Appearances |", "|---|---:|"]
    )
    lines.extend(
        f"| `{item['path']}` | {item['appearances']} |"
        for item in report["inspection"]["candidate_paths"]
    )
    lines.extend(
        [
            "",
            "## Candidate tools",
            "",
            "| Tool | Path | Role | Appearances |",
            "|---|---|---|---:|",
        ]
    )
    for name, occurrences in report["inspection"]["candidates_by_tool"].items():
        for occurrence in occurrences:
            lines.append(
                f"| `{name}` | `{occurrence['path']}` | {occurrence['role']} | "
                f"{occurrence['appearances']} |"
            )
    return "\n".join(lines) + "\n"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--codex-sessions-dir",
        default=os.path.expanduser(r"~\.codex\sessions"),
    )
    parser.add_argument("--output-dir", default="agent_tool_analysis")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    events, files_scanned = load_events(args.codex_sessions_dir)
    report = {
        "files_scanned": files_scanned,
        "inspection": inspect_events(events),
    }
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    with (output_dir / "codex_telemetry_inspection.json").open(
        "w", encoding="utf-8"
    ) as stream:
        json.dump(report, stream, indent=2, ensure_ascii=False)
    with (output_dir / "codex_telemetry_inspection.md").open(
        "w", encoding="utf-8"
    ) as stream:
        stream.write(render_markdown(report))
    print(
        f"JSON report:     {(output_dir / 'codex_telemetry_inspection.json').resolve()}"
    )
    print(
        f"Markdown report: {(output_dir / 'codex_telemetry_inspection.md').resolve()}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
