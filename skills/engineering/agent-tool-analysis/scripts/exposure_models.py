"""Direct and counterfactual baseline exposure semantics."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from typing import Any

from telemetry_ingestion import Session

EXPOSURE_MODELS = ("observed_only", "all_runtime_tools", "provider_scoped")
DECISION_EXPOSURE_MODELS = ("provider_scoped", "all_runtime_tools")
EXPOSURE_MODEL_DESCRIPTIONS = {
    "observed_only": "Lower bound: charge only directly observed parent exposure; never use calls as exposure evidence.",
    "all_runtime_tools": "Counterfactual: expose every observed Codex runtime tool on the parent in every applicable Codex session.",
    "provider_scoped": "Counterfactual: expose tools in providers explicitly marked available by Codex dynamic-tool telemetry.",
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
