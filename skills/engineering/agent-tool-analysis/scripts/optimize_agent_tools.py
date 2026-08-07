#!/usr/bin/env python3
"""
Telemetry-driven tool exposure optimizer for agentic coding workflows.

Goals
-----
1. Preserve agent quality by treating historical tool usage as coverage evidence.
2. Identify tool groups that are plausible specialist-agent boundaries.
3. Estimate how much exposed tool-definition overhead could be removed from the
   parent agent.
4. Keep dependencies at zero: Python standard library only.

Supported telemetry
-------------------
- GitHub Copilot / VS Code debug logs
- OpenAI Codex session JSONL

This script is advisory. It does not modify agent configuration.

Examples
--------
    python optimize_agent_tools.py

    python optimize_agent_tools.py --output-dir tool_analysis

    python optimize_agent_tools.py ^
        --similarity-threshold 0.35 ^
        --global-usage-threshold 0.60 ^
        --min-tool-sessions 3

Optional explicit tool costs
----------------------------
Pass a JSON file with per-tool token costs:

    {
      "read_file": 420,
      "grep_search": 610,
      "some/tool": {"tokens": 1250}
    }

Then run:

    python optimize_agent_tools.py --tool-costs tool_costs.json

Notes on token estimates
------------------------
When an actual tool definition/schema can be recovered from telemetry, this
script estimates tokens as ceil(serialized_characters / 4). That is only a
portable approximation, not tokenizer-exact accounting.

Explicit --tool-costs values always override recovered estimates.
"""

from __future__ import annotations

import argparse
import glob
import json
import math
import os
import re
import statistics
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

