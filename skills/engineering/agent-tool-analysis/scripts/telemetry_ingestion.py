"""Telemetry source adapters and the canonical session evidence model."""

from __future__ import annotations

import glob
import json
import os
import re
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Iterable

from tool_definition_registry import (
    DEFINITION_KEYS,
    DefinitionRecord,
    canonical_json_length,
    estimate_tokens_from_chars,
    walk_json,
)

IGNORED_PATTERNS = [
    r"^turn_(start|end):?", r"^session_start$", r"^chat:",
    r"^user_message$", r"^agent_response$", r".*Discovery$",
    r"^Custom Instructions$", r"^Resolve Customizations$", r"^PreToolUse$",
    r"^PostToolUse$",
]
IGNORE_REGEX = re.compile("|".join(IGNORED_PATTERNS), re.IGNORECASE)
TOOL_REMAP = {"memory": "vscode/memory", "runSubagent": "agent", "runTests": "execute/runTests"}
TOOL_NAME_REGEX = re.compile(
    r'"tool_name"\s*:\s*"([^"]+)"|'
    r'"(?:tool|function)"\s*:\s*\{\s*"name"\s*:\s*"([^"]+)"'
)
CODEX_CALL_TYPES = {"custom_tool_call", "function_call", "mcp_tool_call"}


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
        return self.exposed_tools

    @property
    def actual_calls(self) -> list[str]:
        return self.calls

    @property
    def tool_set(self) -> set[str]:
        return set(self.actual_calls)


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
    return None if IGNORE_REGEX.search(clean_name) else clean_name


def find_raw_tool_call(event: Any) -> str | None:
    if not isinstance(event, dict):
        return None
    value = event.get("tool_name")
    if isinstance(value, str):
        return value
    item = event.get("item")
    if isinstance(item, dict) and item.get("type") in {"function_call", "tool_call", "mcp_call"}:
        value = item.get("name") or item.get("function")
        if isinstance(value, str):
            return value
    payload = event.get("payload")
    if isinstance(payload, dict):
        payload_type = payload.get("type")
        if payload_type in CODEX_CALL_TYPES:
            value = payload.get("name")
            if isinstance(value, str):
                return value
        invocation = payload.get("invocation")
        if isinstance(invocation, dict):
            value = invocation.get("tool")
            if isinstance(value, str):
                return value
        payload_type = str(payload_type or "").lower()
        if any(part in payload_type for part in ("tool", "function", "call")) or "tool" in event or "tool_name" in event:
            value = payload.get("name") or payload.get("tool") or payload.get("tool_name")
            if isinstance(value, str):
                return value
    tool = event.get("tool")
    if isinstance(tool, str):
        return tool
    if isinstance(tool, dict) and isinstance(tool.get("name"), str):
        return tool["name"]
    function = event.get("function")
    if isinstance(function, dict) and isinstance(function.get("name"), str):
        return function["name"]
    return None


def extract_tool_definitions(event: Any, runtime: str) -> list[DefinitionRecord]:
    records = []
    for node in walk_json(event):
        if not isinstance(node, dict) or not isinstance(node.get("name"), str):
            continue
        if not any(key in node for key in DEFINITION_KEYS):
            continue
        raw_name = node["name"]
        name = normalize_tool_name(raw_name)
        if not name:
            continue
        subset = {"name": raw_name}
        subset.update({key: node[key] for key in DEFINITION_KEYS if key in node})
        chars = canonical_json_length(subset)
        records.append(DefinitionRecord(
            normalized_name=name, runtime=runtime, provider="telemetry",
            raw_name=raw_name,
            description=node.get("description") if isinstance(node.get("description"), str) else None,
            input_schema=node.get("inputSchema", node.get("input_schema")),
            serialized_chars=chars, estimated_tokens=estimate_tokens_from_chars(chars),
            source=f"telemetry:{runtime}", confidence="direct_telemetry",
            evidence_type="recovered_definition",
        ))
    return records


def extract_codex_calls(event: Any) -> list[str]:
    if not isinstance(event, dict) or not isinstance(event.get("payload"), dict):
        return []
    payload = event["payload"]
    calls = []
    if payload.get("type") in CODEX_CALL_TYPES and isinstance(payload.get("name"), str):
        calls.append(payload["name"])
    invocation = payload.get("invocation")
    if isinstance(invocation, dict) and isinstance(invocation.get("tool"), str):
        calls.append(invocation["tool"])
    return calls


