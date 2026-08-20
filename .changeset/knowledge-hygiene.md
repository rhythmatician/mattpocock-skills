---
"mattpocock-skills": minor
---

Add `knowledge-hygiene`, a review-only engineering skill that detects duplicate authority, stale repository knowledge, conflicting agent instructions, state leaked into durable docs, unclear supersession, and code/doc source-of-truth splits. It learns each repository's authority model, uses deterministic searches and existing Graphify graphs to generate candidates, and requires evidence before recommending consolidation or structural enforcement.

Three corrections from Voxygen trial:
1. **True duplicate authority vs. authority-shaped debt** — "Looks current/binding" is no longer sufficient. Confirmed duplicate authority requires two independently maintained locations empowered by the repository's authority model to define the same current truth. Current-sounding legacy/unadmitted prose is classified as authority-shaped debt.
2. **Proposition, not ancestry, for supersession** — A current contract is not stale merely because a rule originated under a superseded ADR. The skill compares the actual proposition against the successor/current authority.
3. **No synchronization debt as remediation** — Derived/explanatory artifacts with clear deference normally need no change or one stable source pointer. Per-entry or line-number backlinks are discouraged unless granular provenance solves a demonstrated ambiguity with generation/validation.
