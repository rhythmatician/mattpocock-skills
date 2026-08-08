"""Direct and counterfactual baseline exposure semantics."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from typing import Any

from telemetry_ingestion import Session, normalize_tool_name

EXPOSURE_MODELS = ("observed_only", "all_runtime_tools", "provider_scoped")
DECISION_EXPOSURE_MODELS = ("provider_scoped", "all_runtime_tools")
EXPOSURE_MODEL_DESCRIPTIONS = {
    "observed_only": "Lower bound: charge only directly observed parent exposure; never use calls as exposure evidence.",
    "all_runtime_tools": "Counterfactual: expose every observed Codex runtime tool on the parent in every applicable Codex session.",
    "provider_scoped": "Counterfactual: expose tools in providers explicitly marked available by Codex dynamic-tool telemetry.",
}

# Add aliases only when a dynamic-tools group establishes the relationship.
# The current corpus contains no evidence-backed provider or tool aliases.
PROVIDER_ALIASES: dict[str, str] = {}
TOOL_ALIASES: dict[str, str] = {}


@dataclass(frozen=True)
class BaselineExposure:
    directly_observed_exposure: frozenset[str]
    inferred_baseline_exposure: frozenset[str]
    actual_calls: frozenset[str]

    @property
    def exposed_tools(self) -> frozenset[str]:
        return self.directly_observed_exposure | self.inferred_baseline_exposure


def observed_runtime_tools(sessions: list[Session]) -> set[str]:
    return {
        tool for session in sessions if session.source == "codex"
        for tool in session.directly_observed_exposure | session.tool_set
    }


def provider_families_by_tool(sessions: list[Session]) -> dict[str, set[str]]:
    families: dict[str, set[str]] = defaultdict(set)
    for session in sessions:
        for provider, tools in session.provider_tools.items():
            for tool in tools:
                families[tool].add(provider)
    return dict(families)


def baseline_exposure_state(
    session: Session,
    exposure_model: str,
    runtime_tools: set[str],
    provider_by_tool: dict[str, set[str]],
) -> BaselineExposure:
    if exposure_model not in EXPOSURE_MODELS:
        raise ValueError(f"Unknown exposure model: {exposure_model}")
    directly_observed = frozenset(session.directly_observed_exposure)
    inferred: set[str] = set()
    if exposure_model == "all_runtime_tools" and session.source == "codex":
        inferred.update(runtime_tools)
    elif exposure_model == "provider_scoped" and session.source == "codex":
        inferred.update(
            tool for tool in provider_by_tool
            if provider_by_tool.get(tool, set()) & session.provider_availability
        )
    return BaselineExposure(
        directly_observed_exposure=directly_observed,
        inferred_baseline_exposure=frozenset(inferred - directly_observed),
        actual_calls=frozenset(session.actual_calls),
    )


def baseline_exposure_states(sessions: list[Session], exposure_model: str) -> dict[str, BaselineExposure]:
    runtime_tools = observed_runtime_tools(sessions)
    provider_by_tool = provider_families_by_tool(sessions)
    return {
        session.session_id: baseline_exposure_state(session, exposure_model, runtime_tools, provider_by_tool)
        for session in sessions
    }


def exposure_model_summary(sessions: list[Session]) -> list[dict[str, Any]]:
    runtime_tools = observed_runtime_tools(sessions)
    provider_by_tool = provider_families_by_tool(sessions)
    rows = []
    for model in EXPOSURE_MODELS:
        states = {
            session.session_id: baseline_exposure_state(session, model, runtime_tools, provider_by_tool)
            for session in sessions
        }
        rows.append({
            "model": model,
            "description": EXPOSURE_MODEL_DESCRIPTIONS[model],
            "sessions": len(sessions),
            "runtime_tool_catalog_size": len(runtime_tools),
            "sessions_with_inferred_exposure": sum(bool(states[s.session_id].inferred_baseline_exposure) for s in sessions),
            "inferred_exposure_rows": sum(len(states[s.session_id].inferred_baseline_exposure) for s in sessions),
            "sessions_with_provider_availability": sum(bool(s.provider_availability) for s in sessions),
        })
    return rows


def provider_scoped_session_diagnostics(sessions: list[Session]) -> list[dict[str, Any]]:
    states = baseline_exposure_states(sessions, "provider_scoped")
    return [{
        "session_id": session.session_id,
        "source": session.source,
        "provider_availability_observed": bool(session.provider_availability),
        "providers_available": sorted(session.provider_availability),
        "inferred_runtime_tools": sorted(states[session.session_id].inferred_baseline_exposure),
        "directly_exposed_tools": sorted(states[session.session_id].directly_observed_exposure),
        "called_tools": sorted(states[session.session_id].actual_calls),
    } for session in sessions]


def dynamic_tool_group_inventory(sessions: list[Session]) -> list[dict[str, Any]]:
    return [
        {
            "session_id": session.session_id,
            "group_index": group.group_index,
            "dynamic_tools_path": group.path,
            "group_keys": list(group.group_keys),
            "provider": group.provider,
            "name": group.name,
            "id": group.identifier,
            "tool_count": group.tool_count,
            "normalized_tool_names": list(group.normalized_tool_names),
        }
        for session in sessions
        for group in session.dynamic_tool_groups
    ]


def _github_like(value: str | None) -> bool:
    return isinstance(value, str) and "github" in value.casefold()


def provider_availability_diagnostics(sessions: list[Session]) -> dict[str, Any]:
    """Compare runtime calls with definitions in explicit provider groups."""
    providers: dict[str, dict[str, Any]] = defaultdict(
        lambda: {"groups": 0, "sessions": set(), "tools": set()}
    )
    advertised: list[tuple[str, str, str]] = []
    github_evidence_sessions: set[str] = set()
    github_advertised: set[str] = set()

    for session in sessions:
        for group in session.dynamic_tool_groups:
            provider = group.provider_name
            if not provider:
                continue
            canonical_provider = PROVIDER_ALIASES.get(provider, provider)
            providers[canonical_provider]["groups"] += 1
            providers[canonical_provider]["sessions"].add(session.session_id)
            providers[canonical_provider]["tools"].update(
                group.normalized_tool_names
            )
            group_is_github_like = any(
                _github_like(value)
                for value in (group.provider, group.name, group.identifier)
            ) or any(_github_like(name) for name in group.normalized_tool_names)
            if group_is_github_like:
                github_evidence_sessions.add(session.session_id)
                github_advertised.update(group.normalized_tool_names)
            advertised.extend(
                (canonical_provider, raw_name, normalized_name)
                for raw_name, normalized_name in zip(
                    group.raw_tool_names, group.normalized_tool_names
                )
            )

    runtime_tools = sorted({tool for session in sessions for tool in session.tool_set})
    mappings: list[dict[str, str]] = []
    matched_advertised: set[tuple[str, str]] = set()
    unmatched_runtime: list[str] = []
    for runtime_tool in runtime_tools:
        match = next(
            (
                (provider, raw_name, normalized_name, "exact_name")
                for provider, raw_name, normalized_name in advertised
                if raw_name == runtime_tool
            ),
            None,
        )
        if match is None:
            aliased_runtime = TOOL_ALIASES.get(runtime_tool, runtime_tool)
            normalized_runtime = normalize_tool_name(aliased_runtime)
            match = next(
                (
                    (provider, raw_name, normalized_name, "normalized_or_alias")
                    for provider, raw_name, normalized_name in advertised
                    if normalized_name == normalized_runtime
                ),
                None,
            )
        if match is None:
            unmatched_runtime.append(runtime_tool)
            continue
        provider, raw_name, normalized_name, match_type = match
        matched_advertised.add((provider, normalized_name))
        mappings.append({
            "runtime_tool": runtime_tool,
            "advertised_tool": raw_name,
            "provider": provider,
            "match_type": match_type,
        })

    unmatched_advertised = sorted({
        normalized_name
        for provider, _raw_name, normalized_name in advertised
        if (provider, normalized_name) not in matched_advertised
    })
    github_runtime = sorted(tool for tool in runtime_tools if _github_like(tool))
    github_mappings = [
        mapping
        for mapping in mappings
        if mapping["runtime_tool"] in github_runtime
        and (
            _github_like(mapping["provider"])
            or mapping["advertised_tool"] in github_advertised
        )
    ]
    matched_github_runtime = {mapping["runtime_tool"] for mapping in github_mappings}

    return {
        "provider_groups_observed": [
            {
                "provider": provider,
                "group_count": values["groups"],
                "session_count": len(values["sessions"]),
                "sessions": sorted(values["sessions"]),
                "tools_advertised": sorted(values["tools"]),
            }
            for provider, values in sorted(providers.items())
        ],
        "runtime_called_tools_mapped_to_advertised_definitions": mappings,
        "unmatched_runtime_tools": unmatched_runtime,
        "unmatched_advertised_tools": unmatched_advertised,
        "provider_aliases": dict(PROVIDER_ALIASES),
        "tool_aliases": dict(TOOL_ALIASES),
        "github": {
            "sessions_with_github_like_provider_evidence": len(
                github_evidence_sessions
            ),
            "advertised_github_like_tools": sorted(github_advertised),
            "runtime_github_tools": github_runtime,
            "exact_name_matches": sorted(
                mapping["runtime_tool"]
                for mapping in github_mappings
                if mapping["match_type"] == "exact_name"
            ),
            "normalized_or_alias_matches": sorted(
                mapping["runtime_tool"]
                for mapping in github_mappings
                if mapping["match_type"] == "normalized_or_alias"
            ),
            "unresolved_mappings": sorted(
                set(github_runtime) - matched_github_runtime
            ),
        },
    }


def exposure_consistency(sessions: list[Session]) -> dict[str, int]:
    calls_without_direct_exposure = sum(
        1 for session in sessions for tool in session.actual_calls
        if tool not in session.directly_observed_exposure
    )
    return {
        "sessions_with_direct_exposure": sum(bool(s.exposed_tools) for s in sessions),
        "sessions_without_direct_exposure": sum(not s.exposed_tools for s in sessions),
        "called_tools_without_direct_exposure": calls_without_direct_exposure,
    }
