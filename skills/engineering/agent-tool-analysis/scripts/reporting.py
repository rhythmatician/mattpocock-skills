"""Markdown and console presentation for agent tool analysis reports."""

from __future__ import annotations

from typing import Any, Iterable

from cost_evaluation import COST_SCENARIOS
from exposure_models import EXPOSURE_MODEL_DESCRIPTIONS, EXPOSURE_MODELS


def format_tools(values: Iterable[str]) -> str:
    return ", ".join(f"`{value}`" for value in values) or "none"


def _number(value: Any, suffix: str = "") -> str:
    if value is None:
        return "unavailable"
    return f"{value:.1%}{suffix}" if suffix == "%" else f"{value:.1f}{suffix}"


def _append_table(
    lines: list[str], headers: str, separator: str, rows: Iterable[str]
) -> None:
    lines.extend([headers, separator, *rows, ""])


def render_markdown(report: dict[str, Any]) -> str:
    pruned = report["pruned_flat_baseline"]
    lines = [
        "# Agent Tool Exposure Analysis",
        "",
        "This report is advisory. No agent configuration was modified.",
        "",
        "## Recommendation",
        "",
        f"**{pruned['recommendation']['headline']}**",
        "",
        f"- Observed dead-tool savings: {pruned['observed_exposure_tokens_removed_per_session']['mid']:.1f} known tool-definition tokens/session",
        f"- Catalog tokens removed: {pruned['catalog_tokens_removed']['mid']:.1f}",
        f"- Catalog-only safe candidates: {len(pruned['catalog_only_tools_removed'])} tools; exposure benefit unmeasured",
        f"- Unresolved retained runtime-tool exposure: {pruned['unresolved_retained_runtime_tool_exposure']['status']}",
        "",
        "## Corpus",
        "",
        f"- Sessions analyzed: {report['corpus']['sessions']}",
    ]
    for key in (
        "sessions_total",
        "sessions_with_calls",
        "sessions_with_direct_exposure",
        "sessions_with_calls_and_exposure",
        "sessions_with_calls_without_exposure",
        "sessions_with_exposure_without_calls",
    ):
        lines.append(f"- {key}: {report['corpus'][key]}")
    lines.extend(
        [
            f"- Tool calls: {report['corpus']['tool_calls']}",
            f"- Unique tools: {report['corpus']['unique_tools']}",
            "- Sources: "
            + ", ".join(
                f"{name}={count}" for name, count in report["corpus"]["sources"].items()
            ),
            "",
            "## Definition resolution",
            "",
        ]
    )
    _append_table(
        lines,
        "| Observed tool | Calls | Sessions called | Resolved | Source | Estimated tokens | Evidence |",
        "|---|---:|---:|---|---|---:|---|",
        (
            f"| `{row['observed_tool']}` | {row['calls']} | {row['sessions_called']} | "
            f"{'yes' if row['definition_resolved'] else 'no'} | `{row['definition_source'] or 'unresolved'}` | "
            f"{row['estimated_tokens'] if row['estimated_tokens'] is not None else 'unknown'} | {row['evidence_type']} |"
            for row in report["definition_resolution"]
        ),
    )

    discovery = report["definition_discovery"]
    manifest = discovery["runtime_manifest"]
    lines.extend(
        [
            "## Definition discovery",
            "",
            f"- Explicit records: {discovery['explicit_records']}",
            f"- Telemetry records: {discovery['telemetry_records']}",
            f"- Runtime roots scanned: {', '.join(manifest['roots']) or 'none'}",
            f"- Manifest files scanned: {manifest['files_scanned']}",
            f"- Manifest definitions found: {manifest['definitions_found']}",
            "",
            "## Tool inventory",
            "",
        ]
    )
    _append_table(
        lines,
        "| Tool | Directly observed exposure | Used | P(use|exposed) | Calls | Def tokens | Waste/session | Boundary margin | Recommendation |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---|",
        (
            f"| `{tool['name']}` | {tool['sessions_exposed']} | {tool['sessions_called']} | "
            f"{_number(tool['call_given_exposed'], '%')} | {tool['calls']} | "
            f"{tool['definition_tokens'] if tool['definition_tokens'] is not None else 'unknown'} | "
            f"{_number(tool['expected_unused_tokens_per_session'])} | "
            f"{_number(tool['boundary_margin'])} | {tool['classification']} |"
            for tool in report["tools"]
        ),
    )

    lines.extend(["## Candidate specialist agents", ""])
    if not report["candidate_agents"]:
        lines.extend(["No candidate clusters met the configured thresholds.", ""])
    else:
        for agent in report["candidate_agents"]:
            lines.extend(
                [
                    f"### {agent['candidate_id']} ({len(agent['tools'])} tools, {agent['session_coverage_rate']:.1%} session coverage)",
                    "",
                    f"- Internal affinity: {agent['internal_affinity']:.3f}",
                    f"- Known definition tokens isolated: {agent['known_definition_tokens']}",
                    f"- Tools: {format_tools(agent['tools'])}",
                    "",
                ]
            )

    lines.extend(["## Cluster boundaries", ""])
    _append_table(
        lines,
        "| Cluster | Internal affinity | Max external affinity | Mean boundary margin | Session coverage | Exclusive coverage | Overlapping coverage |",
        "|---|---:|---:|---:|---:|---:|---:|",
        (
            f"| `{cluster['cluster_id']}` | {cluster['internal_affinity']:.3f} | {cluster['max_external_affinity']:.3f} | "
            f"{cluster['mean_boundary_margin']:.3f} | {cluster['session_coverage']:.1%} | "
            f"{cluster['exclusive_session_coverage']:.1%} | {cluster['overlapping_session_coverage']:.1%} |"
            for cluster in report["clusters"]
        ),
    )

    overhead = report["overhead"]
    coverage = overhead["known_cost_coverage"]
    lines.extend(
        [
            "## Baseline overhead context",
            "",
            f"- Tool-definition cost coverage: {coverage['tools_with_known_cost']}/{coverage['tools_total']} ({coverage['catalog_coverage_rate']:.1%})",
            f"- Observed-tool cost coverage: {coverage['observed_tools_with_known_cost']}/{coverage['observed_tools_total']} ({coverage['observed_tool_coverage_rate']:.1%})",
            f"- Usage-weighted cost coverage: {coverage['calls_with_known_cost']}/{coverage['total_calls']} ({coverage['usage_weighted_coverage_rate']:.1%})",
            f"- Exposure-record cost coverage: {coverage['exposure_weighted_coverage_rate']:.1%}",
            f"- Flat baseline known definition tokens: {overhead['flat_baseline_known_tokens']:.1f}",
            f"- Parent known definition tokens after partition: {overhead['parent_known_tokens_after_partition']:.1f}",
            f"- Expected known tokens/session after partition: {overhead['expected_known_tokens_per_session_after_partition']:.1f}",
            f"- Expected known-token savings/session: {_number(overhead['expected_known_tokens_saved_per_session'])}",
            f"- Delegation overhead assumption: {overhead['delegation_overhead_tokens_per_activated_specialist']} tokens per activated specialist",
            "",
            overhead["interpretation"],
            "",
            "## Baseline exposure models",
            "",
            "Direct exposure is telemetry evidence. Inferred exposure is a labeled counterfactual assumption and is never derived from calls in the same session.",
            "",
        ]
    )
    _append_table(
        lines,
        "| Model | Description | Runtime catalog | Sessions with inferred exposure | Inferred exposure rows | Sessions with provider availability |",
        "|---|---|---:|---:|---:|---:|",
        (
            f"| `{model['model']}` | {model['description']} | {model['runtime_tool_catalog_size']} | "
            f"{model['sessions_with_inferred_exposure']} | {model['inferred_exposure_rows']} | {model['sessions_with_provider_availability']} |"
            for model in report["exposure_models"]
        ),
    )

    lines.extend(
        [
            "## Independent architecture variants",
            "",
            "Variants are ranked by mid-case relative reduction; negative values are reported, not selected away.",
            "",
        ]
    )
    lines.extend(
        [
            "## Pruned flat baseline",
            "",
            "The flat parent retains every historically used tool plus recursively required dependencies.",
            f"**Recommendation: {pruned['recommendation']['headline']}**",
            "",
            f"- Tools removed: {format_tools(pruned['tools_removed'])}",
            f"- Tools retained: {format_tools(pruned['tools_retained'])}",
            f"- Historical called-tool coverage: {pruned['historical_called_tool_coverage']:.1%}",
            f"- Dependency-preservation warnings: {pruned['dependency_preservation_warnings'] or 'none'}",
            f"- Directly observed, never-used tools removed: {format_tools(pruned['directly_observed_never_used_tools_removed'])}",
            f"- Catalog-only tools removed: {format_tools(pruned['catalog_only_tools_removed'])}",
            f"- Unresolved retained runtime-tool exposure: {pruned['unresolved_retained_runtime_tool_exposure']['status']} ({pruned['unresolved_retained_runtime_tool_exposure']['tool_count']} tools)",
            "",
        ]
    )
    _append_table(
        lines,
        "| Scenario | Catalog tokens removed | Observed exposure removed/session | Baseline before pruning | Baseline after pruning | Relative reduction |",
        "|---|---:|---:|---:|---:|---:|",
        (
            f"| {scenario} | {_number(pruned['catalog_tokens_removed'][scenario])} | "
            f"{_number(pruned['observed_exposure_tokens_removed_per_session'][scenario])} | "
            f"{_number(pruned['baseline_tokens_per_session_before_pruning'][scenario])} | "
            f"{_number(pruned['baseline_tokens_per_session_after_pruning'][scenario])} | "
            f"{pruned['relative_reduction'][scenario]:.1%} |"
            for scenario in COST_SCENARIOS
        ),
    )
    lines.extend(
        [
            "Specialist architecture variants below are rebased against `pruned_flat_baseline`.",
            "",
        ]
    )
    for variant in report["architecture_variants"]:
        lines.extend(
            [
                f"### {variant['rank']}. `{variant['variant_id']}`",
                "",
                f"- Baseline architecture: `{variant['baseline_architecture_id']}`",
                f"- Specialist tools: {format_tools(variant['specialist_tools'])}",
                f"- Historical called-tool coverage: {variant['historical_called_tool_coverage_rate']:.1%}",
                f"- Mid-case sensitivity: {_number(variant['sensitivity']['min_mid_reduction'], '%')} to {_number(variant['sensitivity']['max_mid_reduction'], '%')}",
                "",
            ]
        )
        for model in EXPOSURE_MODELS:
            lines.extend(
                [
                    f"#### Exposure model: `{model}`",
                    "",
                    EXPOSURE_MODEL_DESCRIPTIONS[model],
                    "",
                ]
            )
            metrics = variant["scenarios_by_exposure_model"][model]
            _append_table(
                lines,
                "| Metric | Low | Mid | High |",
                "|---|---:|---:|---:|",
                (
                    f"| {label} | "
                    + " | ".join(
                        "unavailable"
                        if metrics[scenario][key] is None
                        else (
                            f"{metrics[scenario][key]:.1%}"
                            if key == "relative_token_reduction"
                            else f"{metrics[scenario][key]:.1f}"
                        )
                        for scenario in COST_SCENARIOS
                    )
                    + " |"
                    for key, label in (
                        ("baseline_tokens_per_session", "Baseline tokens/session"),
                        ("proposed_tokens_per_session", "Proposed tokens/session"),
                        ("absolute_token_reduction_per_session", "Absolute reduction"),
                        ("relative_token_reduction", "Relative reduction"),
                        ("specialist_activation_rate", "Specialist activation rate"),
                    )
                ),
            )

    github = report["github_exposure_sensitivity"]
    lines.extend(["## GitHub exposure sensitivity analysis", ""])
    if github is None:
        lines.extend(["Cluster 1 was not an eligible specialist candidate.", ""])
    else:
        lines.extend(
            [
                "This is diagnostic sensitivity analysis, not reconstructed telemetry. "
                + github["assumption"],
                "",
                f"- Applicable Codex sessions: {github['applicable_session_count']}",
                f"- Historical specialist activation rate: {github['activation_rate']:.1%}",
                f"- Classification: `{github['classification']}`",
                "",
            ]
        )

    subset = report["cluster_one_subset_analysis"]
    lines.extend(["## Cluster 1 exhaustive subset evaluation", ""])
    if subset is None:
        lines.extend(["Cluster 1 was not an eligible specialist candidate.", ""])
    else:
        lines.extend(
            [
                f"Evaluated {subset['subset_count']} subsets containing at least two Cluster 1 tools. Excluded tools remain on the parent.",
                "",
                "### Pareto frontier",
                "",
            ]
        )
        for row in subset["pareto_frontier"]:
            lines.append(
                f"- {format_tools(row['tools'])}: break-even {_number(row['break_even_exposure_rate_mid'], '%')}, definition {_number(row['definition_tokens_mid'])}, activation {row['activation_rate']:.1%}"
            )
        lines.append("")

    decision = report["candidate_decision_table"]
    lines.extend(["## Candidate decision table", ""])
    if decision is None:
        lines.extend(["Cluster 1 candidate decisions are unavailable.", ""])
    else:
        _append_table(
            lines,
            "| Candidate | Type | Tools | Activation | Definition tokens | Affinity | Min boundary | Worst-case reduction | Viable cells |",
            "|---|---|---|---:|---:|---:|---:|---:|---:|",
            (
                f"| `{candidate['candidate_id']}` | {candidate['candidate_type']} | {format_tools(candidate['tools'])} | {candidate['activation_rate']:.1%} | "
                f"{candidate['specialist_definition_tokens']:.1f} | {candidate['internal_affinity']:.3f} | {candidate['minimum_boundary_margin']:.3f} | "
                f"{candidate['worst_case_positive_reduction']:.1f} | {candidate['viable_cells']:.1%} |"
                for candidate in decision["candidates"]
            ),
        )

    provider = report["provider_availability_diagnostics"]
    lines.extend(
        [
            "## Provider availability reconstruction",
            "",
            "Availability and mappings below come only from explicit dynamic-tools groups; runtime calls never establish provider availability.",
            "",
        ]
    )
    _append_table(
        lines,
        "| Provider | Groups observed | Sessions | Advertised tools |",
        "|---|---:|---:|---|",
        (
            f"| `{row['provider']}` | {row['group_count']} | {row['session_count']} | {format_tools(row['tools_advertised'])} |"
            for row in provider["provider_groups_observed"]
        ),
    )
    github_provider = provider["github"]
    lines.extend(
        [
            "### GitHub-specific reconstruction",
            "",
            f"- Advertised GitHub-like tools: {format_tools(github_provider['advertised_github_like_tools'])}",
            f"- Runtime `github.*` tools: {format_tools(github_provider['runtime_github_tools'])}",
            f"- Unresolved mappings: {format_tools(github_provider['unresolved_mappings'])}",
            "",
            "## Provider-scoped session diagnostics",
            "",
        ]
    )
    _append_table(
        lines,
        "| Session | Provider availability observed? | Providers available | Inferred runtime tools | Directly exposed tools | Called tools |",
        "|---|---|---|---|---|---|",
        (
            f"| `{row['session_id']}` | {'yes' if row['provider_availability_observed'] else 'no'} | {format_tools(row['providers_available'])} | "
            f"{format_tools(row['inferred_runtime_tools'])} | {format_tools(row['directly_exposed_tools'])} | {format_tools(row['called_tools'])} |"
            for row in report["provider_scoped_session_diagnostics"]
        ),
    )

    lines.extend(["## Dependency warnings", ""])
    if not report["dependency_warnings"]:
        lines.append("No known dependency separations were detected.")
    else:
        for warning in report["dependency_warnings"]:
            lines.append(
                f"- {warning['candidate_id']}: {warning['missing_dependencies']}"
            )
    lines.extend(["", "## Strongest tool relationships", ""])
    _append_table(
        lines,
        "| Tool A | Tool B | Affinity | Jaccard | Overlap | Adjacent calls |",
        "|---|---|---:|---:|---:|---:|",
        (
            f"| `{pair['tool_a']}` | `{pair['tool_b']}` | {pair['affinity']:.3f} | {pair['jaccard']:.3f} | {pair['overlap']:.3f} | {pair['adjacency_count']} |"
            for pair in report["strongest_pairs"][:30]
        ),
    )
    lines.extend(["## Caveats", "", *(f"- {caveat}" for caveat in report["caveats"])])
    return "\n".join(lines) + "\n"


