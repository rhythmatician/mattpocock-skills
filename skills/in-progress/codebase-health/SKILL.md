---
name: codebase-health
description: Coordinate bounded repository-health diagnostics and combine their structured evidence into one report.
disable-model-invocation: true
---

# Codebase Health

## Status

This is an intentionally incomplete beta stub. It establishes the orchestration contract; it cannot produce a domain health audit until the four child diagnostics receive their analyzer implementations.

**TODO:** Implement the child-diagnostic orchestration in [issue #7](https://github.com/rhythmatician/mattpocock-skills/issues/7).

Coordinate `maintenance-risk`, `test-suite-health`, `knowledge-hygiene`, and `feedback-loop-health`. Ask for a depth when one is not supplied; default to `quick`. Do not start `deep` analysis without an explicit reason.

Create one shared session through `skills/in-progress/repository-analysis/`. Launch applicable child diagnostics with the same session metadata and let them reuse normalized evidence, artifact cache, and tool versions; each child owns a distinct temporary-artifact directory. Do not scrape child prose: combine their structured reports, preserving each fact's producing skill, adapter, and tool.

Present unavailable analyzers and failed checks as partial results. Do not modify the target repository, install analyzers, or turn an audit into durable enforcement.