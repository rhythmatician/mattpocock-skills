---
name: knowledge-hygiene
description: Assess knowledge hygiene. Use when repository documentation, decisions, runbooks, or graph evidence may be stale or hard to find.
---

# Knowledge Hygiene

## Status

This is an intentionally incomplete beta stub. It establishes the shared evidence contract for knowledge analysis.

**TODO:** Implement the knowledge-specific analyzers and hygiene interpretation in [issue #3](https://github.com/rhythmatician/mattpocock-skills/issues/3).

Use `skills/in-progress/repository-analysis/` for repository discovery, exclusions, reusable artifacts, report provenance, and partial-success handling. Do not encode knowledge judgments in that shared layer.

Assess whether code, decisions, runbooks, and generated/reusable repository artifacts remain findable and credible. Consume a valid `graphify-out/graph.json` through an adapter when it exists; do not rebuild equivalent graph evidence by default.

Respect bounded analysis depth. Report each fact with its source and label any interpretation as a knowledge-hygiene judgment. Do not modify the target repository during an audit.