from tool_definition_registry import (
    DefinitionRecord,
    DefinitionRegistry,
    ExplicitDefinitionProvider,
    ManifestDefinitionProvider,
    MappingDefinitionProvider,
    legacy_record,
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

IGNORED_PATTERNS = [
    r"^turn_(start|end):?",
    r"^session_start$",
    r"^chat:",
    r"^user_message$",
    r"^agent_response$",
    r".*Discovery$",
    r"^Custom Instructions$",
    r"^Resolve Customizations$",
    r"^PreToolUse$",
    r"^PostToolUse$",
]
IGNORE_REGEX = re.compile("|".join(IGNORED_PATTERNS), re.IGNORECASE)

TOOL_REMAP = {
    "memory": "vscode/memory",
    "runSubagent": "agent",
    "runTests": "execute/runTests",
}

TOOL_NAME_REGEX = re.compile(
    r'"tool_name"\s*:\s*"([^"]+)"|'
    r'"(?:tool|function)"\s*:\s*\{\s*"name"\s*:\s*"([^"]+)"'
)

DEFINITION_KEYS = {
    "description",
    "input_schema",
    "inputSchema",
    "parameters",
    "schema",
    "args_schema",
    "arguments_schema",
}

# These are operational hints, not automatic "global" assignments.
KNOWN_DEPENDENCIES = {
    "apply_patch": {"execute/runTests", "create_file"},
    "edit": {"execute/runTests", "create_file"},
    "spawn_agent": {"list_agents", "wait_agent", "interrupt_agent", "followup_task"},
    "list_dir": {"file_search", "grep_search"},
    "exec": {"send_message", "wait"},
}


@dataclass
class Session:
    session_id: str
    source: str
    calls: list[str] = field(default_factory=list)
    exposed_tools: set[str] = field(default_factory=set)
    exposure_source: str = "not_observed"
    provider_availability: set[str] = field(default_factory=set)
    provider_tools: dict[str, set[str]] = field(default_factory=dict)

    @property
    def directly_observed_exposure(self) -> set[str]:
        """Tool definitions directly observed as exposed in this session."""
        return self.exposed_tools

    @property
    def actual_calls(self) -> list[str]:
        """Tool calls observed in this session; never an exposure proxy."""
        return self.calls

    @property
    def tool_set(self) -> set[str]:
        return set(self.actual_calls)


@dataclass
class ToolDefinition:
    name: str
    serialized_chars: int | None
    estimated_tokens: int | None
    source: str
    runtime: str = "unknown"
    provider: str = "unknown"
    raw_name: str | None = None
    description: str | None = None
    input_schema: Any = None
    confidence: str = "unknown"
    evidence_type: str = "unknown"


@dataclass
class ToolStat:
    name: str
    sessions: int = 0
    calls: int = 0
    sessions_exposed: int = 0
    sessions_called: int = 0
    usage_rate: float = 0.0
    call_given_exposed: float | None = None
    expected_unused_tokens_per_session: float | None = None
    definition_tokens: int | None = None
    definition_cost_source: str = "unknown"
    estimated_cost_low: float | None = None
    estimated_cost_mid: float | None = None
    estimated_cost_high: float | None = None
    estimation_basis: str | None = None
    estimation_confidence: str | None = None


def normalize_tool_name(raw_name: str | None) -> str | None:
    if not raw_name or not isinstance(raw_name, str):
        return None

    raw_name = raw_name.strip()
    if not raw_name or IGNORE_REGEX.search(raw_name):
        return None

    clean_name = raw_name.strip(" \"'")

    if clean_name.startswith("runSubagent-"):
        return "agent"

    clean_name = TOOL_REMAP.get(clean_name, clean_name)

    if IGNORE_REGEX.search(clean_name):
        return None

    return clean_name


def estimate_tokens_from_chars(char_count: int) -> int:
    # Portable approximation. Exact tokenizer accounting is runtime/model specific.
    return max(1, math.ceil(char_count / 4))


def canonical_json_length(value: Any) -> int:
    try:
        text = json.dumps(
            value,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
        )
    except (TypeError, ValueError):
        text = repr(value)
    return len(text)


def walk_json(value: Any) -> Iterable[Any]:
    yield value
    if isinstance(value, dict):
        for child in value.values():
            yield from walk_json(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk_json(child)


def extract_tool_definitions(event: Any, source: str) -> list[ToolDefinition]:
    """
    Best-effort extraction of full tool definitions from arbitrary JSON events.

    A dict is treated as a possible tool definition when it has a string `name`
    and at least one schema/description-like key.
    """
    found: list[ToolDefinition] = []

    for node in walk_json(event):
        if not isinstance(node, dict):
            continue

        raw_name = node.get("name")
        if not isinstance(raw_name, str):
            continue

        if not any(key in node for key in DEFINITION_KEYS):
            continue

        name = normalize_tool_name(raw_name)
        if not name:
            continue

        definition_subset = {"name": raw_name}
        for key in DEFINITION_KEYS:
            if key in node:
                definition_subset[key] = node[key]

        chars = canonical_json_length(definition_subset)
        found.append(
            ToolDefinition(
                name=name,
                serialized_chars=chars,
                estimated_tokens=estimate_tokens_from_chars(chars),
                source=source,
                runtime=source,
                provider="telemetry",
                raw_name=raw_name,
                description=(
                    node.get("description")
                    if isinstance(node.get("description"), str)
                    else None
                ),
                input_schema=node.get("inputSchema", node.get("input_schema")),
                confidence="direct_telemetry",
                evidence_type="recovered_definition",
            )
        )

    return found


def find_raw_tool_call(event: Any) -> str | None:
    if not isinstance(event, dict):
        return None

    for key in ("tool_name",):
        value = event.get(key)
        if isinstance(value, str):
            return value

    item = event.get("item")
    if isinstance(item, dict):
        if item.get("type") in {"function_call", "tool_call", "mcp_call"}:
            value = item.get("name") or item.get("function")
            if isinstance(value, str):
                return value

    payload = event.get("payload")
    if isinstance(payload, dict):
        payload_type = payload.get("type")
        if payload_type in {"custom_tool_call", "function_call", "mcp_tool_call"}:
            value = payload.get("name")
            if isinstance(value, str):
                return value

        invocation = payload.get("invocation")
        if isinstance(invocation, dict):
            value = invocation.get("tool")
            if isinstance(value, str):
                return value

        # Avoid treating arbitrary payload "name" fields as tool calls unless
        # there is some tool/function-call context.
        payload_type = str(payload_type or "").lower()
        if (
            "tool" in payload_type
            or "function" in payload_type
            or "call" in payload_type
            or "tool" in event
            or "tool_name" in event
        ):
            value = (
                payload.get("name") or payload.get("tool") or payload.get("tool_name")
            )
            if isinstance(value, str):
                return value

    tool = event.get("tool")
    if isinstance(tool, str):
        return tool

    if isinstance(tool, dict):
        value = tool.get("name")
        if isinstance(value, str):
            return value

    function = event.get("function")
    if isinstance(function, dict):
        value = function.get("name")
        if isinstance(value, str):
            return value

    return None


CODEX_CALL_TYPES = {"custom_tool_call", "function_call", "mcp_tool_call"}


def extract_codex_calls(event: Any) -> list[str]:
    """Extract calls from the empirically observed Codex payload paths."""
    if not isinstance(event, dict):
        return []

    payload = event.get("payload")
    if not isinstance(payload, dict):
        return []

    calls: list[str] = []
    if payload.get("type") in CODEX_CALL_TYPES:
        name = payload.get("name")
        if isinstance(name, str):
            calls.append(name)

    invocation = payload.get("invocation")
    if isinstance(invocation, dict):
        name = invocation.get("tool")
        if isinstance(name, str):
            calls.append(name)

    return calls


def extract_codex_exposures(event: Any) -> set[str]:
    """Extract only direct exposure evidence from Codex session metadata."""
    if not isinstance(event, dict):
        return set()

    payload = event.get("payload")
    if not isinstance(payload, dict):
        return set()

    dynamic_tools = payload.get("dynamic_tools")
    if not isinstance(dynamic_tools, list):
        return set()

    exposed: set[str] = set()
    for group in dynamic_tools:
        if not isinstance(group, dict):
            continue
        tools = group.get("tools")
        if not isinstance(tools, list):
            continue
        for tool in tools:
            if not isinstance(tool, dict):
                continue
            name = normalize_tool_name(tool.get("name"))
            if name:
                exposed.add(name)
    return exposed


def normalize_provider_name(raw_name: Any) -> str | None:
    if not isinstance(raw_name, str):
        return None
    name = raw_name.strip()
    return name or None


def extract_codex_provider_metadata(
    event: Any,
) -> tuple[set[str], dict[str, set[str]]]:
    """Extract provider availability and direct provider/tool memberships.

    A provider is considered available only when a Codex dynamic-tool group
    names it in telemetry. Calls, tool-name prefixes, and missing calls are not
    provider-availability evidence.
    """
    if not isinstance(event, dict):
        return set(), {}

    payload = event.get("payload")
    if not isinstance(payload, dict):
        return set(), {}

    dynamic_tools = payload.get("dynamic_tools")
    if not isinstance(dynamic_tools, list):
        return set(), {}

    providers: set[str] = set()
    provider_tools: dict[str, set[str]] = defaultdict(set)
    for group in dynamic_tools:
        if not isinstance(group, dict):
            continue
        provider = normalize_provider_name(
            group.get("provider") or group.get("name") or group.get("id")
        )
        if not provider:
            continue
        providers.add(provider)
        tools = group.get("tools")
        if not isinstance(tools, list):
            continue
        for tool in tools:
            if not isinstance(tool, dict):
                continue
            name = normalize_tool_name(tool.get("name"))
            if name:
                provider_tools[provider].add(name)

    return providers, dict(provider_tools)


def get_vscode_sessions(
    workspace_storage: str,
) -> tuple[list[Session], dict[str, ToolDefinition]]:
    sessions: list[Session] = []
    definitions: dict[str, ToolDefinition] = {}

    if not os.path.exists(workspace_storage):
        return sessions, definitions

    pattern = os.path.join(
        workspace_storage,
        "*",
        "github.copilot-chat",
        "debug-logs",
        "*",
        "*.jsonl",
    )

    files = glob.glob(pattern, recursive=True)

    for file_path in files:
        session_id = f"vscode:{os.path.relpath(file_path, workspace_storage)}"
        calls: list[str] = []

        try:
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                for line in f:
                    if not line.strip():
                        continue

                    # Regex fallback catches some debug records that are not
                    # represented in a stable structured schema.
                    for match in TOOL_NAME_REGEX.findall(line):
                        tool_name = normalize_tool_name(match[0] or match[1])
                        if tool_name:
                            calls.append(tool_name)

                    try:
                        event = json.loads(line)
                    except json.JSONDecodeError:
                        continue

                    raw_tool = find_raw_tool_call(event)
                    tool_name = normalize_tool_name(raw_tool)
                    if tool_name:
                        # Avoid immediate duplicate caused by regex + structured
                        # parsing of the same record.
                        if not calls or calls[-1] != tool_name:
                            calls.append(tool_name)

                    for definition in extract_tool_definitions(event, "vscode"):
                        existing = definitions.get(definition.name)
                        if (
                            existing is None
                            or (
                                definition.serialized_chars is not None
                                and (
                                    existing.serialized_chars is None
                                    or definition.serialized_chars > existing.serialized_chars
                                )
                            )
                        ):
                            definitions[definition.name] = definition

        except OSError:
            continue

        if calls:
            sessions.append(
                Session(session_id=session_id, source="vscode", calls=calls)
            )

    return sessions, definitions


def get_codex_sessions(
    sessions_dir: str,
) -> tuple[list[Session], dict[str, ToolDefinition]]:
    sessions: list[Session] = []
    definitions: dict[str, ToolDefinition] = {}

    if not os.path.exists(sessions_dir):
        return sessions, definitions

    pattern = os.path.join(sessions_dir, "**", "*.jsonl")
    files = glob.glob(pattern, recursive=True)

    for file_path in files:
        session_id = f"codex:{os.path.relpath(file_path, sessions_dir)}"
        calls: list[str] = []
        exposed_tools: set[str] = set()
        provider_availability: set[str] = set()
        provider_tools: dict[str, set[str]] = defaultdict(set)

        try:
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                for line in f:
                    if not line.strip():
                        continue

                    try:
                        event = json.loads(line)
                    except json.JSONDecodeError:
                        continue

                    for raw_tool in extract_codex_calls(event):
                        tool_name = normalize_tool_name(raw_tool)
                        if tool_name:
                            calls.append(tool_name)

                    exposed_tools.update(extract_codex_exposures(event))
                    event_providers, event_provider_tools = (
                        extract_codex_provider_metadata(event)
                    )
                    provider_availability.update(event_providers)
                    for provider, tools in event_provider_tools.items():
                        provider_tools[provider].update(tools)

                    for definition in extract_tool_definitions(event, "codex"):
                        existing = definitions.get(definition.name)
                        if (
                            existing is None
                            or (
                                definition.serialized_chars is not None
                                and (
                                    existing.serialized_chars is None
                                    or definition.serialized_chars > existing.serialized_chars
                                )
                            )
                        ):
                            definitions[definition.name] = definition

        except OSError:
            continue

        if calls or exposed_tools:
            sessions.append(
                Session(
                    session_id=session_id,
                    source="codex",
                    calls=calls,
                    exposed_tools=exposed_tools,
                    provider_availability=provider_availability,
                    provider_tools=dict(provider_tools),
                    exposure_source=(
                        "codex:payload.dynamic_tools[].tools[].name"
                        if exposed_tools
                        else "not_observed"
                    ),
                )
            )

    return sessions, definitions


def definition_from_record(record: DefinitionRecord) -> ToolDefinition:
    """Adapt the registry model to the optimizer's historical cost model."""
    return ToolDefinition(
        name=record.normalized_name,
        serialized_chars=record.serialized_chars,
        estimated_tokens=record.estimated_tokens,
        source=record.source,
        runtime=record.runtime,
        provider=record.provider,
        raw_name=record.raw_name,
        description=record.description,
        input_schema=record.input_schema,
        confidence=record.confidence,
        evidence_type=record.evidence_type,
    )


def acquire_definitions(
    observed_names: Iterable[str],
    vscode_definitions: dict[str, ToolDefinition],
    codex_definitions: dict[str, ToolDefinition],
    explicit_path: str | None,
    definition_roots: Iterable[str],
) -> tuple[dict[str, ToolDefinition], DefinitionRegistry, ManifestDefinitionProvider, dict[str, Any]]:
    """Resolve definitions without treating a call as exposure evidence."""
    explicit_provider = ExplicitDefinitionProvider.from_path(
        explicit_path, normalize_tool_name
    )
    telemetry_records = [
        legacy_record(definition, runtime="vscode")
        for definition in vscode_definitions.values()
    ] + [
        legacy_record(definition, runtime="codex")
        for definition in codex_definitions.values()
    ]
    telemetry_provider = MappingDefinitionProvider(telemetry_records, precedence=200)
    manifest_provider = ManifestDefinitionProvider(
        definition_roots, normalize_tool_name, runtime="codex"
    )
    registry = DefinitionRegistry(
        [explicit_provider, telemetry_provider, manifest_provider]
    )

    records = registry.resolve_all(observed_names)
    definitions = {
        name: definition_from_record(record) for name, record in records.items()
    }
    explicit_costs = {
        record.normalized_name: record.estimated_tokens
        for record in explicit_provider.records()
        if record.estimated_tokens is not None
    }
    return (
        definitions,
        registry,
        manifest_provider,
        {
            "explicit_records": len(explicit_costs),
            "telemetry_records": len(telemetry_records),
            "runtime_manifest": manifest_provider.discovery_summary(),
        },
    )


def load_explicit_tool_costs(path: str | None) -> dict[str, int]:
    if not path:
        return {}

    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    if not isinstance(data, dict):
        raise ValueError("--tool-costs must contain a JSON object.")

    costs: dict[str, int] = {}
    for raw_name, raw_value in data.items():
        name = normalize_tool_name(raw_name)
        if not name:
            continue

        if isinstance(raw_value, int):
            tokens = raw_value
        elif isinstance(raw_value, dict) and isinstance(raw_value.get("tokens"), int):
            tokens = raw_value["tokens"]
        else:
            raise ValueError(
                f'Invalid token cost for {raw_name!r}; expected integer or {{"tokens": int}}.'
            )

        if tokens < 0:
            raise ValueError(f"Token cost for {raw_name!r} cannot be negative.")

        costs[name] = tokens

    return costs


def build_stats(
    sessions: list[Session],
    definitions: dict[str, ToolDefinition],
    explicit_costs: dict[str, int],
    *,
    call_sessions: list[Session] | None = None,
    exposure_sessions: list[Session] | None = None,
) -> dict[str, ToolStat]:
    call_sessions = call_sessions if call_sessions is not None else [
        session for session in sessions if session.calls
    ]
    exposure_sessions = exposure_sessions if exposure_sessions is not None else [
        session for session in sessions if session.exposed_tools
    ]
    session_counts = Counter()
    call_counts = Counter()
    exposure_counts = Counter()
    called_in_exposed_counts = Counter()

    for session in call_sessions:
        session_counts.update(session.tool_set)
        call_counts.update(session.calls)

    for session in exposure_sessions:
        exposure_counts.update(session.exposed_tools)
        called_in_exposed_counts.update(session.tool_set & session.exposed_tools)

    total_call_sessions = len(call_sessions)
    total_exposure_sessions = len(exposure_sessions)
    names = sorted(
        set(session_counts)
        | set(exposure_counts)
        | set(definitions)
        | set(explicit_costs)
    )

    stats: dict[str, ToolStat] = {}
    for name in names:
        definition_tokens = None
        cost_source = "unknown"

        if name in definitions:
            definition_tokens = definitions[name].estimated_tokens
            definition = definitions[name]
            if definition.provider == "explicit":
                cost_source = definition.source
            else:
                cost_source = f"{definition.provider}:{definition.source}:chars/4"

        if name in explicit_costs:
            definition_tokens = explicit_costs[name]
            cost_source = "explicit"

        stats[name] = ToolStat(
            name=name,
            sessions=session_counts[name],
            calls=call_counts[name],
            sessions_exposed=exposure_counts[name],
            sessions_called=session_counts[name],
            usage_rate=(
                session_counts[name] / total_call_sessions
                if total_call_sessions
                else 0.0
            ),
            call_given_exposed=(
                called_in_exposed_counts[name] / exposure_counts[name]
                if exposure_counts[name]
                else None
            ),
            definition_tokens=definition_tokens,
            definition_cost_source=cost_source,
        )

        if definition_tokens is not None:
            stats[name].expected_unused_tokens_per_session = (
                definition_tokens
                * (exposure_counts[name] - called_in_exposed_counts[name])
                / total_exposure_sessions
                if total_exposure_sessions
                else 0.0
            )

    infer_unresolved_costs(stats)
    return stats


ESTIMATION_BASIS = (
    "global distribution of resolved definition tokens "
    "(25th percentile / median / 75th percentile)"
)


def infer_unresolved_costs(stats: dict[str, ToolStat]) -> None:
    """Attach empirical scenarios without changing observed definition costs."""
    resolved_costs = [
        stat.definition_tokens
        for stat in stats.values()
        if stat.definition_tokens is not None
    ]
    if not resolved_costs:
        return

    estimates = {
        "low": percentile(resolved_costs, 0.25),
        "mid": percentile(resolved_costs, 0.50),
        "high": percentile(resolved_costs, 0.75),
    }
    for stat in stats.values():
        if stat.definition_tokens is not None:
            continue
        if stat.calls == 0 and stat.sessions_exposed == 0:
            continue
        stat.estimated_cost_low = estimates["low"]
        stat.estimated_cost_mid = estimates["mid"]
        stat.estimated_cost_high = estimates["high"]
        stat.estimation_basis = ESTIMATION_BASIS
        stat.estimation_confidence = "low"


def session_population_summary(sessions: list[Session]) -> dict[str, int]:
    """Describe union, call-bearing, and directly observed exposure populations."""
    with_calls = [session for session in sessions if session.calls]
    with_exposure = [session for session in sessions if session.exposed_tools]
    return {
        "sessions_total": len(sessions),
        "sessions_with_calls": len(with_calls),
        "sessions_with_direct_exposure": len(with_exposure),
        "sessions_with_calls_and_exposure": sum(
            bool(session.calls and session.exposed_tools) for session in sessions
        ),
        "sessions_with_calls_without_exposure": sum(
            bool(session.calls and not session.exposed_tools) for session in sessions
        ),
        "sessions_with_exposure_without_calls": sum(
            bool(session.exposed_tools and not session.calls) for session in sessions
        ),
    }


def build_session_index(sessions: list[Session]) -> dict[str, set[int]]:
    index: dict[str, set[int]] = defaultdict(set)
    for i, session in enumerate(sessions):
        for tool in session.tool_set:
            index[tool].add(i)
    return dict(index)


def build_adjacency_counts(sessions: list[Session]) -> Counter[tuple[str, str]]:
    counts: Counter[tuple[str, str]] = Counter()
    for session in sessions:
        for left, right in zip(session.calls, session.calls[1:]):
            if left == right:
                continue
            pair = pair_key(left, right)
            counts[pair] += 1
    return counts


def pair_metrics(
    a: str,
    b: str,
    session_index: dict[str, set[int]],
    adjacency: Counter[tuple[str, str]],
) -> dict[str, float]:
    sa = session_index.get(a, set())
    sb = session_index.get(b, set())

    intersection = len(sa & sb)
    union = len(sa | sb)
    jaccard = intersection / union if union else 0.0

    min_support = min(len(sa), len(sb))
    overlap = intersection / min_support if min_support else 0.0

    pair = pair_key(a, b)
    adjacent = adjacency[pair]
    adjacency_rate = adjacent / min_support if min_support else 0.0
    adjacency_rate = min(1.0, adjacency_rate)

    # Co-occurrence dominates. Ordered adjacency acts as evidence that the tools
    # are operationally coupled rather than merely appearing in the same task.
    affinity = 0.55 * jaccard + 0.30 * overlap + 0.15 * adjacency_rate

    return {
        "co_sessions": intersection,
        "jaccard": jaccard,
        "overlap": overlap,
        "adjacency_count": adjacent,
        "adjacency_rate": adjacency_rate,
        "affinity": affinity,
    }


def pair_key(left: str, right: str) -> tuple[str, str]:
    return (left, right) if left <= right else (right, left)


def all_pair_metrics(
    active_tools: list[str],
    session_index: dict[str, set[int]],
    adjacency: Counter[tuple[str, str]],
) -> dict[tuple[str, str], dict[str, float]]:
    result = {}
    for i, a in enumerate(active_tools):
        for b in active_tools[i + 1 :]:
            result[(a, b)] = pair_metrics(a, b, session_index, adjacency)
    return result


def cluster_affinity(
    left: set[str],
    right: set[str],
    pairs: dict[tuple[str, str], dict[str, float]],
) -> float:
    values = []
    for a in left:
        for b in right:
            key = pair_key(a, b)
            if key in pairs:
                values.append(pairs[key]["affinity"])
    return statistics.fmean(values) if values else 0.0


def agglomerative_clusters(
    tools: list[str],
    pairs: dict[tuple[str, str], dict[str, float]],
    threshold: float,
) -> list[set[str]]:
    """
    Dependency-free average-link agglomerative clustering.

    Starts with one tool per cluster and greedily merges the pair of clusters
    with the highest average cross-cluster affinity until the best remaining
    affinity is below threshold.
    """
    clusters = [{tool} for tool in tools]

    while len(clusters) > 1:
        best_score = -1.0
        best_pair: tuple[int, int] | None = None

        for i in range(len(clusters)):
            for j in range(i + 1, len(clusters)):
                score = cluster_affinity(clusters[i], clusters[j], pairs)
                if score > best_score:
                    best_score = score
                    best_pair = (i, j)

        if best_pair is None or best_score < threshold:
            break

        i, j = best_pair
        merged = clusters[i] | clusters[j]
        clusters = [cluster for k, cluster in enumerate(clusters) if k not in {i, j}]
        clusters.append(merged)

    return sorted(clusters, key=lambda c: (-len(c), sorted(c)))


def cluster_internal_affinity(
    cluster: set[str],
    pairs: dict[tuple[str, str], dict[str, float]],
) -> float:
    if len(cluster) < 2:
        return 0.0

    values = []
    tools = sorted(cluster)
    for i, a in enumerate(tools):
        for b in tools[i + 1 :]:
            key = pair_key(a, b)
            if key in pairs:
                values.append(pairs[key]["affinity"])

    return statistics.fmean(values) if values else 0.0


def tool_boundary_metrics(
    tool: str,
    cluster: set[str],
    pairs: dict[tuple[str, str], dict[str, float]],
    all_clustered_tools: Iterable[str],
) -> dict[str, float]:
    internal_values = [
        pairs[pair_key(tool, other)]["affinity"]
        for other in cluster
        if other != tool and pair_key(tool, other) in pairs
    ]
    external_values = [
        pairs[pair_key(tool, other)]["affinity"]
        for other in all_clustered_tools
        if other not in cluster and pair_key(tool, other) in pairs
    ]
    mean_internal = statistics.fmean(internal_values) if internal_values else 0.0
    best_external = max(external_values) if external_values else 0.0
    return {
        "mean_internal_affinity": mean_internal,
        "best_external_affinity": best_external,
        "boundary_margin": mean_internal - best_external,
    }


def cluster_boundary_metrics(
    cluster: set[str],
    clusters: list[set[str]],
    pairs: dict[tuple[str, str], dict[str, float]],
    all_clustered_tools: Iterable[str],
    session_index: dict[str, set[int]],
    sessions: list[Session],
) -> dict[str, float]:
    tool_metrics = [
        tool_boundary_metrics(tool, cluster, pairs, all_clustered_tools)
        for tool in cluster
    ]
    external_values = [
        metric["best_external_affinity"]
        for metric in tool_metrics
        if metric["best_external_affinity"] > 0
    ]
    covered = set().union(*(session_index.get(tool, set()) for tool in cluster))
    cluster_session_sets = [
        set().union(*(session_index.get(tool, set()) for tool in candidate))
        for candidate in clusters
    ]
    cluster_position = clusters.index(cluster)
    other_sessions = set().union(
        *(
            value
            for i, value in enumerate(cluster_session_sets)
            if i != cluster_position
        )
    )
    exclusive = len(covered - other_sessions)
    overlapping = len(covered & other_sessions)
    return {
        "internal_affinity": cluster_internal_affinity(cluster, pairs),
        "max_external_affinity": max(external_values) if external_values else 0.0,
        "mean_boundary_margin": statistics.fmean(
            metric["boundary_margin"] for metric in tool_metrics
        )
        if tool_metrics
        else 0.0,
        "session_coverage": len(covered) / len(sessions) if sessions else 0.0,
        "exclusive_session_coverage": exclusive / len(sessions) if sessions else 0.0,
        "overlapping_session_coverage": overlapping / len(sessions)
        if sessions
        else 0.0,
    }


def build_exposure_matrix(
    sessions: list[Session],
    stats: dict[str, ToolStat],
) -> list[dict[str, Any]]:
    """Return only observed session/tool states; absent pairs are implicit zeroes."""
    matrix: list[dict[str, Any]] = []
    for session in sessions:
        observed_names = sorted(session.exposed_tools | session.tool_set)
        for name in observed_names:
            if name not in stats:
                continue
            stat = stats[name]
            matrix.append(
                {
                    "session_id": session.session_id,
                    "tool_name": name,
                    "directly_observed_exposure": name in session.directly_observed_exposure,
                    "actual_call": name in session.actual_calls,
                    "exposed": name in session.exposed_tools,
                    "called": name in session.tool_set,
                    "call_count": session.calls.count(name),
                    "definition_tokens": stat.definition_tokens,
                    "definition_source": stat.definition_cost_source,
                    "exposure_source": (
                        session.exposure_source
                        if name in session.exposed_tools
                        else "not_observed"
                    ),
                }
            )
    return matrix


def exposure_matrix_summary(
    sessions: list[Session],
    stats: dict[str, ToolStat],
) -> dict[str, int]:
    """Return aggregate dimensions for the sparse exposure matrix."""
    return {
        "sessions": len(sessions),
        "known_tools": len(stats),
        "possible_rows": len(sessions) * len(stats),
        "observed_rows": len(build_exposure_matrix(sessions, stats)),
    }


def exposure_consistency(
    sessions: list[Session],
) -> dict[str, int]:
    calls_without_direct_exposure = sum(
        1
        for session in sessions
        for tool in session.actual_calls
        if tool not in session.directly_observed_exposure
    )
    return {
        "sessions_with_direct_exposure": sum(bool(s.exposed_tools) for s in sessions),
        "sessions_without_direct_exposure": sum(not s.exposed_tools for s in sessions),
        "called_tools_without_direct_exposure": calls_without_direct_exposure,
    }


def exposure_model_summary(sessions: list[Session]) -> list[dict[str, Any]]:
    """Summarize direct and inferred exposure without merging them."""
    runtime_tools = observed_runtime_tools(sessions)
    provider_by_tool = provider_families_by_tool(sessions)
    rows = []
    for model in EXPOSURE_MODELS:
        states = {
            session.session_id: baseline_exposure_state(
                session,
                model,
                runtime_tools,
                provider_by_tool,
            )
            for session in sessions
        }
        rows.append(
            {
                "model": model,
                "description": EXPOSURE_MODEL_DESCRIPTIONS[model],
                "sessions": len(sessions),
                "runtime_tool_catalog_size": len(runtime_tools),
                "sessions_with_inferred_exposure": sum(
                    bool(states[session.session_id].inferred_baseline_exposure)
                    for session in sessions
                ),
                "inferred_exposure_rows": sum(
                    len(states[session.session_id].inferred_baseline_exposure)
                    for session in sessions
                ),
                "sessions_with_provider_availability": sum(
                    bool(session.provider_availability) for session in sessions
                ),
            }
        )
    return rows


def percentile(values: list[int], q: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    if len(ordered) == 1:
        return float(ordered[0])

    pos = (len(ordered) - 1) * q
    low = math.floor(pos)
    high = math.ceil(pos)
    if low == high:
        return float(ordered[low])

    frac = pos - low
    return ordered[low] * (1 - frac) + ordered[high] * frac


def classify_tools(
    stats: dict[str, ToolStat],
    global_usage_threshold: float,
) -> dict[str, str]:
    known_costs = [
        stat.definition_tokens
        for stat in stats.values()
        if stat.definition_tokens is not None
    ]
    high_cost_threshold = percentile(known_costs, 0.75)

    result = {}
    for name, stat in stats.items():
        expensive = (
            high_cost_threshold is not None
            and stat.definition_tokens is not None
            and stat.definition_tokens >= high_cost_threshold
        )

        if stat.usage_rate >= global_usage_threshold:
            if expensive:
                result[name] = (
                    "ubiquitous-expensive: keep available, compress definition first"
                )
            else:
                result[name] = "global-candidate: ubiquitous"
        elif stat.definition_tokens is None:
            result[name] = "specialization-candidate: cost unknown"
        elif expensive:
            result[name] = (
                "strong-specialization-candidate: expensive and non-ubiquitous"
            )
        else:
            result[name] = "specialization-candidate"

    return result


def choose_global_tools(
    stats: dict[str, ToolStat],
    global_usage_threshold: float,
) -> set[str]:
    return {
        name
        for name, stat in stats.items()
        if stat.usage_rate >= global_usage_threshold
    }


def make_candidate_agents(
    clusters: list[set[str]],
    global_tools: set[str],
    stats: dict[str, ToolStat],
    sessions: list[Session],
    pairs: dict[tuple[str, str], dict[str, float]],
    min_cluster_size: int,
    min_cluster_sessions: int,
) -> list[dict[str, Any]]:
    agents = []

    for cluster_index, cluster in enumerate(clusters, start=1):
        cluster_id = f"cluster_{cluster_index:02d}"
        specialist_tools = set(cluster) - global_tools
        if len(specialist_tools) < min_cluster_size:
            continue

        covered_sessions = sum(
            1 for session in sessions if session.tool_set & specialist_tools
        )
        if covered_sessions < min_cluster_sessions:
            continue

        tools_sorted = sorted(
            specialist_tools,
            key=lambda t: (-stats[t].sessions, t),
        )

        unknown_cost_tools = sorted(
            t for t in specialist_tools if stats[t].definition_tokens is None
        )

        agents.append(
            {
                "candidate_id": cluster_id,
                "cluster_id": cluster_id,
                "tools": tools_sorted,
                "session_coverage_count": covered_sessions,
                "session_coverage_rate": covered_sessions / len(sessions)
                if sessions
                else 0.0,
                "internal_affinity": cluster_internal_affinity(specialist_tools, pairs),
                "known_definition_tokens": sum(
                    stats[t].definition_tokens or 0
                    for t in specialist_tools
                    if stats[t].definition_tokens is not None
                ),
                "unknown_cost_tools": unknown_cost_tools,
            }
        )

    return agents


def dependency_warnings(
    candidate_agents: list[dict[str, Any]],
    global_tools: set[str],
    all_tools: set[str],
) -> list[dict[str, Any]]:
    warnings = []

    for agent in candidate_agents:
        tools = set(agent["tools"])
        missing = defaultdict(list)

        for tool in tools:
            for dep in KNOWN_DEPENDENCIES.get(tool, set()):
                if dep in all_tools and dep not in tools and dep not in global_tools:
                    missing[tool].append(dep)

        if missing:
            warnings.append(
                {
                    "candidate_id": agent["candidate_id"],
                    "missing_dependencies": {
                        tool: sorted(deps) for tool, deps in sorted(missing.items())
                    },
                }
            )

    return warnings


COST_SCENARIOS = ("low", "mid", "high")
EXPOSURE_MODELS = ("observed_only", "all_runtime_tools", "provider_scoped")
EXPOSURE_MODEL_DESCRIPTIONS = {
    "observed_only": (
        "Lower bound: charge only directly observed parent exposure; never use calls as exposure evidence."
    ),
    "all_runtime_tools": (
        "Counterfactual: expose every observed Codex runtime tool on the parent in every applicable Codex session."
    ),
    "provider_scoped": (
        "Counterfactual: expose tools in providers explicitly marked available by Codex dynamic-tool telemetry."
    ),
}


def expected_known_token_cost(
    sessions: list[Session],
    stats: dict[str, ToolStat],
    global_tools: set[str],
    candidate_agents: list[dict[str, Any]],
    delegation_overhead_tokens: int,
    *,
    exposure_sessions: list[Session] | None = None,
) -> dict[str, Any]:
    exposure_sessions = exposure_sessions if exposure_sessions is not None else [
        session for session in sessions if session.exposed_tools
    ]
    known_tools = {
        name for name, stat in stats.items() if stat.definition_tokens is not None
    }

    baseline_known_tokens = (
        statistics.fmean(
            sum(
                stats[name].definition_tokens or 0
                for name in session.exposed_tools
                if name in known_tools
            )
            for session in exposure_sessions
        )
        if exposure_sessions
        else 0.0
    )

    specialist_membership = {}
    for agent in candidate_agents:
        for tool in agent["tools"]:
            specialist_membership[tool] = agent["candidate_id"]

    # Conservative quality-preserving assumption:
    # any tool not placed in a specialist remains exposed on the parent.
    parent_tools = {
        tool for tool in known_tools if tool not in specialist_membership
    } | (global_tools & known_tools)

    agent_known_cost = {
        agent["candidate_id"]: sum(
            stats[t].definition_tokens or 0 for t in agent["tools"] if t in known_tools
        )
        for agent in candidate_agents
    }

    per_session_costs = []
    specialist_counts = []

    for session in exposure_sessions:
        activated = {
            specialist_membership[tool]
            for tool in session.tool_set
            if tool in specialist_membership
        }

        cost = sum(
            stats[name].definition_tokens or 0
            for name in session.exposed_tools
            if name in parent_tools
        )
        for candidate_id in activated:
            cost += agent_known_cost[candidate_id]
            cost += delegation_overhead_tokens

        per_session_costs.append(cost)
        specialist_counts.append(len(activated))

    expected_cost = statistics.fmean(per_session_costs) if per_session_costs else 0.0

    expected_savings = baseline_known_tokens - expected_cost
    expected_savings_rate = (
        expected_savings / baseline_known_tokens if baseline_known_tokens else None
    )
    cost_scenarios = expected_token_cost_scenarios(
        sessions=sessions,
        stats=stats,
        global_tools=global_tools,
        candidate_agents=candidate_agents,
        delegation_overhead_tokens=delegation_overhead_tokens,
        exposure_sessions=exposure_sessions,
    )
    cost_scenarios_by_exposure_model = {
        model: expected_token_cost_scenarios(
            sessions=sessions,
            stats=stats,
            global_tools=global_tools,
            candidate_agents=candidate_agents,
            delegation_overhead_tokens=delegation_overhead_tokens,
            exposure_sessions=exposure_sessions,
            exposure_model=model,
        )
        for model in EXPOSURE_MODELS
    }

    return {
        "known_cost_coverage": {
            "tools_with_known_cost": len(known_tools),
            "tools_total": len(stats),
            "catalog_coverage_rate": len(known_tools) / len(stats) if stats else 0.0,
            "observed_tools_with_known_cost": sum(
                1 for name in known_tools if stats[name].calls > 0
            ),
            "observed_tools_total": sum(1 for stat in stats.values() if stat.calls > 0),
            "observed_tool_coverage_rate": (
                sum(1 for name in known_tools if stats[name].calls > 0)
                / sum(1 for stat in stats.values() if stat.calls > 0)
                if any(stat.calls > 0 for stat in stats.values())
                else 0.0
            ),
            "calls_with_known_cost": sum(stats[name].calls for name in known_tools),
            "total_calls": sum(stat.calls for stat in stats.values()),
            "usage_weighted_coverage_rate": (
                sum(stats[name].calls for name in known_tools)
                / sum(stat.calls for stat in stats.values())
                if sum(stat.calls for stat in stats.values())
                else 0.0
            ),
            "exposure_weighted_coverage_rate": (
                sum(
                    stats[name].definition_tokens is not None
                    for session in exposure_sessions
                    for name in session.exposed_tools
                )
                / sum(len(session.exposed_tools) for session in exposure_sessions)
                if any(session.exposed_tools for session in exposure_sessions)
                else 0.0
            ),
        },
        "flat_baseline_known_tokens": baseline_known_tokens,
        "parent_known_tokens_after_partition": statistics.fmean(
            sum(
                stats[name].definition_tokens or 0
                for name in session.exposed_tools
                if name in parent_tools
            )
            for session in exposure_sessions
        )
        if exposure_sessions
        else 0.0,
        "expected_known_tokens_per_session_after_partition": expected_cost,
        "expected_known_tokens_saved_per_session": expected_savings,
        "expected_known_token_savings_rate": expected_savings_rate,
        "delegation_overhead_tokens_per_activated_specialist": delegation_overhead_tokens,
        "median_specialists_activated_per_session": (
            statistics.median(specialist_counts) if specialist_counts else 0
        ),
        "sessions_requiring_multiple_specialists_rate": (
            sum(1 for n in specialist_counts if n > 1) / len(specialist_counts)
            if specialist_counts
            else 0.0
        ),
        "cost_scenarios": cost_scenarios,
        "cost_scenarios_by_exposure_model": cost_scenarios_by_exposure_model,
        "interpretation": (
            "Known-token estimate using directly observed exposure only. "
            "Unknown tool-definition costs are excluded. "
            "Recovered telemetry costs use a chars/4 approximation. "
            "Unclustered tools remain on the parent to make the estimate conservative. "
            "Counterfactual exposure-model results are reported separately."
        ),
    }


@dataclass(frozen=True)
class BaselineExposure:
    directly_observed_exposure: frozenset[str]
    inferred_baseline_exposure: frozenset[str]
    actual_calls: frozenset[str]

    @property
    def exposed_tools(self) -> frozenset[str]:
        return self.directly_observed_exposure | self.inferred_baseline_exposure


def observed_runtime_tools(sessions: list[Session]) -> set[str]:
    """Return the corpus-level observed Codex runtime-tool catalog.

    This catalog is an explicit counterfactual input. It is not rebuilt from a
    session's calls while evaluating that session's baseline exposure.
    """
    return {
        tool
        for session in sessions
        if session.source == "codex"
        for tool in session.directly_observed_exposure | session.tool_set
    }


def provider_families_by_tool(sessions: list[Session]) -> dict[str, set[str]]:
    """Map tools to provider families using direct dynamic-tool telemetry.

    A dotted tool name supplies a stable family hint (for example,
    ``github.fetch_issue`` -> ``github``), but that hint never creates provider
    availability. Availability still must come from ``provider_availability``.
    """
    families: dict[str, set[str]] = defaultdict(set)
    for session in sessions:
        for provider, tools in session.provider_tools.items():
            for tool in tools:
                families[tool].add(provider)

    runtime_tools = observed_runtime_tools(sessions)
    for tool in runtime_tools:
        if tool not in families and "." in tool:
            families[tool].add(tool.split(".", 1)[0])
    return dict(families)


def baseline_exposure_state(
    session: Session,
    exposure_model: str,
    runtime_tools: set[str],
    provider_by_tool: dict[str, set[str]],
) -> BaselineExposure:
    """Build a session baseline without promoting calls to direct exposure."""
    if exposure_model not in EXPOSURE_MODELS:
        raise ValueError(f"Unknown exposure model: {exposure_model}")

    directly_observed = frozenset(session.directly_observed_exposure)
    inferred: set[str] = set()
    if exposure_model == "all_runtime_tools" and session.source == "codex":
        inferred.update(runtime_tools)
    elif exposure_model == "provider_scoped" and session.source == "codex":
        inferred.update(
            tool
            for tool in runtime_tools
            if provider_by_tool.get(tool, set()) & session.provider_availability
        )

    return BaselineExposure(
        directly_observed_exposure=directly_observed,
        inferred_baseline_exposure=frozenset(inferred - directly_observed),
        actual_calls=frozenset(session.actual_calls),
    )


def baseline_exposure_states(
    sessions: list[Session],
    exposure_model: str,
) -> dict[str, BaselineExposure]:
    runtime_tools = observed_runtime_tools(sessions)
    provider_by_tool = provider_families_by_tool(sessions)
    return {
        session.session_id: baseline_exposure_state(
            session,
            exposure_model,
            runtime_tools,
            provider_by_tool,
        )
        for session in sessions
    }


def scenario_cost(stat: ToolStat, scenario: str) -> float | None:
    if stat.definition_tokens is not None:
        return float(stat.definition_tokens)
    if scenario not in COST_SCENARIOS:
        raise ValueError(f"Unknown cost scenario: {scenario}")
    return getattr(stat, f"estimated_cost_{scenario}")


def reduction_metrics(
    baseline_tokens_per_session: float,
    proposed_tokens_per_session: float,
) -> dict[str, float | None]:
    absolute_reduction = baseline_tokens_per_session - proposed_tokens_per_session
    return {
        "baseline_tokens_per_session": baseline_tokens_per_session,
        "proposed_tokens_per_session": proposed_tokens_per_session,
        "absolute_token_reduction_per_session": absolute_reduction,
        "relative_token_reduction": (
            absolute_reduction / baseline_tokens_per_session
            if baseline_tokens_per_session
            else 0.0
        ),
    }


def build_architecture_variants(
    candidate_agents: list[dict[str, Any]],
    boundary_by_tool: dict[str, dict[str, float]],
    global_tools: set[str],
) -> list[dict[str, Any]]:
    """Build baseline and one-specialist variants without combining clusters."""
    variants: list[dict[str, Any]] = [
        {
            "variant_id": "baseline",
            "variant_type": "baseline",
            "cluster_id": None,
            "specialist_tools": [],
            "pruned_tools": [],
        }
    ]

    for agent in candidate_agents:
        candidate_id = str(agent["candidate_id"])
        cluster_id = str(agent.get("cluster_id", candidate_id))
        specialist_tools = sorted(set(agent["tools"]) - global_tools)
        if len(specialist_tools) < 2:
            continue

        variants.append(
            {
                "variant_id": candidate_id,
                "variant_type": "raw_cluster",
                "cluster_id": cluster_id,
                "specialist_tools": specialist_tools,
                "pruned_tools": [],
            }
        )

        retained_tools = sorted(
            tool
            for tool in specialist_tools
            if boundary_by_tool.get(tool, {}).get("boundary_margin", 0.0) > 0
        )
        if len(retained_tools) < 2:
            continue

        variants.append(
            {
                "variant_id": f"{candidate_id}_boundary_pruned",
                "variant_type": "boundary_pruned",
                "cluster_id": cluster_id,
                "specialist_tools": retained_tools,
                "pruned_tools": sorted(set(specialist_tools) - set(retained_tools)),
            }
        )

    return variants


def _scenario_sessions(
    sessions: list[Session],
    exposure_sessions: list[Session] | None,
) -> list[Session]:
    session_by_id = {session.session_id: session for session in sessions}
    for session in exposure_sessions or []:
        session_by_id.setdefault(session.session_id, session)
    return list(session_by_id.values())


def evaluate_architecture_variants(
    sessions: list[Session],
    stats: dict[str, ToolStat],
    global_tools: set[str],
    candidate_agents: list[dict[str, Any]],
    boundary_by_tool: dict[str, dict[str, float]],
    delegation_overhead_tokens: int,
    *,
    exposure_sessions: list[Session] | None = None,
) -> list[dict[str, Any]]:
    """Evaluate baseline and each candidate independently, ranked by mid case."""
    variants = build_architecture_variants(
        candidate_agents=candidate_agents,
        boundary_by_tool=boundary_by_tool,
        global_tools=global_tools,
    )
    scenario_sessions = _scenario_sessions(sessions, exposure_sessions)
    called_tools = {
        tool for session in scenario_sessions for tool in session.tool_set
    }

    evaluated: list[dict[str, Any]] = []
    for variant in variants:
        specialist_tools = set(variant["specialist_tools"])
        candidate = []
        if specialist_tools:
            candidate = [
                {
                    "candidate_id": variant["variant_id"],
                    "tools": sorted(specialist_tools),
                }
            ]

        cost_scenarios = expected_token_cost_scenarios(
            sessions=sessions,
            stats=stats,
            global_tools=global_tools,
            candidate_agents=candidate,
            delegation_overhead_tokens=delegation_overhead_tokens,
            exposure_sessions=exposure_sessions,
        )
        cost_scenarios_by_exposure_model = {
            model: expected_token_cost_scenarios(
                sessions=sessions,
                stats=stats,
                global_tools=global_tools,
                candidate_agents=candidate,
                delegation_overhead_tokens=delegation_overhead_tokens,
                exposure_sessions=exposure_sessions,
                exposure_model=model,
            )
            for model in EXPOSURE_MODELS
        }
        activated_sessions = [
            bool(session.tool_set & specialist_tools) for session in scenario_sessions
        ]
        sessions_requiring_specialist = sum(activated_sessions)
        session_count = len(scenario_sessions)
        activation_rate = (
            sessions_requiring_specialist / session_count if session_count else 0.0
        )
        average_activations = activation_rate
        supported_tools = (set(stats) - specialist_tools) | specialist_tools | global_tools
        coverage_rate = (
            len(called_tools & supported_tools) / len(called_tools)
            if called_tools
            else 1.0
        )

        scenarios = {}
        for scenario in COST_SCENARIOS:
            scenarios[scenario] = {
                **cost_scenarios[scenario],
                "specialist_activation_rate": activation_rate,
                "average_specialist_activations_per_session": average_activations,
                "sessions_requiring_specialist": sessions_requiring_specialist,
            }

        evaluated.append(
            {
                **variant,
                "historical_called_tool_coverage_rate": coverage_rate,
                "scenarios": scenarios,
                "scenarios_by_exposure_model": {
                    model: {
                        scenario: {
                            **metrics,
                            "specialist_activation_rate": activation_rate,
                            "average_specialist_activations_per_session": average_activations,
                            "sessions_requiring_specialist": sessions_requiring_specialist,
                        }
                        for scenario, metrics in model_scenarios.items()
                    }
                    for model, model_scenarios in cost_scenarios_by_exposure_model.items()
                },
            }
        )

    evaluated.sort(
        key=lambda item: (
            -(
                item["scenarios"]["mid"]["relative_token_reduction"]
                if item["scenarios"]["mid"]["relative_token_reduction"] is not None
                else float("-inf")
            ),
            item["variant_id"],
        )
    )
    for rank, variant in enumerate(evaluated, start=1):
        variant["rank"] = rank
    return evaluated


def expected_token_cost_scenarios(
    sessions: list[Session],
    stats: dict[str, ToolStat],
    global_tools: set[str],
    candidate_agents: list[dict[str, Any]],
    delegation_overhead_tokens: int,
    *,
    exposure_sessions: list[Session] | None = None,
    exposure_model: str = "observed_only",
) -> dict[str, dict[str, float | None]]:
    """Estimate one architecture under low/mid/high unresolved costs."""
    scenario_sessions = _scenario_sessions(sessions, exposure_sessions)
    exposure_states = baseline_exposure_states(scenario_sessions, exposure_model)
    specialist_membership = {
        tool: agent["candidate_id"]
        for agent in candidate_agents
        for tool in agent["tools"]
    }
    agents_by_id = {agent["candidate_id"]: agent for agent in candidate_agents}
    parent_tools = (set(stats) - set(specialist_membership)) | global_tools

    def total_cost(names: Iterable[str], scenario: str) -> float | None:
        costs = []
        for name in names:
            stat = stats.get(name)
            if stat is None:
                continue
            cost = scenario_cost(stat, scenario)
            if cost is None:
                return None
            costs.append(cost)
        return sum(costs)

    result: dict[str, dict[str, float | None]] = {}
    for scenario in COST_SCENARIOS:
        baseline_costs: list[float] = []
        proposed_costs: list[float] = []

        for session in scenario_sessions:
            exposure = exposure_states[session.session_id]
            baseline = total_cost(exposure.exposed_tools, scenario)
            if baseline is None:
                continue

            proposed = total_cost(exposure.exposed_tools & parent_tools, scenario)
            activated = {
                specialist_membership[tool]
                for tool in exposure.actual_calls
                if tool in specialist_membership
            }
            for candidate_id in activated:
                agent_cost = total_cost(agents_by_id[candidate_id]["tools"], scenario)
                if agent_cost is None:
                    proposed = None
                    break
                proposed = (proposed or 0.0) + agent_cost + delegation_overhead_tokens

            if proposed is None:
                continue
            baseline_costs.append(baseline)
            proposed_costs.append(proposed)

        if not baseline_costs:
            result[scenario] = {
                "baseline_tokens_per_session": None,
                "proposed_tokens_per_session": None,
                "absolute_token_reduction_per_session": None,
                "relative_token_reduction": None,
            }
            continue

        result[scenario] = reduction_metrics(
            statistics.fmean(baseline_costs),
            statistics.fmean(proposed_costs),
        )

    return result


def source_summary(sessions: list[Session]) -> dict[str, int]:
    return dict(sorted(Counter(session.source for session in sessions).items()))


def definition_resolution_report(
    stats: dict[str, ToolStat],
    registry: DefinitionRegistry,
) -> list[dict[str, Any]]:
    """Report resolution only for observed calls, including unresolved names."""
    rows = []
    for name, stat in sorted(stats.items()):
        if stat.calls == 0:
            continue
        record = registry.resolve(name)
        rows.append(
            {
                "observed_tool": name,
                "calls": stat.calls,
                "sessions_called": stat.sessions_called,
                "definition_resolved": record is not None,
                "definition_source": record.source if record else None,
                "provider": record.provider if record else None,
                "estimated_tokens": record.estimated_tokens if record else None,
                "confidence": record.confidence if record else "unresolved",
                "evidence_type": record.evidence_type if record else "unresolved",
            }
        )
    return rows


def render_markdown(report: dict[str, Any]) -> str:
    lines = []

    lines.append("# Agent Tool Exposure Analysis")
    lines.append("")
    lines.append("This report is advisory. No agent configuration was modified.")
    lines.append("")

    lines.append("## Corpus")
    lines.append("")
    lines.append(f"- Sessions analyzed: {report['corpus']['sessions']}")
    for key in (
        "sessions_total",
        "sessions_with_calls",
        "sessions_with_direct_exposure",
        "sessions_with_calls_and_exposure",
        "sessions_with_calls_without_exposure",
        "sessions_with_exposure_without_calls",
    ):
        lines.append(f"- {key}: {report['corpus'][key]}")
    lines.append(f"- Tool calls: {report['corpus']['tool_calls']}")
    lines.append(f"- Unique tools: {report['corpus']['unique_tools']}")
    lines.append(
        "- Sources: "
        + ", ".join(
            f"{name}={count}" for name, count in report["corpus"]["sources"].items()
        )
    )
    lines.append("")

    lines.append("## Definition resolution")
    lines.append("")
    lines.append(
        "| Observed tool | Calls | Sessions called | Resolved | Source | Estimated tokens | Evidence |"
    )
    lines.append("|---|---:|---:|---|---|---:|---|")
    for row in report["definition_resolution"]:
        source = row["definition_source"] or "unresolved"
        tokens = (
            str(row["estimated_tokens"])
            if row["estimated_tokens"] is not None
            else "unknown"
        )
        lines.append(
            f"| `{row['observed_tool']}` | {row['calls']} | "
            f"{row['sessions_called']} | "
            f"{'yes' if row['definition_resolved'] else 'no'} | "
            f"`{source}` | {tokens} | {row['evidence_type']} |"
        )
    lines.append("")

    lines.append("## Definition discovery")
    lines.append("")
    discovery = report["definition_discovery"]
    manifest = discovery["runtime_manifest"]
    lines.append(f"- Explicit records: {discovery['explicit_records']}")
    lines.append(f"- Telemetry records: {discovery['telemetry_records']}")
    lines.append(f"- Runtime roots scanned: {', '.join(manifest['roots']) or 'none'}")
    lines.append(f"- Manifest files scanned: {manifest['files_scanned']}")
    lines.append(f"- Manifest definitions found: {manifest['definitions_found']}")
    lines.append("")

    lines.append("## Tool inventory")
    lines.append("")
    lines.append(
        "| Tool | Directly observed exposure | Used | P(use|exposed) | Calls | Def tokens | Est low | Est mid | Est high | Waste/session | Boundary margin | Recommendation |"
    )
    lines.append("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|")
    for tool in report["tools"]:
        token_text = (
            str(tool["definition_tokens"])
            if tool["definition_tokens"] is not None
            else "unknown"
        )
        conditional_use = tool["call_given_exposed"]
        conditional_text = (
            f"{conditional_use:.1%}" if conditional_use is not None else "unknown"
        )
        waste_text = (
            f"{tool['expected_unused_tokens_per_session']:.1f}"
            if tool["expected_unused_tokens_per_session"] is not None
            else "unknown"
        )
        margin_text = (
            f"{tool['boundary_margin']:.3f}"
            if tool["boundary_margin"] is not None
            else "n/a"
        )
        estimate_text = [
            (
                f"{tool[key]:.1f}"
                if tool[key] is not None
                else "n/a"
            )
            for key in (
                "estimated_cost_low",
                "estimated_cost_mid",
                "estimated_cost_high",
            )
        ]
        lines.append(
            f"| `{tool['name']}` | {tool['sessions_exposed']} | "
            f"{tool['sessions_called']} | {conditional_text} | {tool['calls']} | "
            f"{token_text} | {' | '.join(estimate_text)} | {waste_text} | "
            f"{margin_text} | {tool['classification']} |"
        )
    lines.append("")

    lines.append("## Candidate specialist agents")
    lines.append("")
    if not report["candidate_agents"]:
        lines.append("No candidate clusters met the configured thresholds.")
        lines.append("")
    else:
        for agent in report["candidate_agents"]:
            lines.append(
                f"### {agent['candidate_id']} "
                f"({len(agent['tools'])} tools, "
                f"{agent['session_coverage_rate']:.1%} session coverage)"
            )
            lines.append("")
            lines.append(f"- Internal affinity: {agent['internal_affinity']:.3f}")
            lines.append(
                f"- Known definition tokens isolated: {agent['known_definition_tokens']}"
            )
            if agent["unknown_cost_tools"]:
                lines.append(
                    "- Unknown-cost tools: "
                    + ", ".join(f"`{t}`" for t in agent["unknown_cost_tools"])
                )
            lines.append("- Tools: " + ", ".join(f"`{t}`" for t in agent["tools"]))
            lines.append("")

    lines.append("## Cluster boundaries")
    lines.append("")
    lines.append(
        "| Cluster | Internal affinity | Max external affinity | Mean boundary margin | "
        "Session coverage | Exclusive coverage | Overlapping coverage |"
    )
    lines.append("|---|---:|---:|---:|---:|---:|---:|")
    for cluster in report["clusters"]:
        lines.append(
            f"| `{cluster['cluster_id']}` | {cluster['internal_affinity']:.3f} | "
            f"{cluster['max_external_affinity']:.3f} | {cluster['mean_boundary_margin']:.3f} | "
            f"{cluster['session_coverage']:.1%} | "
            f"{cluster['exclusive_session_coverage']:.1%} | "
            f"{cluster['overlapping_session_coverage']:.1%} |"
        )
    lines.append("")

    lines.append("## Baseline overhead context")
    lines.append("")
    overhead = report["overhead"]
    coverage = overhead["known_cost_coverage"]
    lines.append(
        f"- Tool-definition cost coverage: "
        f"{coverage['tools_with_known_cost']}/{coverage['tools_total']} "
        f"({coverage['catalog_coverage_rate']:.1%} catalog coverage)"
    )
    lines.append(
        f"- Observed-tool cost coverage: "
        f"{coverage['observed_tools_with_known_cost']}/{coverage['observed_tools_total']} "
        f"({coverage['observed_tool_coverage_rate']:.1%})"
    )
    lines.append(
        f"- Usage-weighted cost coverage: "
        f"{coverage['calls_with_known_cost']}/{coverage['total_calls']} "
        f"({coverage['usage_weighted_coverage_rate']:.1%})"
    )
    lines.append(
        f"- Exposure-record cost coverage: "
        f"{coverage['exposure_weighted_coverage_rate']:.1%}"
    )
    lines.append(
        f"- Flat baseline known definition tokens: "
        f"{overhead['flat_baseline_known_tokens']:.1f}"
    )
    lines.append(
        f"- Parent known definition tokens after partition: "
        f"{overhead['parent_known_tokens_after_partition']:.1f}"
    )
    lines.append(
        f"- Expected known tokens/session after partition: "
        f"{overhead['expected_known_tokens_per_session_after_partition']:.1f}"
    )

    savings_rate = overhead["expected_known_token_savings_rate"]
    if savings_rate is None:
        lines.append("- Expected known-token savings: unavailable")
    else:
        lines.append(
            f"- Expected known-token savings/session: "
            f"{overhead['expected_known_tokens_saved_per_session']:.1f} "
            f"({savings_rate:.1%})"
        )

    lines.append(
        f"- Median specialists activated/session: "
        f"{overhead['median_specialists_activated_per_session']}"
    )
    lines.append(
        f"- Sessions requiring multiple specialists: "
        f"{overhead['sessions_requiring_multiple_specialists_rate']:.1%}"
    )
    lines.append(
        f"- Delegation overhead assumption: "
        f"{overhead['delegation_overhead_tokens_per_activated_specialist']} tokens "
        f"per activated specialist"
    )
    lines.append("")
    lines.append(overhead["interpretation"])
    lines.append("")

    lines.append("## Baseline exposure models")
    lines.append("")
    lines.append(
        "Direct exposure is telemetry evidence. Inferred exposure is a labeled "
        "counterfactual assumption and is never derived from calls in the same session."
    )
    lines.append("")
    lines.append(
        "| Model | Description | Runtime catalog | Sessions with inferred exposure | Inferred exposure rows | Sessions with provider availability |"
    )
    lines.append("|---|---|---:|---:|---:|---:|")
    for model in report["exposure_models"]:
        lines.append(
            f"| `{model['model']}` | {model['description']} | "
            f"{model['runtime_tool_catalog_size']} | "
            f"{model['sessions_with_inferred_exposure']} | "
            f"{model['inferred_exposure_rows']} | "
            f"{model['sessions_with_provider_availability']} |"
        )
    lines.append("")

    lines.append("## Independent architecture variants")
    lines.append("")
    lines.append(
        "Variants are ranked by mid-case relative reduction; negative values are "
        "reported, not selected away."
    )
    lines.append("")
    for variant in report["architecture_variants"]:
        lines.append(
            f"### {variant['rank']}. `{variant['variant_id']}`"
        )
        lines.append("")
        lines.append(
            "- Specialist tools: "
            + (", ".join(f"`{tool}`" for tool in variant["specialist_tools"]) or "none")
        )
        if variant["pruned_tools"]:
            lines.append(
                "- Boundary-pruned tools left on parent: "
                + ", ".join(f"`{tool}`" for tool in variant["pruned_tools"])
            )
        lines.append(
            f"- Historical called-tool coverage: "
            f"{variant['historical_called_tool_coverage_rate']:.1%}"
        )
        lines.append("")
        for exposure_model in EXPOSURE_MODELS:
            lines.append(f"#### Exposure model: `{exposure_model}`")
            lines.append("")
            lines.append(
                f"{EXPOSURE_MODEL_DESCRIPTIONS[exposure_model]}"
            )
            lines.append("")
            lines.append("| Metric | Low | Mid | High |")
            lines.append("|---|---:|---:|---:|")
            model_scenarios = variant["scenarios_by_exposure_model"][exposure_model]
            for key, label in (
                ("baseline_tokens_per_session", "Baseline tokens/session"),
                ("proposed_tokens_per_session", "Proposed tokens/session"),
                ("absolute_token_reduction_per_session", "Absolute reduction"),
                ("relative_token_reduction", "Relative reduction"),
                ("specialist_activation_rate", "Specialist activation rate"),
                (
                    "average_specialist_activations_per_session",
                    "Average specialist activations/session",
                ),
                ("sessions_requiring_specialist", "Sessions requiring specialist"),
            ):
                values = []
                for scenario in COST_SCENARIOS:
                    value = model_scenarios[scenario][key]
                    if value is None:
                        values.append("unavailable")
                    elif key in {"relative_token_reduction", "specialist_activation_rate"}:
                        values.append(f"{value:.1%}")
                    elif key == "average_specialist_activations_per_session":
                        values.append(f"{value:.2f}")
                    elif key == "sessions_requiring_specialist":
                        values.append(str(value))
                    else:
                        values.append(f"{value:.1f}")
                lines.append(f"| {label} | " + " | ".join(values) + " |")
            lines.append("")
        lines.append("")
    lines.append("")

    lines.append("## Dependency warnings")
    lines.append("")
    if not report["dependency_warnings"]:
        lines.append("No known dependency separations were detected.")
    else:
        for warning in report["dependency_warnings"]:
            lines.append(f"- {warning['candidate_id']}:")
            for tool, deps in warning["missing_dependencies"].items():
                lines.append(
                    f"  - `{tool}` may require " + ", ".join(f"`{dep}`" for dep in deps)
                )
    lines.append("")

    lines.append("## Strongest tool relationships")
    lines.append("")
    lines.append("| Tool A | Tool B | Affinity | Jaccard | Overlap | Adjacent calls |")
    lines.append("|---|---|---:|---:|---:|---:|")
    for pair in report["strongest_pairs"][:30]:
        lines.append(
            f"| `{pair['tool_a']}` | `{pair['tool_b']}` | "
            f"{pair['affinity']:.3f} | {pair['jaccard']:.3f} | "
            f"{pair['overlap']:.3f} | {pair['adjacency_count']} |"
        )
    lines.append("")

    lines.append("## Caveats")
    lines.append("")
    for caveat in report["caveats"]:
        lines.append(f"- {caveat}")

    return "\n".join(lines) + "\n"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Analyze historical coding-agent tool usage and propose lower-overhead tool exposure."
    )
    parser.add_argument(
        "--vscode-workspace-storage",
        default=DEFAULT_VSCODE_WORKSPACE_STORAGE,
        help="VS Code workspaceStorage directory.",
    )
    parser.add_argument(
        "--codex-sessions-dir",
        default=DEFAULT_CODEX_SESSIONS_DIR,
        help="Codex sessions directory.",
    )
    parser.add_argument(
        "--tool-costs",
        default=None,
        help="Optional JSON mapping of normalized tool names to token costs.",
    )
    parser.add_argument(
        "--definition-search-root",
        action="append",
        default=[],
        help=(
            "Additional local runtime/provider root to scan for advertised JSON "
            "tool definitions. May be repeated."
        ),
    )
    parser.add_argument(
        "--output-dir",
        default="agent_tool_analysis",
        help="Directory for JSON and Markdown reports.",
    )
    parser.add_argument(
        "--min-tool-sessions",
        type=int,
        default=3,
        help="Ignore tools seen in fewer than this many sessions for clustering.",
    )
    parser.add_argument(
        "--similarity-threshold",
        type=float,
        default=0.35,
        help="Average-link affinity threshold for cluster merging.",
    )
    parser.add_argument(
        "--global-usage-threshold",
        type=float,
        default=0.60,
        help="Tools used in at least this fraction of sessions stay on the parent.",
    )
    parser.add_argument(
        "--min-cluster-size",
        type=int,
        default=2,
        help="Minimum specialist tools in a candidate agent.",
    )
    parser.add_argument(
        "--min-cluster-sessions",
        type=int,
        default=3,
        help="Minimum sessions touched by a candidate specialist agent.",
    )
    parser.add_argument(
        "--delegation-overhead-tokens",
        type=int,
        default=0,
        help=(
            "Optional assumed token overhead per activated specialist. "
            "Default 0 reports a lower-bound partition estimate."
        ),
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

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

    vscode_sessions, vscode_defs = get_vscode_sessions(args.vscode_workspace_storage)
    codex_sessions, codex_defs = get_codex_sessions(args.codex_sessions_dir)

    sessions = vscode_sessions + codex_sessions

    if not sessions:
        raise SystemExit(
            "No tool-using sessions were found. "
            "Check --vscode-workspace-storage and --codex-sessions-dir."
        )

    observed_names = {
        tool
        for session in sessions
        for tool in (session.tool_set | session.exposed_tools)
    } | set(vscode_defs) | set(codex_defs)
    definition_roots = list(dict.fromkeys(
        [*DEFAULT_CODEX_DEFINITION_ROOTS, *args.definition_search_root]
    ))
    definitions, definition_registry, manifest_provider, definition_discovery = (
        acquire_definitions(
            observed_names=observed_names,
            vscode_definitions=vscode_defs,
            codex_definitions=codex_defs,
            explicit_path=args.tool_costs,
            definition_roots=definition_roots,
        )
    )

    call_sessions = [session for session in sessions if session.calls]
    exposure_sessions = [session for session in sessions if session.exposed_tools]
    stats = build_stats(
        sessions,
        definitions,
        {},
        call_sessions=call_sessions,
        exposure_sessions=exposure_sessions,
    )
    session_index = build_session_index(call_sessions)
    adjacency = build_adjacency_counts(call_sessions)

    active_tools = sorted(
        name for name, stat in stats.items() if stat.sessions >= args.min_tool_sessions
    )

    pairs = all_pair_metrics(active_tools, session_index, adjacency)

    clusters = agglomerative_clusters(
        active_tools,
        pairs,
        threshold=args.similarity_threshold,
    )

    classifications = classify_tools(
        stats,
        global_usage_threshold=args.global_usage_threshold,
    )

    global_tools = choose_global_tools(
        stats,
        global_usage_threshold=args.global_usage_threshold,
    )

    candidate_agents = make_candidate_agents(
        clusters=clusters,
        global_tools=global_tools,
        stats=stats,
        sessions=call_sessions,
        pairs=pairs,
        min_cluster_size=args.min_cluster_size,
        min_cluster_sessions=args.min_cluster_sessions,
    )

    boundary_by_tool: dict[str, dict[str, float]] = {}
    cluster_reports: list[dict[str, Any]] = []
    for index, cluster in enumerate(clusters, start=1):
        cluster_metrics = cluster_boundary_metrics(
            cluster=cluster,
            clusters=clusters,
            pairs=pairs,
            all_clustered_tools=active_tools,
            session_index=session_index,
            sessions=call_sessions,
        )
        cluster_reports.append(
            {
                "cluster_id": f"cluster_{index:02d}",
                "tools": sorted(cluster),
                **cluster_metrics,
            }
        )
        for tool in cluster:
            boundary_by_tool[tool] = tool_boundary_metrics(
                tool, cluster, pairs, active_tools
            )

    warnings = dependency_warnings(
        candidate_agents=candidate_agents,
        global_tools=global_tools,
        all_tools=set(stats),
    )

    overhead = expected_known_token_cost(
        sessions=call_sessions,
        stats=stats,
        global_tools=global_tools,
        candidate_agents=[],
        delegation_overhead_tokens=args.delegation_overhead_tokens,
        exposure_sessions=exposure_sessions,
    )
    architecture_variants = evaluate_architecture_variants(
        sessions=call_sessions,
        stats=stats,
        global_tools=global_tools,
        candidate_agents=candidate_agents,
        boundary_by_tool=boundary_by_tool,
        delegation_overhead_tokens=args.delegation_overhead_tokens,
        exposure_sessions=exposure_sessions,
    )

    strongest_pairs = []
    for (a, b), metrics in pairs.items():
        strongest_pairs.append(
            {
                "tool_a": a,
                "tool_b": b,
                **metrics,
            }
        )
    strongest_pairs.sort(
        key=lambda row: (
            -float(row["affinity"]),
            -float(row["co_sessions"]),
            row["tool_a"],
            row["tool_b"],
        )
    )

    tools_report = []
    for name in sorted(
        stats,
        key=lambda n: (-stats[n].sessions, -stats[n].calls, n),
    ):
        stat = stats[name]
        definition = definitions.get(name)
        tools_report.append(
            {
                "name": name,
                "sessions": stat.sessions,
                "calls": stat.calls,
                "usage_rate": stat.usage_rate,
                "definition_tokens": stat.definition_tokens,
                "definition_cost_source": stat.definition_cost_source,
                "estimated_cost_low": stat.estimated_cost_low,
                "estimated_cost_mid": stat.estimated_cost_mid,
                "estimated_cost_high": stat.estimated_cost_high,
                "estimation_basis": stat.estimation_basis,
                "estimation_confidence": stat.estimation_confidence,
                "definition_provider": definition.provider if definition else None,
                "definition_runtime": definition.runtime if definition else None,
                "definition_raw_name": definition.raw_name if definition else None,
                "definition_confidence": definition.confidence if definition else "unresolved",
                "definition_evidence_type": (
                    definition.evidence_type if definition else "unresolved"
                ),
                "sessions_exposed": stat.sessions_exposed,
                "sessions_directly_observed_exposure": stat.sessions_exposed,
                "sessions_called": stat.sessions_called,
                "call_given_exposed": stat.call_given_exposed,
                "expected_unused_tokens_per_session": stat.expected_unused_tokens_per_session,
                **boundary_by_tool.get(
                    name,
                    {
                        "mean_internal_affinity": None,
                        "best_external_affinity": None,
                        "boundary_margin": None,
                    },
                ),
                "classification": classifications[name],
                "global_candidate": name in global_tools,
            }
        )

    report = {
        "config": {
            "min_tool_sessions": args.min_tool_sessions,
            "similarity_threshold": args.similarity_threshold,
            "global_usage_threshold": args.global_usage_threshold,
            "min_cluster_size": args.min_cluster_size,
            "min_cluster_sessions": args.min_cluster_sessions,
            "delegation_overhead_tokens": args.delegation_overhead_tokens,
        },
        "corpus": {
            "sessions": len(sessions),
            **session_population_summary(sessions),
            "tool_calls": sum(len(s.calls) for s in sessions),
            "unique_tools": len(stats),
            "active_tools_for_clustering": len(active_tools),
            "sources": source_summary(sessions),
        },
        "tools": tools_report,
        "exposure_matrix": build_exposure_matrix(sessions, stats),
        "exposure_matrix_summary": exposure_matrix_summary(sessions, stats),
        "exposure_consistency": exposure_consistency(sessions),
        "exposure_models": exposure_model_summary(sessions),
        "definition_resolution": definition_resolution_report(stats, definition_registry),
        "definition_discovery": definition_discovery,
        "clusters": cluster_reports,
        "global_candidates": sorted(global_tools),
        "candidate_agents": candidate_agents,
        "architecture_variants": architecture_variants,
        "dependency_warnings": warnings,
        "overhead": overhead,
        "strongest_pairs": strongest_pairs[:100],
        "caveats": [
            "Historical co-usage is evidence of operational coupling, not proof that tools belong in the same agent.",
            "This script does not measure task correctness or success directly; quality preservation still requires empirical A/B or replay evaluation.",
            "Tool-definition token costs are exact only when supplied explicitly with --tool-costs. Telemetry-recovered costs use a chars/4 approximation.",
            "The known-token calculation excludes unknown tool-definition costs; scenario estimates use a global resolved-definition distribution for unresolved observed tools.",
            "A zero delegation-overhead setting is a lower-bound estimate, not a claim that delegation is free.",
            "Direct exposure, inferred baseline exposure, and actual calls are separate evidence dimensions; observed-only is an oracle lower bound and should not judge specialization.",
            "The all-runtime and provider-scoped results are counterfactual baseline assumptions, not observed exposure claims.",
            "Provider-scoped exposure requires explicit provider availability telemetry; calls and absent calls do not establish availability.",
        ],
    }

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    json_path = output_dir / "agent_tool_analysis.json"
    md_path = output_dir / "agent_tool_analysis.md"

    with json_path.open("w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)

    with md_path.open("w", encoding="utf-8") as f:
        f.write(render_markdown(report))

    print("=" * 72)
    print("AGENT TOOL EXPOSURE ANALYSIS")
    print("=" * 72)
    print(f"Sessions analyzed: {len(sessions)}")
    print(f"Tool calls:        {sum(len(s.calls) for s in sessions)}")
    print(f"Unique tools:      {len(stats)}")
    print(f"Clustered tools:   {len(active_tools)}")
    print(f"Global candidates: {len(global_tools)}")
    print(f"Agent candidates:  {len(candidate_agents)}")
    print()

    coverage = overhead["known_cost_coverage"]
    print(
        "Known tool-cost coverage: "
        f"{coverage['tools_with_known_cost']}/{coverage['tools_total']} "
        f"(catalog {coverage['catalog_coverage_rate']:.1%}, "
        f"usage-weighted {coverage['usage_weighted_coverage_rate']:.1%})"
    )

    if overhead["expected_known_token_savings_rate"] is not None:
        print(
            "Expected known-token savings/session: "
            f"{overhead['expected_known_tokens_saved_per_session']:.1f} "
            f"({overhead['expected_known_token_savings_rate']:.1%})"
        )
    else:
        print("Expected known-token savings/session: unavailable")

    print()
    print("Independent architecture variants (ranked by observed-only mid-case reduction)")
    print("Variant                         Low       Mid      High  Activation")
    for variant in architecture_variants:
        reductions = [
            variant["scenarios"][scenario]["relative_token_reduction"]
            for scenario in COST_SCENARIOS
        ]
        formatted_reductions = [
            f"{value:.1%}" if value is not None else "n/a"
            for value in reductions
        ]
        print(
            f"{variant['variant_id']:<30}"
            f"{formatted_reductions[0]:>8}"
            f"{formatted_reductions[1]:>10}"
            f"{formatted_reductions[2]:>10}"
            f"  {variant['scenarios']['mid']['specialist_activation_rate']:.1%}"
        )

    print()
    print("Mid-case relative reduction by baseline exposure model")
    print("Variant                         Observed-only  All-runtime  Provider-scoped")
    for variant in architecture_variants:
        reductions = [
            variant["scenarios_by_exposure_model"][model]["mid"][
                "relative_token_reduction"
            ]
            for model in EXPOSURE_MODELS
        ]
        formatted_reductions = [
            f"{value:.1%}" if value is not None else "n/a"
            for value in reductions
        ]
        print(
            f"{variant['variant_id']:<30}"
            f"{formatted_reductions[0]:>14}"
            f"{formatted_reductions[1]:>13}"
            f"{formatted_reductions[2]:>17}"
        )

    print()
    print(f"JSON report:     {json_path.resolve()}")
    print(f"Markdown report: {md_path.resolve()}")
    print()
    print("Next: inspect the Markdown report before generating or installing agents.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
