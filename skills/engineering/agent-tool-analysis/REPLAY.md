# Replay/A-B harness

The replay harness freezes `pruned_flat_baseline` as the benchmark architecture and compares it with:

- `pareto_02`: `github.add_review_to_pr` + `github.reply_to_review_comment`
- `pareto_03`: `github.fetch_file` + `github.list_pr_changed_filenames`

Routing is intentionally explicit: each task may set `required_specialist` to one of those IDs. No routing optimization, learned policy, fallback policy, or exposure inference is performed.

## Candidate success gate

A candidate passes only when all three conditions hold:

- historical capability coverage is exactly 100%;
- mean task quality is at least the `pruned_flat_baseline` result;
- total tool-definition/context tokens are strictly lower than `pruned_flat_baseline`.

The harness reports task success, tool-call failures, routing failures, missed and unnecessary specialist activations, total input tokens, tool-definition/context tokens, turns, specialist handoffs, and wall-clock time.

## Recorded replay input

Use `replay_input.example.json` as the schema example. The bundle contains:

- `tasks`: ordered task records with `task_id` and optional `required_specialist`;
- `observations`: one ordered observation list for each architecture ID.

Each observation records task success, capability coverage, quality, and the operational measurements. `specialist_activated` is the actual activation observed by the executor; handoffs and routing metrics are derived from it plus the explicit task route.

## Run

Generate or refresh `agent_tool_analysis/agent_tool_analysis.json` first, then run the recorded comparison through `replay_architectures.py`. The CLI verifies that its `pruned_flat_baseline.tools_retained` matches the source-frozen benchmark surface before accepting the report. Supply a real replay bundle in place of the example before treating any result as evidence.

The CLI emits JSON to stdout unless an output path is supplied. The example observations are synthetic placeholders and are not a quality claim.
