## What it does

`skill-ecosystem-auditor` audits a collection of independently invocable skills as one runtime system. It inventories host-visible metadata, checks invocation controls, maps ownership and composition, compares host behavior, and can measure activation against a prompt corpus.

Its fast integrity command catches mechanical drift, but certification still depends on semantic and runtime evidence. A green frontmatter check cannot prove that two skills select cleanly or hand work off safely.

## When to reach for it

Type `/skill-ecosystem-auditor`, or the [agent](https://www.aihero.dev/ai-coding-dictionary/agent) reaches for it automatically when a task fits.

| Situation | Reach for |
|---|---|
| Several skills activate for the same request | `skill-ecosystem-auditor` to separate intended cooperation from trigger collision |
| A router and its children may compete for ownership | `skill-ecosystem-auditor` to map entry, exit, and synthesis ownership |
| User-only skills may be visible to autonomous selection | `skill-ecosystem-auditor` to compare metadata and runtime behavior by host |
| You need a fast CI guard for skill-package drift | Its deterministic integrity command |
| One skill package needs rewriting or optimization | Work on that package directly; this skill retains ecosystem-level ownership |

## Two evidence layers

The cheap layer finds facts a deterministic check can establish: malformed frontmatter, duplicate names, broken package references, mismatched user-only metadata, unresolved declared children, invalid schemas, and obvious unbounded composition cycles.

The deep layer owns judgments that need context or observation:

- whether overlapping descriptions create harmful catalog pressure;
- whether co-activation is an intentional handoff or competing ownership;
- whether host discovery and persistence match documented behavior;
- whether reruns and multi-agent synthesis preserve one owner;
- whether empirical selection meets a calibrated evaluation policy.

The repository includes a host-neutral evaluation exercise with full-ecosystem, isolated-auditor, and no-skill observations. It measures selection, co-activation, and activation order against the committed corpus, including the external cooperating-skill fixture. Its observations are labeled `FIXTURE`; replace them with recorded host and model selections before making runtime claims.

The leading idea is **composition**. An `invokes`, `reads`, or `validates` edge explains why two skills appear together, but only an explicit phase owner proves that the relationship is safe.

## Host views stay separate

Portable Agent Skills semantics do not determine every host's discovery roots, catalog budget, precedence, implicit invocation, or compaction behavior. The audit records each time-sensitive host fact with a source and check date, and reports undocumented behavior as `unknown` until an observed run establishes it.

## Common questions

**Is this just a frontmatter linter?**

No. The integrity command is deliberately cheap and narrow. The audit keeps trigger containment, catalog pressure, composition, phase ownership, lifecycle safety, host views, and empirical activation as first-class work.

**Does an orchestrator sharing trigger words with its children count as a collision?**

Not by itself. The audit looks for an explicit routing relationship, bounded child output, and one owner of final synthesis. Without those contracts, similar activation can still be a real ownership conflict.

**Can it prove that a user-only skill is protected?**

It can deterministically verify that supported host metadata agrees. Certification also exercises runtime selection because a host adapter or discovery bug can violate metadata that looks correct on disk.

**Do I need a runtime corpus for every audit?**

No. Static inventory and integrity are useful for local and CI checks. Claims about precision, recall, co-activation, order, or quality uplift remain `not measured` until a representative corpus is run.

**Is the old repository already deprecated?**

No. Its discoverable copy remains valid until this port merges. The package carries a post-merge checklist naming the exact old path to delete and the catalogs and references to update. Leaving a tombstone `SKILL.md` would preserve the collision, so the cleanup removes the complete old skill directory.

## It's working if

- Intentional router-to-specialist handoffs appear as composition, not false collision errors.
- Every reported ownership conflict names the shared phase or durable artifact and both claimants.
- User-only status agrees across host metadata and, when certified, observed selection.
- Host facts carry sources and check dates; undocumented behavior remains `unknown`.
- A fast CI run catches a renamed reference or unresolved child without pretending to certify runtime behavior.

## Where it fits

`skill-ecosystem-auditor` is periodic maintenance and a reach-for-it-anytime diagnostic for the skill network itself. [writing-for-agents](https://aihero.dev/skills-writing-for-agents) owns how an individual skill or agent-facing document is written; this auditor owns the interactions among independently invocable packages. For the complete skill map, use [ask-matt](https://aihero.dev/skills-ask-matt).
