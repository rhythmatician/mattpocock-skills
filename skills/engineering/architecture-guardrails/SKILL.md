---
name: architecture-guardrails
description: Turn a settled architectural invariant into executable dependency or boundary enforcement.
disable-model-invocation: true
---

# Architecture Guardrails

Turn one settled architectural invariant into a repository check that makes violations mechanically difficult. This skill enforces architecture that has already been decided. It does not audit, choose, or redesign the architecture.

## 1. Admit only a settled rule

Require an exact invariant, including the subjects, direction, and whether the relationship is permitted, forbidden, or required. Establish that it is settled from either:

- an existing durable authority such as an accepted ADR, architecture document, design record, or accepted decision issue; or
- the user's unambiguous declaration that this exact rule is settled.

Enforcement still needs a stable authority reference. Reuse an existing durable artifact when one exists. If the user supplies the settled rule without one, state the exact decision back, get authorization to record it, and create or update the repository's normal decision artifact or an accepted issue or task before wiring the guardrail; if the user does not authorize a durable record, stop.

Record every intentional exception and its scope. Reject broad preferences such as "keep modules clean" or "avoid coupling" because they cannot produce a binary verdict.

If the rule is provisional, contested, ambiguous, or still requires an architecture choice, stop: state what is unsettled and ask the user to settle it before invoking this skill again.

This step is complete when the invariant, authority, exact relationship, boundary, and exceptions can be stated without inference, and the durable authority already exists.

## 2. Ground the target repository

Read the repository's instructions and inspect its ecosystem before choosing a mechanism:

- language, module, package, and build manifests;
- workspace, package, and source boundaries;
- existing compiler, linter, architecture test, dependency rule, and build configuration;
- package-manager commands and the local verification entry point;
- CI workflows and their existing verification path.

Inspect actual dependency edges only as needed to place and test the rule. An existing `graphify-out/graph.json` may help explore what depends on what; graphify is evidence for exploration, never the enforcement oracle. Keep audit-only exploration tools ephemeral and out of the target project's durable dependencies.

This step is complete when the repository's real boundary and current local and CI verification paths are identified.

## 3. Choose the strongest feasible rung

Prefer the highest practical rung that expresses the exact invariant:

1. Make the invalid relationship unrepresentable through the ecosystem's module, visibility, package, type, or build boundaries.
2. Use an established compiler, architecture-test, dependency-lint, or build rule that fails local and CI verification.
3. Concentrate access through a canonical interface or helper, or validate at the system boundary when static enforcement is not feasible.
4. Keep a concise prose instruction only when no mechanical mechanism can express the rule.

Prefer an enforcement tool already established in the repository when it can express the rule cleanly. Otherwise select a mature, maintained tool native to the target ecosystem, with documented support for the required relationship and normal local and CI use; an enforcement dependency intentionally added here may become part of the repository's verification contract. Do not build a custom dependency analyzer when an established tool can express the invariant, and do not promote an audit tool into a durable dependency merely because it can display the current graph.

Explain why the selected rung is the strongest feasible one. This step is complete when one mechanism owns the binary verdict and its operational cost fits the repository.

## 4. Design the guardrail at the boundary

Put the policy at the architectural boundary it governs. Prefer one centralized rule over defensive checks scattered through business logic.

Specify:

- the source side and target side of the relationship;
- whether the relationship is permitted, forbidden, or required;
- the dependency direction and scope;
- every narrow exception, with the reason and owning authority;
- a stable reference to the durable authority.

The enforcement configuration should point to the authority, not restate its rationale. Keep exceptions in the same enforcement surface when the tool permits it, so the whole policy is reviewable together.

This step is complete when a reviewer can predict every relevant pass and failure from the rule without reading scattered prose.

## 5. Implement through the repository's verification contract

Follow the target repository's package, configuration, and version conventions. Merge with existing enforcement configuration rather than replacing it. Add the smallest command or script that runs the guardrail, then connect it to the established local verification and CI path without duplicating checks.

Keep enforcement project and language specific only in the target repository; the workflow and report remain project and language agnostic.

This step is complete when the real local verification entry point and CI both reach the new guardrail.

## 6. Prove the rule bites

Use the real enforcement tool and commands, not inspection of the configuration as a proxy.

1. Run the focused guardrail against the intended architecture and show that an allowed case passes.
2. Where safe and practical, introduce one reversible representative violation at the governed boundary: add a forbidden relationship, remove or bypass a required one, or introduce the smallest representative cycle.
3. Run the same focused command and show that it fails for the expected rule and location.
4. Remove the temporary violation, verify the worktree contains no proof residue, and show that the focused command passes again.
5. Run the repository's broader local verification path and any proportionate CI validation.

Prefer an existing fixture or isolated temporary worktree for destructive proof, and never leave the representative violation committed. If a failure proof is unsafe or impractical, state the exact reason and the strongest proof performed instead.

This step is complete when the allowed case passes, a representative forbidden case fails where practical, cleanup is verified, and the final repository passes its normal checks.

## 7. Retire superseded prose safely

Search for textual instructions that previously carried the exact enforced rule. Remove only prose fully superseded by the mechanism whose durable authority remains discoverable from the enforcement point.

Keep decision rationale, intentional exceptions, user-facing explanation, and any instruction that still requires judgment; do not delete ambiguous or broader guidance merely because it overlaps the new check.

This step is complete when the authority remains intact, the executable rule is the single enforcement point, and no duplicate instruction still asks readers to enforce the same relationship by memory.

## Report

For every implemented guardrail, report:

- Invariant: the exact permitted, forbidden, or required relationship.
- Authority: the durable decision artifact, including whether it was reused or created with user authorization.
- Tool and rung: the enforcement mechanism and why it is the strongest feasible choice.
- Location: configuration, test, or boundary files changed.
- Commands: focused, local verification, and CI entry points.
- Proof: allowed pass, representative forbidden failure, cleanup, and final pass.
- Exceptions: every intentional exemption, or `none`.
- Prose retired: superseded instructions removed, or why none were safe to remove.

The work is complete only when each field is explicit and every unavailable proof or integration has a named reason.
