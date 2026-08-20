## What it does

`knowledge-hygiene` audits whether a repository has one coherent account of reality or several competing ones. It finds stale repository knowledge, contradictory [agent](https://www.aihero.dev/ai-coding-dictionary/agent) instructions, orphan documents, temporary work state left in durable files, and facts independently maintained in both code and docs.

It audits **authority**, not matching text. Similar prose may be a harmless explanation, while two completely different files may both claim to define the same policy or mapping. The skill reports evidence and recommended consolidation, but it does not rewrite or delete suspected duplicates.

## When to reach for it

Type `/knowledge-hygiene`, or the agent reaches for it automatically when a task is about stale docs, competing sources of truth, conflicting agent instructions, repository-memory cleanup, or making a repository safer for agents.

| Your situation | Reach for |
| --- | --- |
| Important facts or rules may have more than one owner | `knowledge-hygiene` |
| Current code and durable docs appear to disagree | `knowledge-hygiene` |
| Agent instructions contain old project state or conflicting rules | `knowledge-hygiene` |
| You only want repeated prose or copied code detected | A clone or duplication detector |
| You want to decide new domain language or record a new decision | [domain-modeling](https://aihero.dev/skills-domain-modeling) |
| You want to improve module boundaries and code structure | [improve-codebase-architecture](https://aihero.dev/skills-improve-codebase-architecture) |

Several Markdown files are not, by themselves, a reason to run it. Reach for it when repository knowledge may be incoherent or stale.

## Authority, not resemblance

The audit first learns the repository's own authority model. A code schema might be canonical, an API table might be generated from it, a guide might explain it, and an ADR might preserve its history. Those four artifacts can agree without being four sources of truth because their roles and dependency direction are explicit.

The failure is **duplicate authority**: two independently maintained places that are **empowered by the repository's authority model** to define the same current truth. "Looks current or binding" is not sufficient. Current-sounding legacy or unadmitted prose that lacks such empowerment is **authority-shaped debt** — classify it as such rather than as duplicate authority.

**Supersession is decided by proposition, not ancestry.** A current contract is not stale merely because a rule originated under a superseded ADR. Compare the actual proposition against the successor or current authority.

**Findings are capped at the minimum claim the evidence establishes.** The skill distinguishes at least three grades: metadata or status is misleading; two artifacts overlap; two artifacts assert incompatible current authority. A discoverable supersession relation prevents the last grade even when stale status metadata still requires repair.

The skill uses exact and semantic searches, Git history, issue state, orphan detection, and an existing Graphify graph to generate candidates. Each candidate still needs direct evidence before it becomes a finding.

## What the report shows

Every candidate names each location involved, including candidates dismissed as intentional or harmless, and separates:

- direct evidence of authority, currency, or supersession;
- inference where the record is silent;
- contradictions and missing evidence;
- confirmed duplicate authority from suspected duplication;
- the likely canonical source, when the repository makes one clear;
- the smallest consolidation, reference, generation, validation, or deprecation move.

Repeated failures are candidates for structural enforcement, such as generated output, a schema, a lint check, or a canonical helper. Another prose rule is the weakest fallback.

## Common questions

**Will it rewrite my `AGENTS.md`, `CLAUDE.md`, or docs automatically?**

No. This is a review-only skill. A stale instruction can strongly affect an agent, but similarity or apparent age is not enough evidence to edit it safely. The report gives the exact instruction, the conflicting evidence, confidence, and the smallest suggested remediation for human review.

**Does every duplicated fact count as a problem?**

No. Generated output, intentional projections, examples, explanations, and historical records are legitimate when their role and canonical source are clear. The problem is independent authority that must be synchronized by hand or leaves precedence ambiguous.

**Does the repository need a particular docs layout?**

No. The audit discovers declared roles and conventions from the repository itself. Missing precedence or unclear document status becomes a finding or evidence gap rather than a reason to impose new filenames.

## It's working if

- The report starts by stating which artifact classes own current truth and which are derived, generated, explanatory, historical, temporary, or unclear.
- Every finding cites why each location appears authoritative, not merely that two passages look alike.
- Direct evidence and inference appear separately, with silent history reported as a gap.
- Harmless generated or explanatory duplication is classified and dismissed rather than reported as competing authority.
- Authority-shaped debt is distinguished from confirmed duplicate authority.
- Supersession is evaluated by proposition, not by ADR ancestry.
- No finding is strengthened beyond the minimum claim its evidence establishes; misleading status metadata is not reported as incompatible current authority when supersession is discoverable.
- Remediation preserves artifact class semantics: an artifact is not moved into a category whose admission contract its content does not satisfy.
- Remediation does not introduce synchronization debt (no per-entry or line-number backlinks unless granular provenance solves a demonstrated ambiguity with generation or validation).
- No file is rewritten or deleted until remediation is separately approved.

## Where it fits

`knowledge-hygiene` is periodic repository maintenance and a reach-for-it-anytime audit when repository memory becomes suspect. [domain-modeling](https://aihero.dev/skills-domain-modeling) owns the vocabulary and decisions that should become durable authority; [improve-codebase-architecture](https://aihero.dev/skills-improve-codebase-architecture) examines code structure rather than knowledge coherence.

[ask-matt](https://aihero.dev/skills-ask-matt) routes across the whole set when you are unsure which skill the situation wants.
