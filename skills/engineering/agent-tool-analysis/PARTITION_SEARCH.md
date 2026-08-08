# Label-free partition search

The optimizer's internal `partition_search` module generates candidate
architectures from observed tool sessions. The normal public entry point is
`python -m optimize_agent_tools`; the module is not a separate user workflow.
It does not assign semantic labels, learn routes, or choose one opaque winner.

## Inputs and search

The pure `search_partitions()` API accepts:

- observed `Session` records;
- per-tool definition statistics (`definition_tokens` or `estimated_cost_mid`);
- required retained tools;
- optional explicitly global/shared tools;
- dependency edges;
- a configurable `max_agents` (default `3`);
- delegation and inter-agent communication token assumptions.

Dependencies are expanded transitively and dependency-connected tools are kept
in the same partition unit. Explicit global tools remain on the parent surface.
For small graphs the search exhaustively enumerates canonical set partitions for
every `k` from `1` through `max_agents`. Larger graphs use a deterministic
affinity-guided bounded search and report `search_complete: false`; this keeps
the tool bounded without presenting a heuristic frontier as exhaustive.

## Measurements

Each candidate reports:

- per-agent tool-definition cost;
- historical activation rate from sessions that called an agent's tools;
- cross-agent session frequency;
- expected ordered handoff count from observed call sequences;
- expected context cost before communication overhead;
- expected context cost after delegation and communication overhead.

The Pareto dimensions are context cost after overhead, maximum agent definition
cost, cross-agent session frequency, handoff count, and agent count. Every
non-dominated candidate is retained.

## Manifest output

The result includes a generic manifest with the frozen `pruned_flat_baseline`
plus one architecture per Pareto candidate. Agent IDs are generated as
`agent_01`, `agent_02`, and so on; no semantic labels are introduced. The
manifest can be passed directly to `replay_architectures.py`. Replay still owns
quality evaluation and the strict benchmark gate; partition search only proposes
and measures candidate surfaces.

The normal command writes the candidate metrics into
`agent_tool_analysis/agent_tool_analysis.json` and writes the manifest to
`agent_tool_analysis/architecture_manifest.json`. The manifest preserves the
strict frozen `pruned_flat_baseline`; replay is an optional advanced validation
step and rejects a mismatched benchmark report. Candidate generation is part of
the normal analyze-and-recommend workflow.