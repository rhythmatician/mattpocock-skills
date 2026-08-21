## What it does

`architecture-guardrails` turns one settled architectural invariant into an executable dependency or boundary check that runs locally and in CI. It can preserve forbidden or required dependency directions, layering, cycle rules, test-only boundaries, adapter boundaries, and public seams.

The architecture must already be decided, either in a durable authority or through your unambiguous declaration that the exact rule is settled. Enforcement always points to a stable decision record, so with your authorization the skill records an explicitly supplied decision before wiring the check. It will not turn a provisional preference into policy or conduct an architecture audit to invent the rule.

## When to reach for it

You invoke this by typing `/architecture-guardrails`, and the [agent](https://www.aihero.dev/ai-coding-dictionary/agent) won't reach for it on its own.

| Your situation | Reach for |
| --- | --- |
| An accepted decision needs a local and CI enforcement check | `architecture-guardrails` |
| You can state the exact rule as settled but it has not been recorded yet | `architecture-guardrails`, with authorization to record the decision before enforcement |
| A precise dependency, layering, cycle, adapter, or public-seam rule keeps being violated | `architecture-guardrails` |
| The correct architecture is still unclear or disputed | [improve-codebase-architecture](https://aihero.dev/skills-improve-codebase-architecture) |
| You need evidence about current dependencies or relationships | [graphify](https://aihero.dev/skills-graphify) |
| Repository docs disagree about which rule is current | [knowledge-hygiene](https://aihero.dev/skills-knowledge-hygiene) |

## Prerequisites

Bring an exact permitted, forbidden, or required relationship. Prefer an existing durable authority such as an accepted ADR, architecture document, design record, or accepted decision issue. If none exists, unambiguously declare the exact rule settled and authorize the skill to record it through the repository's normal decision convention before enforcement is added. An ambiguous or provisional rule still stops the workflow.

## The strongest feasible rung

A guardrail should make the invalid relationship as hard to represent as the target ecosystem allows. Structural module, visibility, package, type, or build boundaries are strongest. Established compiler, architecture-test, dependency-lint, or CI rules come next. Canonical interfaces and boundary validation follow when static enforcement is not feasible. Prose is the last resort.

The tool follows the repository rather than the skill. Existing enforcement is preferred when it can express the invariant cleanly. Otherwise the skill selects a mature tool native to the target ecosystem instead of writing a custom dependency analyzer or installing a standard bundle everywhere.

## Boundary and proof

Policy belongs at the architectural boundary it governs, with narrow exceptions visible beside the rule. The enforcement point references the accepted decision instead of duplicating its rationale.

The useful proof is behavioral: the intended architecture passes, a representative violation fails the real check where practical, the violation is removed, and the same check passes again. Reading a plausible configuration is not enough.

## Common questions

**How do you enforce deep-module principles in TypeScript?**

This was the direct question behind [the deep-modules discussion](https://github.com/mattpocock/skills/issues/458). The skill starts one level lower than a TypeScript recipe: state the exact seam and import relationship that has already been accepted, then it chooses the strongest mechanism the repository can support. In one repository that may be visibility or package structure; in another an established dependency linter such as [dependency-cruiser](https://github.com/sverweij/dependency-cruiser) may be the practical answer.

**Should it install a standard enforcement stack?**

No. [A proposal for a TypeScript enforcement layer](https://github.com/mattpocock/skills/issues/877) raised the choice between a full bundle and a curated subset. This skill resolves that pressure by selecting only the established mechanism needed for the accepted invariant. Audit-only and exploratory tools remain ephemeral; an intentional enforcement tool may become a durable project dependency because running it is the point.

**Can Graphify be the enforcement oracle?**

No. Graphify can answer what currently depends on what and help locate the boundary. The compiler, build, architecture test, dependency rule, or other target-native mechanism decides what is allowed to depend on what.

**What if the rule is settled in conversation but not recorded?**

Unambiguously declare the exact rule settled and authorize the skill to record it. It then creates or updates the repository's normal decision artifact, or an accepted issue or task, before wiring enforcement. A chat assertion alone is too easy to lose or reinterpret, and an executable restriction without a reviewable decision behind it becomes a second unexplained authority.

## It's working if

- The exact permitted, forbidden, or required relationship is readable from one enforcement point.
- Local verification and CI both run the guardrail through their existing paths.
- An intended relationship passes and a representative violation produces the expected failure where practical.
- Every exception is narrow, visible, and tied to the same durable authority, whether that authority was reused or created with your authorization.
- Superseded instruction prose disappears while the decision rationale remains available.
- No custom dependency analyzer or permanent audit-only dependency was added where an established enforcement tool sufficed.

## Where it fits

`architecture-guardrails` is an explicit downstream enforcement step after investigation, architecture design, and a recorded decision. [improve-codebase-architecture](https://aihero.dev/skills-improve-codebase-architecture) helps choose a better module shape; [knowledge-hygiene](https://aihero.dev/skills-knowledge-hygiene) can establish which durable rule is authoritative. This skill begins only after that work is settled.

[ask-matt](https://aihero.dev/skills-ask-matt) routes across the whole set when you are unsure which skill the situation wants.
