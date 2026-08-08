"""Sparse exposure matrix reporting."""

from __future__ import annotations

from typing import Any

from .telemetry_ingestion import Session


def build_exposure_matrix(
    sessions: list[Session], stats: dict[str, Any]
) -> list[dict[str, Any]]:
    matrix: list[dict[str, Any]] = []
    for session in sessions:
        for name in sorted(session.exposed_tools | session.tool_set):
            if name not in stats:
                continue
            stat = stats[name]
            matrix.append(
                {
                    "session_id": session.session_id,
                    "tool_name": name,
                    "directly_observed_exposure": name
                    in session.directly_observed_exposure,
                    "actual_call": name in session.actual_calls,
                    "exposed": name in session.exposed_tools,
                    "called": name in session.tool_set,
                    "call_count": session.calls.count(name),
                    "definition_tokens": stat.definition_tokens,
                    "definition_source": stat.definition_cost_source,
                    "exposure_source": session.exposure_source
                    if name in session.exposed_tools
                    else "not_observed",
                }
            )
    return matrix


def exposure_matrix_summary(
    sessions: list[Session], stats: dict[str, Any]
) -> dict[str, int]:
    return {
        "sessions": len(sessions),
        "known_tools": len(stats),
        "possible_rows": len(sessions) * len(stats),
        "observed_rows": len(build_exposure_matrix(sessions, stats)),
    }
