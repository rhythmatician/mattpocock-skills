## What it does

`graphify` turns code and project material into an evidence-backed knowledge graph that you can query, traverse, explain, or export.

Its defining constraint is provenance: every useful relationship stays tied to evidence, and uncertainty remains visible instead of being promoted into a fact.

## When to reach for it

Type `/graphify`, or the agent reaches for it automatically when a task fits.

Reach for it when an existing graph can answer an architecture or relationship question, or when you need to build, update, export, or watch a graph over code or project content. For a design decision about a chosen module seam, use [codebase-design](https://aihero.dev/skills-codebase-design) instead.

## The graph is an audit trail

Graphify makes broad relationships navigable without asking you to trust a black box. It distinguishes extracted facts, supported inferences, and ambiguity so a graph answer can still be traced back to its source material.

For an ordinary question, it reuses an existing graph read-only. Building or changing a graph is an explicit persistence decision.

## Common questions

**Do I need to build a graph before asking a question?**

No. If no graph exists and you did not explicitly ask to build one, normal source exploration remains the better first move.

## It's working if

- Answers name the graph evidence and source locations behind them.
- Uncertain relationships are visible as uncertain rather than stated as facts.
- A query does not unexpectedly rebuild or overwrite a graph.

## Where it fits

Graphify is a reach-for-it-anytime evidence tool for cross-cutting structure and relationships. It can support [wayfinder](https://aihero.dev/skills-wayfinder) planning, but Wayfinder retains ownership of planning decisions. See [ask-matt](https://aihero.dev/skills-ask-matt) for the full skill map.
