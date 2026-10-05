## What it does

`test-suite-health` audits whether an existing suite deserves confidence. It measures mutation resistance, flakiness, order and hidden-state dependence, runtime concentration, configuration interactions, failure containment, and whether production code and its tests still evolve together.

A green run and high line coverage are evidence, not the verdict. The skill separates measured behavior from interpretation and refuses to hide uncertainty behind one global score.

## When to reach for it

Type `/test-suite-health`, or the [agent](https://www.aihero.dev/ai-coding-dictionary/agent) reaches for it automatically when a task fits.

| Your situation | Where to go |
| --- | --- |
| Tests pass, but defects still escape | `test-suite-health` |
| Tests fail randomly, depend on order, or dominate CI time | `test-suite-health` |
| A risky refactor needs evidence that the current safety net is real | `test-suite-health` |
| You are building one new behavior test-first | [tdd](https://aihero.dev/skills-tdd) |
| One reported bug needs diagnosis and a regression test | [diagnosing-bugs](https://aihero.dev/skills-diagnosing-bugs) |

## Prerequisites

The repository needs an existing test suite and a runnable test command for dynamic evidence. The cheap survey can still inventory a broken or partially configured suite, but unavailable runners and tools remain explicit capability gaps.

Mutation, seeded ordering, pairwise generation, and fault injection use established tools already available in the target ecosystem. The audit does not invent replacements for them.

## Confidence, not coverage

The leading idea is **earned confidence**. A suite earns it when plausible defects make it fail, repeated and shuffled runs stay deterministic, important configuration interactions are exercised, failures remain contained, and the tests observe behavior rather than implementation details.

The audit moves from cheap to expensive:

1. Inventory tools, skips, timing, configuration axes, failure-path signals, and source-to-test history.
2. Run focused repeats, seeded order checks, state variations, and safe failure experiments.
3. Use targeted mutation only when risk or cheap evidence justifies its cost.

Dynamic evidence stays replayable. A seed names the value that really reached the tool, each repeat keeps only a machine report it actually changed, and every observation names the exact repository state it measured. Failed runs can still retain fresh reports, while unchanged output is called stale instead of being reassigned to a later repeat. That provenance prevents a result from looking reproducible when the command, checkout, or overwritten report says otherwise.

Reporter detail is capability-dependent. Retry, quarantine, fixture, detailed timing, and structured mutation counts appear only when trustworthy machine evidence exposes them. Missing detail remains an explicit confidence boundary, while the native evidence survives for later inspection or a justified adapter.

For a runtime-facing check, it uses [harness](https://www.aihero.dev/ai-coding-dictionary/harness) discipline to prove the real caller-visible outcome. Pre-existing dirty and ignored content stays separate from experiment residue, including leaf changes inside ordinary ignored caches. Very large ignored trees become an explicit confidence boundary. The audit never buys a clean-looking result by deleting state it cannot safely attribute.

## Common questions

**Isn't coverage enough to tell whether the suite is good?**

No. Coverage shows that execution reached code. Mutation testing asks whether plausible defects are detected, while repeats, ordering experiments, and failure injection ask whether the suite protects behavior under conditions a normal green run never creates.

**Will it mutation-test the whole repository?**

No. Mutation is optional and targeted. The skill enters that phase when you request it, a critical hotspot is changing, defects escape despite high coverage, or cheap diagnostics suggest weak behavioral protection. Surviving mutants are leads, not an automatic demand for one test per mutant.

**What if my mutation tool is not Stryker?**

The audit still preserves the native machine report and exit code when available. Structured mutant counts require a supported parser, so another tool produces an explicit normalization gap until a real consumer justifies an adapter.

**Why do old experiment plans need migration?**

The earlier plan format could label a run with a seed without proving the tool received it. Version 2 makes reproducibility evidence mechanical, so version 1 plans fail with a migration message instead of retaining decorative provenance.

**Can it decide which feature-flag combinations are valid?**

Only from repository or domain evidence. It discovers candidate axes, but it will not invent constraints. Once valid states are known, an established pairwise or higher-order generator can produce a compact interaction set without an exhaustive Cartesian product.

**Does it fix the tests it finds?**

The audit's primary artifact is evidence and ordered improvements. Small harness corrections can be proved and made in place, but writing behavior-level tests follows [tdd](https://aihero.dev/skills-tdd), and redesigning failure boundaries belongs to [codebase-design](https://aihero.dev/skills-codebase-design).

## It's working if

- Every finding states a measured rate, duration, seed, count, survivor, uncovered interaction, or observed failure path before interpreting it.
- A flaky result includes the repeat count and a reproducible seed or explicit reproduction rate.
- Every recorded seed points to the argument or environment value that reached the tool.
- Mutation work names a narrow target and its cost instead of silently scanning the repository.
- Repeated native reports survive at distinct artifact paths, and repository residue is separated from pre-existing dirty state.
- Configuration gaps cite discovered axes and evidenced constraints.
- Failure experiments verify caller-visible behavior and durable side effects, then leave no test residue behind.
- The report names diagnostics that were not run and why.

## Where it fits

`test-suite-health` is a reach-for-it-anytime audit for the safety net around existing code. [tdd](https://aihero.dev/skills-tdd) owns writing strong tests while implementing behavior, [diagnosing-bugs](https://aihero.dev/skills-diagnosing-bugs) owns one concrete failure, and [codebase-design](https://aihero.dev/skills-codebase-design) owns architectural redesign when the audit proves a missing seam. For the complete map, [ask-matt](https://aihero.dev/skills-ask-matt) routes across the skill set.
