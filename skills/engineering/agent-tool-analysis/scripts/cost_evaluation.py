"""Token-cost evaluation and specialist exposure economics."""

from __future__ import annotations

import statistics
from typing import Any, Iterable, Mapping

from exposure_models import EXPOSURE_MODELS, baseline_exposure_states
from telemetry_ingestion import Session

COST_SCENARIOS = ("low", "mid", "high")


def scenario_cost(stat: Any, scenario: str) -> float | None:
    """Return a resolved or scenario-estimated definition cost."""
    definition_tokens = getattr(stat, "definition_tokens", None)
    if definition_tokens is not None:
        return float(definition_tokens)
    if scenario not in COST_SCENARIOS:
        raise ValueError(f"Unknown cost scenario: {scenario}")
    return getattr(stat, f"estimated_cost_{scenario}", None)


def _scenario_cost_for_tools(
    stats: Mapping[str, Any],
    tools: Iterable[str],
    scenario: str,
) -> float | None:
    costs: list[float] = []
    for tool in tools:
        stat = stats.get(tool)
        if stat is None:
            continue
        cost = scenario_cost(stat, scenario)
        if cost is None:
            return None
        costs.append(cost)
    return sum(costs)


def cluster_exposure_economics(
    sessions: list[Session],
    stats: Mapping[str, Any],
    specialist_tools: set[str],
    delegation_overhead_tokens: int,
) -> dict[str, Any]:
    """Report per-model exposure economics and break-even rates.

    Activation is based on historical calls. Baseline exposure is evaluated
    independently for each labeled exposure model. All averages use the
    supplied session population, including sessions without calls.
    """
    specialist_tools = set(specialist_tools)
    session_count = len(sessions)
    activation_sessions = sum(
        bool(session.tool_set & specialist_tools) for session in sessions
    )
    activation_rate = (
        activation_sessions / session_count if session_count else 0.0
    )
    definition_tokens = {
        scenario: _scenario_cost_for_tools(stats, specialist_tools, scenario)
        for scenario in COST_SCENARIOS
    }
    common = {
        "specialist_tool_count": len(specialist_tools),
        "specialist_definition_tokens_low": definition_tokens["low"],
        "specialist_definition_tokens_mid": definition_tokens["mid"],
        "specialist_definition_tokens_high": definition_tokens["high"],
        "activation_sessions": activation_sessions,
        "activation_rate": activation_rate,
    }

    economics_by_model: dict[str, dict[str, Any]] = {}
    for exposure_model in EXPOSURE_MODELS:
        states = baseline_exposure_states(sessions, exposure_model)
        exposed_by_session = {
            session.session_id: states[session.session_id].exposed_tools
            & specialist_tools
            for session in sessions
        }
        any_exposed = sum(
            bool(exposed_by_session[session.session_id]) for session in sessions
        )
        all_exposed = sum(
            len(exposed_by_session[session.session_id]) == len(specialist_tools)
            for session in sessions
        )
        average_exposed = (
            sum(
                len(exposed_by_session[session.session_id])
                for session in sessions
            )
            / session_count
            if session_count
            else 0.0
        )

        baseline_tokens: dict[str, float | None] = {}
        loaded_tokens: dict[str, float | None] = {}
        net_reduction: dict[str, float | None] = {}
        break_even_baseline: dict[str, float | None] = {}
        break_even_rate: dict[str, float | None] = {}
        for scenario in COST_SCENARIOS:
            per_session_costs = [
                _scenario_cost_for_tools(
                    stats,
                    exposed_by_session[session.session_id],
                    scenario,
                )
                for session in sessions
            ]
            known_costs = [cost for cost in per_session_costs if cost is not None]
            baseline = (
                statistics.fmean(known_costs)
                if len(known_costs) == len(per_session_costs) and known_costs
                else None
            )
            full_definition = definition_tokens[scenario]
            loaded = (
                (full_definition + delegation_overhead_tokens) * activation_rate
                if full_definition is not None
                else None
            )
            baseline_tokens[scenario] = baseline
            loaded_tokens[scenario] = loaded
            net_reduction[scenario] = (
                baseline - loaded
                if baseline is not None and loaded is not None
                else None
            )
            break_even_baseline[scenario] = loaded
            break_even_rate[scenario] = (
                loaded / full_definition
                if loaded is not None and full_definition
                else None
            )

        tool_rows = []
        for tool in sorted(specialist_tools):
            sessions_exposed = sum(
                tool in exposed_by_session[session.session_id]
                for session in sessions
            )
            sessions_called = sum(tool in session.tool_set for session in sessions)
            contribution = {}
            for scenario in COST_SCENARIOS:
                cost = scenario_cost(stats[tool], scenario)
                contribution[scenario] = (
                    cost * sessions_exposed / session_count
                    if cost is not None and session_count
                    else None
                )
            tool_rows.append(
                {
                    "tool": tool,
                    "sessions_baseline_exposed": sessions_exposed,
                    "exposure_rate": (
                        sessions_exposed / session_count if session_count else 0.0
                    ),
                    "sessions_called": sessions_called,
                    "usage_rate": (
                        sessions_called / session_count if session_count else 0.0
                    ),
                    "baseline_token_contribution": contribution,
                }
            )

        economics_by_model[exposure_model] = {
            **common,
            "sessions_with_any_specialist_tool_exposed": any_exposed,
            "sessions_with_all_specialist_tools_exposed": all_exposed,
            "average_specialist_tools_exposed_per_session": average_exposed,
            "baseline_specialist_tokens_per_session": baseline_tokens,
            "loaded_specialist_tokens_per_session": loaded_tokens,
            "net_specialist_token_reduction_per_session": net_reduction,
            "break_even_baseline_tokens_per_session": break_even_baseline,
            "break_even_full_cluster_exposure_rate": break_even_rate,
            "tools": tool_rows,
        }

    return {**common, "exposure_models": economics_by_model}
