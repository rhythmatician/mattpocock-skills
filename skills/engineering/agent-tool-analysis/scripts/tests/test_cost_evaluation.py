from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from cost_evaluation import cluster_exposure_economics
from telemetry_ingestion import Session


def _stats() -> dict[str, SimpleNamespace]:
    return {
        "github.one": SimpleNamespace(
            definition_tokens=10,
            estimated_cost_low=None,
            estimated_cost_mid=None,
            estimated_cost_high=None,
        ),
        "github.two": SimpleNamespace(
            definition_tokens=20,
            estimated_cost_low=None,
            estimated_cost_mid=None,
            estimated_cost_high=None,
        ),
    }


def test_cluster_economics_reports_break_even_and_tool_contributions() -> None:
    sessions = [
        Session("active", "codex", ["github.one"], {"github.one", "github.two"}),
        Session("partial", "codex", ["github.two"], {"github.two"}),
        Session("idle", "codex", [], set()),
    ]

    diagnostics = cluster_exposure_economics(
        sessions, _stats(), {"github.one", "github.two"}, 0
    )

    assert diagnostics["specialist_tool_count"] == 2
    assert diagnostics["specialist_definition_tokens_mid"] == 30.0
    assert diagnostics["activation_sessions"] == 2
    assert diagnostics["activation_rate"] == 2 / 3

    observed = diagnostics["exposure_models"]["observed_only"]
    assert observed["sessions_with_any_specialist_tool_exposed"] == 2
    assert observed["sessions_with_all_specialist_tools_exposed"] == 1
    assert observed["average_specialist_tools_exposed_per_session"] == 1.0
    assert observed["baseline_specialist_tokens_per_session"]["mid"] == 50 / 3
    assert observed["loaded_specialist_tokens_per_session"]["mid"] == 20.0
    assert observed["net_specialist_token_reduction_per_session"]["mid"] == pytest.approx(-10 / 3)
    assert observed["break_even_baseline_tokens_per_session"]["mid"] == 20.0
    assert observed["break_even_full_cluster_exposure_rate"]["mid"] == 2 / 3

    one = next(row for row in observed["tools"] if row["tool"] == "github.one")
    assert one["sessions_baseline_exposed"] == 1
    assert one["exposure_rate"] == 1 / 3
    assert one["sessions_called"] == 1
    assert one["usage_rate"] == 1 / 3
    assert one["baseline_token_contribution"]["mid"] == 10 / 3


def test_cluster_economics_keeps_provider_scoped_tools_narrow() -> None:
    sessions = [
        Session(
            "github-available",
            "codex",
            [],
            set(),
            provider_availability={"github"},
            provider_tools={"github": {"github.one"}},
        ),
        Session(
            "other-provider",
            "codex",
            [],
            set(),
            provider_availability={"other"},
            provider_tools={"other": {"other.tool"}},
        ),
    ]

    provider = cluster_exposure_economics(
        sessions, _stats(), {"github.one", "github.two"}, 0
    )["exposure_models"]["provider_scoped"]

    assert provider["sessions_with_any_specialist_tool_exposed"] == 1
    assert provider["sessions_with_all_specialist_tools_exposed"] == 0
    assert provider["average_specialist_tools_exposed_per_session"] == 0.5
    assert provider["baseline_specialist_tokens_per_session"]["mid"] == 5.0
