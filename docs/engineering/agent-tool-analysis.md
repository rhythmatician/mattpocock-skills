## What it does

`agent-tool-analysis` turns observed coding-agent tool telemetry into a recommendation: remove dead tools, compare the pruned flat agent with simple specialist candidates, and explain the smallest architecture worth considering.

The analysis does not infer semantic responsibilities or learn routing. It preserves required capabilities, closes known dependencies, and leaves quality validation to optional replay.

## When to reach for it

Type `/agent-tool-analysis`, or the agent reaches for it automatically when a task fits. Reach for it when you need to understand wasted tool-definition context or compare telemetry-grounded flat and multi-agent surfaces; for a reported runtime failure, use [diagnosing-bugs](https://aihero.dev/skills-diagnosing-bugs) instead.

## The normal path

Run `python -m optimize_agent_tools` from the skill's `scripts` directory. Read the generated Markdown report first, then use its JSON companion when you need exact metrics. The command also writes an architecture manifest for optional replay; replay remains subject to the strict frozen-baseline check.

The leading idea is **evidence before labels**: tool co-occurrence, call order, definition cost, activation, handoffs, and capability coverage come from observed sessions. Generic candidates are inputs to explanation, not final agent definitions.

## Common questions

**Does the search decide what each agent is called?**

No. It emits generic agent IDs and tool membership only. Semantic labels and descriptions belong after the empirical comparison.

**Can the output go straight to replay?**

Yes, when empirical validation is wanted and the benchmark report matches the frozen baseline. The normal command writes `architecture_manifest.json` with `baseline_architecture_id`, `historical_tool_capability_tools`, and `architectures` at its root. Replay is an advanced escape hatch, not a required step.

**Why does a large run say the search is incomplete?**

Set partitions grow quickly. The command uses a bounded deterministic search for large graphs and labels that result as incomplete rather than presenting it as exhaustive.

## It's working if

- The normal command produces one analysis report, one Markdown explanation, and one replay-ready manifest.
- The output contains candidates for each feasible `k` from `1` through the configured maximum.
- Every retained required tool and dependency appears in the manifest, while explicitly global tools remain on the parent.
- Each candidate reports definition costs, activation rates, cross-agent frequency, handoffs, and context cost before and after communication overhead.
- `pareto_candidate_ids` contains multiple candidates when the evidence supports trade-offs rather than silently selecting one.
- The generated manifest passes the replay harness's frozen `pruned_flat_baseline` validation.

## Where it fits

`agent-tool-analysis` is a standalone recommendation step: run the optimizer, inspect the evidence, and explain the suggested architecture. Replay is an optional validation neighbour; [code-review](https://aihero.dev/skills-code-review) checks implementation quality rather than telemetry economics; [research](https://aihero.dev/skills-research) is for external facts rather than local sessions. For the full map, see [ask-matt](https://aihero.dev/skills-ask-matt).
