## What it does

`preserve-futures` examines a bounded completed region for concrete optionality loss and captures evidence that known future work should inherit.

It does not invent flexibility for hypothetical needs. A finding needs a concrete future option and evidence that the present work closed it without a forcing requirement.

## When to reach for it

Type `/preserve-futures`, or the agent reaches for it automatically when a task fits.

Reach for it at a strategic checkpoint before downstream work fans out, or for an explicit futures assessment of a named change or bounded area. For present-day quality of a diff, use [code-review](https://aihero.dev/skills-code-review) instead.

## Optionality is the signal

The skill separates necessary constraints from unnecessary ones. A present requirement can justify closing an option; without one, a concrete registered future may deserve protection before later work makes the decision expensive to reverse.

Its output is a planning signal: release downstream work, or hold for planning. The skill records the evidence and routes a handoff, leaving roadmap changes and code repair to their owners.

## Common questions

**Does this ask us to build for every imagined future?**

No. A merely conceivable future is speculative flexibility, not a remediation finding.

## It's working if

- Every optionality finding names closure, option, forcing-requirement, and amplification evidence.
- Necessary constraints are accepted without creating speculative abstractions.
- Downstream work receives a clear release or planning-hold signal.

## Where it fits

Preserve Futures is periodic architecture maintenance after meaningful checkpoints. It feeds [wayfinder](https://aihero.dev/skills-wayfinder) with planning consequences and uses [codebase-design](https://aihero.dev/skills-codebase-design) when a concrete seam needs deeper design work. See [ask-matt](https://aihero.dev/skills-ask-matt) for the full skill map.
