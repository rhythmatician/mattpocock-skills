---
name: maintenance-risk
description: Assess maintenance risk. Use when recurring changes, hotspots, temporal coupling, or dependency fan-out need an evidence-backed audit.
---

# Maintenance Risk

## Status

This is an intentionally incomplete beta stub. It establishes the shared evidence contract for maintenance analysis.

**TODO:** Implement the maintenance-specific analyzers and risk interpretation in [issue #1](https://github.com/rhythmatician/mattpocock-skills/issues/1).

Use the shared TypeScript substrate at `skills/in-progress/repository-analysis/` for repository discovery, depth, Git metadata, history filtering, optional tool probes, cache, artifacts, and normalized evidence. Do not recreate those mechanics here.

Interpret evidence about change concentration, temporal coupling, dependency fan-out, and code complexity. Report ranked risks with measured facts and provenance; distinguish a measured signal from your maintenance judgment.

Honor the requested depth: `quick` uses existing artifacts and cheap deterministic checks, `standard` surveys normal local analyzers, and `deep` requires an explicit reason before repeated or specialist analysis. Missing analyzers are partial results, never silent skips.

Do not modify the target repository. Return structured evidence that `test-suite-health`, `feedback-loop-health`, and `codebase-health` can reuse.