def extract_codex_exposures(event: Any) -> set[str]:
    if not isinstance(event, dict) or not isinstance(event.get("payload"), dict):
        return set()
    dynamic_tools = event["payload"].get("dynamic_tools")
    if not isinstance(dynamic_tools, list):
        return set()
    return {
        name for group in dynamic_tools if isinstance(group, dict)
        for tool in (group.get("tools") or []) if isinstance(tool, dict)
        for name in [normalize_tool_name(tool.get("name"))] if name
    }


def normalize_provider_name(raw_name: Any) -> str | None:
    if not isinstance(raw_name, str):
        return None
    return raw_name.strip() or None


def extract_codex_provider_metadata(event: Any) -> tuple[set[str], dict[str, set[str]]]:
    if not isinstance(event, dict) or not isinstance(event.get("payload"), dict):
        return set(), {}
    dynamic_tools = event["payload"].get("dynamic_tools")
    if not isinstance(dynamic_tools, list):
        return set(), {}
    providers: set[str] = set()
    provider_tools: dict[str, set[str]] = defaultdict(set)
    for group in dynamic_tools:
        if not isinstance(group, dict):
            continue
        provider = normalize_provider_name(group.get("provider") or group.get("name") or group.get("id"))
        if not provider:
            continue
        providers.add(provider)
        for tool in group.get("tools") or []:
            if isinstance(tool, dict) and (name := normalize_tool_name(tool.get("name"))):
                provider_tools[provider].add(name)
    return providers, dict(provider_tools)


def _prefer_definition(definitions: dict[str, DefinitionRecord], record: DefinitionRecord) -> None:
    existing = definitions.get(record.normalized_name)
    if existing is None or (record.serialized_chars is not None and (existing.serialized_chars is None or record.serialized_chars > existing.serialized_chars)):
        definitions[record.normalized_name] = record


def get_vscode_sessions(workspace_storage: str) -> tuple[list[Session], dict[str, DefinitionRecord]]:
    sessions: list[Session] = []
    definitions: dict[str, DefinitionRecord] = {}
    if not os.path.exists(workspace_storage):
        return sessions, definitions
    pattern = os.path.join(workspace_storage, "*", "github.copilot-chat", "debug-logs", "*", "*.jsonl")
    for file_path in glob.glob(pattern, recursive=True):
        calls: list[str] = []
        try:
            with open(file_path, "r", encoding="utf-8", errors="ignore") as stream:
                for line in stream:
                    if not line.strip():
                        continue
                    for match in TOOL_NAME_REGEX.findall(line):
                        if name := normalize_tool_name(match[0] or match[1]):
                            calls.append(name)
                    try:
                        event = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if name := normalize_tool_name(find_raw_tool_call(event)):
                        if not calls or calls[-1] != name:
                            calls.append(name)
                    for record in extract_tool_definitions(event, "vscode"):
                        _prefer_definition(definitions, record)
        except OSError:
            continue
        if calls:
            sessions.append(Session(f"vscode:{os.path.relpath(file_path, workspace_storage)}", "vscode", calls=calls))
    return sessions, definitions


def get_codex_sessions(sessions_dir: str) -> tuple[list[Session], dict[str, DefinitionRecord]]:
    sessions: list[Session] = []
    definitions: dict[str, DefinitionRecord] = {}
    if not os.path.exists(sessions_dir):
        return sessions, definitions
    for file_path in glob.glob(os.path.join(sessions_dir, "**", "*.jsonl"), recursive=True):
        calls: list[str] = []
        exposed: set[str] = set()
        providers: set[str] = set()
        provider_tools: dict[str, set[str]] = defaultdict(set)
        try:
            with open(file_path, "r", encoding="utf-8", errors="ignore") as stream:
                for line in stream:
                    if not line.strip():
                        continue
                    try:
                        event = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    for raw in extract_codex_calls(event):
                        if name := normalize_tool_name(raw):
                            calls.append(name)
                    exposed.update(extract_codex_exposures(event))
                    event_providers, event_tools = extract_codex_provider_metadata(event)
                    providers.update(event_providers)
                    for provider, tools in event_tools.items():
                        provider_tools[provider].update(tools)
                    for record in extract_tool_definitions(event, "codex"):
                        _prefer_definition(definitions, record)
        except OSError:
            continue
        if calls or exposed:
            sessions.append(Session(
                f"codex:{os.path.relpath(file_path, sessions_dir)}", "codex",
                calls=calls, exposed_tools=exposed,
                provider_availability=providers, provider_tools=dict(provider_tools),
                exposure_source="codex:payload.dynamic_tools[].tools[].name" if exposed else "not_observed",
            ))
    return sessions, definitions