def print_summary(report: dict[str, Any], json_path: Any, markdown_path: Any) -> None:
    corpus = report["corpus"]
    overhead = report["overhead"]
    print("=" * 72)
    print("AGENT TOOL EXPOSURE ANALYSIS")
    print("=" * 72)
    print(f"Sessions analyzed: {corpus['sessions']}")
    print(f"Tool calls:        {corpus['tool_calls']}")
    print(f"Unique tools:      {corpus['unique_tools']}")
    print(f"Clustered tools:   {corpus['active_tools_for_clustering']}")
    print(f"Global candidates: {len(report['global_candidates'])}")
    print(f"Agent candidates:  {len(report['candidate_agents'])}")
    coverage = overhead["known_cost_coverage"]
    print(
        f"\nKnown tool-cost coverage: {coverage['tools_with_known_cost']}/{coverage['tools_total']} (catalog {coverage['catalog_coverage_rate']:.1%}, usage-weighted {coverage['usage_weighted_coverage_rate']:.1%})"
    )
    savings = overhead["expected_known_token_savings_rate"]
    print(
        f"Expected known-token savings/session: {overhead['expected_known_tokens_saved_per_session']:.1f} ({savings:.1%})"
        if savings is not None
        else "Expected known-token savings/session: unavailable"
    )
    print(f"\nJSON report:     {json_path.resolve()}")
    print(f"Markdown report: {markdown_path.resolve()}")
    print("\nNext: inspect the Markdown report before generating or installing agents.")
