---
name: skill-ecosystem-auditor
description: Audit ecosystems of independently invocable Agent Skills for runtime portability, catalog pressure, trigger collisions, ownership boundaries, user-only invocation safety, and unsafe composition. Use before ecosystem release, when diagnosing missing or unwanted activation across skills, comparing host behavior, designing skill CI, or certifying with an evaluation corpus.
---

# Skill Ecosystem Auditor

Audit the ecosystem as an interacting runtime system, not as individually valid files. Keep portable specification, documented host behavior, runtime observations, field reports, repository evidence, and heuristics visibly separate.

## Establish scope and authority

Record:

- skill roots and repository instructions in scope;
- requested hosts, model tiers, and supported versions;
- whether the user wants static validation, runtime diagnosis, quantitative certification, CI design, or remediation;
- available prompt corpora, runtime traces, workload frequencies, and prior audit artifacts;
- mutation authority. Keep the audit read-only unless the user explicitly requests changes.

Retain ownership of the coordinated ecosystem outcome. Delegate isolated evidence collection where useful, then synthesize system-level selection, host-view, ownership, and composition findings here.

The source migration remains open until [the post-merge checklist](references/migration.md) is complete. Do not treat the old repository as deprecated before the canonical PR merges.

This step is complete when the target, host matrix, available evidence, and permitted outputs are explicit.

## 1. Run the cheap integrity check

Resolve this skill's repository root. First resolve the real path of `SKILL.md` (follow any junction or symlink to its target), then walk upward from that real path to the `package.json` containing `skill-ecosystem:check`. If the walk fails, report the integrity check as unavailable and stop. Create a fresh output path outside the target repository, then run:

```text
npm run skill-ecosystem:check -- --repo <absolute-target> --output <absolute-temp-json>
```

The check owns deterministic integrity only: parseable frontmatter, unique names in discovery scope, local package references, synchronized user-only metadata, explicit child names, composition-manifest endpoints, unbounded statically declared invocation cycles, and JSON schema readability. Exit `1` means the report contains findings. It does not establish trigger quality, runtime selection, host behavior, or safe semantic ownership.

For targeted evidence, the same runner exposes `skill-ecosystem:inventory`, `skill-ecosystem:references`, and `skill-ecosystem:tokens`. The TypeScript implementation lives in the shared repository-analysis substrate so parsing, hashing, path discovery, JSON output, and heuristic token estimation have one implementation.

This step is complete when every deterministic finding is recorded or the unavailable runner is named as an evidence gap.

## 2. Inventory without collapsing host views

Keep every discovered skill's declared name, directory, repository-relative path, content hash, raw and extracted frontmatter, parse warnings, description, body size, direct references, scripts, assets, sidecars, and governing repository constraints. Keep duplicate names separate until a documented host precedence rule applies.

Broken package-local links are stale-reference evidence. A name mentioned only in prose is not an invocation edge. Treat an operative Skill-tool instruction or a declared composition edge as stronger evidence than descriptive similarity.

This step is complete when every discovered skill and instruction source has a stable identity and duplicate identities remain distinguishable by root and scope.

## 3. Build portable and host views

Validate portable frontmatter and package structure against the current Agent Skills specification. Record the audit date and validator version.

When the audit names a host or depends on discovery, catalogs, invocation, persistence, compaction, or sidecars, read [the host profiles](references/host-profiles.md). Verify time-sensitive facts against the linked primary source before reporting them as current.

For every requested host, determine:

- discovery roots and same-name precedence;
- model-visible catalog fields, documented budget, shortening, and omission behavior;
- explicit and implicit invocation controls;
- activated-content persistence, reinjection, and compaction behavior;
- supported sidecars, dynamic context, and tool declarations.

Use `unknown` for undocumented behavior. This step is complete when each runtime fact has a host, version or check date, and evidence class.

## 4. Analyze selection, ownership, and composition

Statically inspect description containment, ambiguous scopes, missing exclusions, competing writers, unbound capabilities, conditional universal invariants, repository leakage, and host-specific assumptions in portable files.

Represent important phase transitions with:

```text
owner, entry condition, permitted mutation, required input,
persisted output, verification, exit condition, retry bound
```

Use only evidence-supported composition edges: `invokes`, `may-invoke`, `requires`, `reads`, `writes`, `produces`, `consumes`, `validates`, `overrides`, and `conflicts-with`. Read [cooperating ecosystems](references/cooperating-ecosystems.md) when the graph includes a router, independently invocable children, user-only skills, shared principles, generated or project-local skills, or independent multi-agent synthesis.

Intentional handoffs reduce ambiguity only when the entry condition, output, and phase owner are explicit. They do not erase a real ownership conflict. Block unbounded invocation cycles, competing owners for one transition, incompatible writers, review phases that mutate without repair authority, non-idempotent destructive reruns, and required contracts held only in disposable conversation state.

This step is complete when every collision or composition finding names the skills, shared action or artifact, phase, and authority conflict. Intentional routing and shared dependencies are recorded as composition, not mislabeled as trigger collisions.

## 5. Evaluate activation empirically

Do not infer precision, recall, activation order, co-activation, lifecycle effects, or quality uplift from descriptions alone.

For runtime diagnosis or certification, run a corpus containing positive, negative, near-neighbor, paraphrased, underspecified, irrelevant-keyword, composition, and lifecycle prompts. Store reusable cases in [the evaluation corpus schema](assets/eval-corpus.schema.json) and recorded selections in [the observations schema](assets/eval-observations.schema.json). Compare the full ecosystem with single-skill isolation and a no-skill baseline. Record selected skills, order, omissions, truncation, outputs, and model and host versions.

Use [the committed corpus](assets/eval-corpus.json) and [fixture observations](assets/eval-observations.fixture.json) to exercise the adapter before connecting a host. From the skills repository root, run:

```text
npm run skill-ecosystem:evaluate -- --corpus skills/engineering/skill-ecosystem-auditor/assets/eval-corpus.json --observations skills/engineering/skill-ecosystem-auditor/assets/eval-observations.fixture.json --output <absolute-temp-json>
```

Committed observations are `FIXTURE` evidence: they prove the three-baseline adapter, activation order, and co-activation reporting, not runtime behavior. Certification requires `RUNTIME-OBSERVED` selections from a real host and model.

For quantitative certification or CI thresholds, read [the rubric](references/rubric.md); treat every threshold as operational policy until calibrated against the target workload. Use `npm run skill-ecosystem:tokens -- --target <skill-or-root>` only when the target tokenizer is unavailable.

This step is complete when every empirical metric traces to a saved corpus and observed run; unavailable dimensions remain `not measured`.

## 6. Report and remediate

Lead with the operational outcome. Report:

- scope, audit date, host matrix, and evidence limitations;
- inventory and visibility risks;
- findings ordered by blocker, error, warning, then information;
- measured trigger confusion, ownership boundaries, and composition chains;
- minimal remediation and affected owner for each blocker or error;
- machine-readable results conforming to [the audit result schema](assets/audit-result.schema.json) when file output or CI integration is requested, with [the fixture](assets/audit-result.fixture.json) as a known-valid example.

Classify evidence as `SPEC`, `HOST-DOCUMENTED`, `RUNTIME-OBSERVED`, `FIELD-REPORTED`, `REPO`, or `HEURISTIC`, each with a source range or URL, observed value, threshold when applicable, impact, and minimal remediation. Never let an aggregate score conceal a blocker.

The package sidecar is [agents/openai.yaml](agents/openai.yaml). The audit is complete when every claim is reproducible from cited evidence, every blocker is visible independent of scores, and every unverified claim is labeled.
