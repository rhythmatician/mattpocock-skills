---
name: feedback-loop-health
description: Assess feedback-loop health. Use when build, test, verification, or review feedback is slow, unreliable, or poorly measured.
---

# Feedback Loop Health

## Status

This is an intentionally incomplete beta stub. It establishes the shared evidence contract for feedback-loop analysis.

**TODO:** Implement the measurement adapters and health interpretation in [issue #8](https://github.com/rhythmatician/mattpocock-skills/issues/8).

Use `skills/in-progress/repository-analysis/` for tool probes, bounded subprocesses, temporary artifacts, caching, Git metadata, and normalized evidence. This skill owns the judgment about feedback-loop health.

Measure where possible: build, focused-test, full-test, lint, typecheck, and verification timing; distinguish observed timings from recommendations. Reuse timing evidence from compatible previous reports rather than rerunning commands.

Use the requested `quick`, `standard`, or explicitly justified `deep` depth. Missing commands and failed optional tools must remain visible as partial results. Do not install tooling or modify the target repository.