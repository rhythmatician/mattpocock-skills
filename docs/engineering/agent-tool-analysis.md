## What it does

`agent-tool-analysis` turns observed coding-agent tool telemetry into evidence about tool exposure, definition cost, and candidate architectures. Its label-free partition search generates bounded candidates for each agent count from the observed tool graph, then keeps every Pareto-optimal manifest instead of naming one winner.

The search does not infer semantic responsibilities or learn routing. It preserves required retained tools, keeps explicitly shared tools on the parent surface, closes known dependencies, and leaves quality validation to the replay harness.

## When to reach for it

Type `/agent-tool-analysis`, or the agent reaches for it automatically when a task fits. Reach for it when you need to understand wasted tool-definition context or compare telemetry-grounded flat and multi-agent surfaces; for a reported runtime failure, use [diagnosing-bugs](https://aihero.dev/skills-diagnosing-bugs) instead.

## Prerequisites

The analyzer needs observed VS Code or Codex session telemetry and a generated `agent_tool_analysis.json` report. The partition search writes a JSON artifact containing a replay-compatible architecture manifest and its candidate metrics.

## Evidence before labels

The leading idea is **evidence**: tool co-occurrence, call order, definition cost, activation rate, cross-agent sessions, and handoffs come from observed sessions. Agent IDs stay generic (`agent_01`, `agent_02`) so semantic naming remains a later interpretation step rather than a hidden search decision.

For small graphs, the search is exhaustive across `k=1..K`. When the partition space exceeds its configured bound, it uses a deterministic affinity-guided sample and marks the result incomplete instead of presenting it as the full search space.

## Common questions

**Does the search decide what each agent is called?**

No. It emits generic agent IDs and tool membership only. Semantic labels and descriptions belong after the empirical comparison.

**Can the output go straight to replay?**

Yes. The output JSON has `baseline_architecture_id`, `historical_tool_capability_tools`, and `architectures` at its root, so `replay_architectures.py` can consume it as an architecture manifest. Candidate metrics and search metadata are included alongside those fields.

**Why does a large run say the search is incomplete?**

Set partitions grow quickly. The configurable bounds keep the analyzer usable on real telemetry; the output tells you when it used the deterministic affinity-guided fallback, and still retains the Pareto frontier of candidates it actually evaluated.

## It's working if

- The output contains candidates for each feasible `k` from `1` through the configured `K`.
- Every retained required tool and dependency appears in the manifest, while explicitly global tools remain on the parent.
- Each candidate reports definition costs, activation rates, cross-agent frequency, handoffs, and context cost before and after communication overhead.
- `pareto_candidate_ids` contains multiple candidates when the evidence supports trade-offs rather than silently selecting one.
- The generated manifest passes the replay harness's frozen `pruned_flat_baseline` validation.

## Where it fits

`agent-tool-analysis` is a telemetry-analysis step that feeds interpretation and replay: inspect evidence, generate candidate manifests, replay them, then review the result. Its closest neighbour is [code-review](https://aihero.dev/skills-code-review), which checks the implementation rather than the telemetry economics; [research](https://aihero.dev/skills-research) is for external facts rather than local observed sessions. For the full map, see [ask-matt](https://aihero.dev/skills-ask-matt).
