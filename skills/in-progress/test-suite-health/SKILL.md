---
name: test-suite-health
description: Assess test-suite health. Use when test reliability, isolation, feedback timing, or mutation evidence needs an audit.
---

# Test Suite Health

## Status

This is an intentionally incomplete beta stub. It establishes the shared evidence contract for test-suite analysis.

**TODO:** Implement the test-specific analyzers and health interpretation in [issue #2](https://github.com/rhythmatician/mattpocock-skills/issues/2).

Use `skills/in-progress/repository-analysis/` for repository and tool discovery, bounded execution, artifacts, cache, normalized evidence, and partial failure reporting. Keep test-quality judgments here, not in the shared substrate.

Assess observable test health: execution reliability, focused-versus-full feedback, timing, isolation, randomized ordering where available, and mutation evidence where applicable. Reuse hotspot evidence from `maintenance-risk` when present instead of recalculating it.

Use `quick`, `standard`, or explicitly justified `deep` analysis. An unavailable test tool or unsupported ecosystem is a structured partial result. Do not install dependencies or modify the target repository during an audit.