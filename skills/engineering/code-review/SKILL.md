---
name: code-review
description: "Review changes since a fixed point along three independent axes: Standards, Spec, and diff-scoped Health Regression. Use for a branch, PR, work in progress, or a review since a commit, branch, tag, or merge-base."
---

Three-axis review of the diff between `HEAD` and a fixed point the user supplies:

- **Standards**: does the code conform to this repo's documented coding standards?
- **Spec**: does the code faithfully implement the originating issue / spec?
- **Health Regression**: did the change make the repository materially harder to maintain, verify, or reason about?

Run all available axes as **parallel sub-agents** with separate contexts. Give them the same pinned diff and commit list, and do not share sibling conclusions before every axis returns.

The issue tracker should have been provided to you. If `docs/agents/issue-tracker.md` is missing, tell the user to run `/setup-matt-pocock-skills`.

## Process

### 1. Pin the fixed point

Whatever the user said is the fixed point (a commit SHA, branch name, tag, `main`, `HEAD~5`, etc.). If they didn't specify one, ask for it.

Capture the diff command once: `git diff <fixed-point>...HEAD` (three-dot, so the comparison is against the merge-base). Also note the list of commits via `git log <fixed-point>..HEAD --oneline`.

Before going further, confirm the fixed point resolves (`git rev-parse <fixed-point>`) and the diff is non-empty. A bad ref or empty diff should fail here, not inside the parallel axis reviews.

### 2. Identify the spec source

Look for the originating spec, in this order:

1. Issue references in the commit messages (`#123`, `Closes #45`, GitLab `!67`, etc.), fetched via the workflow in `docs/agents/issue-tracker.md`.
2. A path the user passed as an argument.
3. A spec file under `docs/`, `specs/`, or `.scratch/` matching the branch name or feature.
4. If nothing is found, ask the user where the spec is. If they say there isn't one, the **Spec** sub-agent will skip and report "no spec available".

### 3. Identify the standards sources

Anything in the repo that documents how code should be written, such as `CODING_STANDARDS.md` or `CONTRIBUTING.md`.

On top of whatever the repo documents, the Standards axis always carries the **smell baseline** below: a fixed set of Fowler code smells (_Refactoring_, ch.3) that applies even when a repo documents nothing. Two rules bind it:

- **The repo overrides.** A documented repo standard always wins; where it endorses something the baseline would flag, suppress the smell.
- **Always a judgement call.** Each smell is a labelled heuristic ("possible Feature Envy"), never a hard violation. Like any standard here, skip anything tooling already enforces.

Each smell reads *what it is* → *how to fix*; match it against the diff:

- **Mysterious Name**: a function, variable, or type whose name doesn't reveal what it does or holds. → rename it; if no honest name comes, the design's murky.
- **Duplicated Code**: the same logic shape appears in more than one hunk or file in the change. → extract the shared shape, call it from both.
- **Feature Envy**: a method that reaches into another object's data more than its own. → move the method onto the data it envies.
- **Data Clumps**: the same few fields or params keep travelling together (a type wanting to be born). → bundle them into one type, pass that.
- **Primitive Obsession**: a primitive or string standing in for a domain concept that deserves its own type. → give the concept its own small type.
- **Repeated Switches**: the same `switch`/`if`-cascade on the same type recurs across the change. → replace with polymorphism, or one map both sites share.
- **Shotgun Surgery**: one logical change forces scattered edits across many files in the diff. → gather what changes together into one module.
- **Divergent Change**: one file or module is edited for several unrelated reasons. → split so each module changes for one reason.
- **Speculative Generality**: abstraction, parameters, or hooks added for needs the spec doesn't have. → delete it; inline back until a real need shows.
- **Message Chains**: long `a.b().c().d()` navigation the caller shouldn't depend on. → hide the walk behind one method on the first object.
- **Middle Man**: a class or function that mostly just delegates onward. → cut it, call the real target direct.
- **Refused Bequest**: a subclass or implementer that ignores or overrides most of what it inherits. → drop the inheritance, use composition.

### 4. Prepare bounded health evidence

Health Regression is attributable to the diff, not a whole-repository health audit. Start with the changed files, repository instructions, nearby tests, direct dependencies and consumers, and existing artifacts. Detect the target ecosystem from its manifests, build and test configuration, and changed file types before selecting compatible capabilities.

Escalate to a repository survey only when direct inspection produces a material candidate and the survey is likely to confirm, clear, or materially change it. A survey is not a default prerequisite for ordinary review. Available evidence sources are:

- `maintenance-risk` quick evidence for changed hotspots, temporal coupling, change amplification, dependency pathology, and dead-architecture candidates;
- the `test-suite-health` quick survey for changed tests, configuration axes, skips, weak assertions, co-evolution gaps, and ecosystem-specific verification capabilities;
- apply `knowledge-hygiene` authority reasoning to new mappings, instructions, generated projections, stale leftovers, or independently maintained truths;
- use feedback-loop evidence already present in the repository for slower, broader, or less deterministic verification;
- reuse a valid `graphify-out/graph.json` rather than rebuilding it, and preserve every analyzer's provenance and partial failures.

When escalation is justified, resolve the shared TypeScript runners from the installed skills repository and create a fresh OS temporary directory. Run the relevant command from the skills repository root:

```text
npm run maintenance-risk:survey -- --repo <absolute-target> --depth quick --output <temp>/maintenance-risk.json
```

```text
npx tsx scripts/repository-analysis/test-suite-health-survey.ts --repo <absolute-target> --depth quick --output <temp>/test-suite-health.json
```

The shared runners detect available ecosystem tools and emit normalized evidence without adding dependencies to the target. Read their JSON even on a partial exit. Require repository HEAD, dirty state, and state identity in each artifact to match the reviewed worktree; otherwise mark the artifact stale or mismatched. Intersect findings with changed files first, then admit an unchanged file only when direct dependency, consumer, configuration, lifecycle, format, or temporal-coupling evidence connects it to the diff. Preserve analyzer command, version, source artifact, evidence strength, and every partial failure in the Health Regression context.

Use `quick` depth. Do not install audit tools into the target, run mutation testing or broad benchmarks, invoke a whole-repository health orchestrator, or invoke user-only `architecture-guardrails`. Missing capabilities narrow the review; they do not become inferred evidence.

For a small docs-only or similarly low-risk diff, direct inspection may exhaust the proportionate checks. State what was checked.

### 5. Spawn the sub-agents in parallel

**Standards sub-agent prompt** should include:

- The full diff command and commit list.
- The list of standards-source files you found in step 3, **plus the smell baseline from step 3** pasted in full (the sub-agent has no other access to it).
- The brief: "Report, per file/hunk where relevant, (a) every place the diff violates a documented standard: cite the standard (file + the rule); and (b) any baseline smell you spot: name it and quote the hunk. Distinguish hard violations from judgement calls: documented-standard breaches can be hard, but baseline smells are always judgement calls, and a documented repo standard overrides the baseline. Skip anything tooling enforces. Under 400 words."
- The guard: "Do not invoke `/code-review` or spawn additional agents. Perform this axis directly."

**Spec sub-agent prompt** should include:

- The diff command and commit list.
- The path or fetched contents of the spec.
- The brief: "Report: (a) requirements the spec asked for that are missing or partial; (b) behaviour in the diff that wasn't asked for (scope creep); (c) requirements that look implemented but where the implementation looks wrong. Quote the spec line for each finding. Under 400 words."
- The guard: "Do not invoke `/code-review` or spawn additional agents. Perform this axis directly."

If the spec is missing, skip the Spec sub-agent and note this in the final report.

**Health Regression sub-agent prompt** should include:

- The full diff command and commit list.
- The changed-file list, repository instructions, and paths to any normalized quick evidence or reusable Graphify artifact. Name unavailable capabilities and partial failures.
- This brief: "Find only material regressions attributable to this diff that make the repository harder to maintain, verify, or reason about. Check for new duplicate authority or stale leftovers, dependency cycles or cross-boundary edges, complexity added in risky hotspots, greater scattering or change amplification, new configuration axes, hidden state or ordering requirements, weakened tests, slower or broader verification, and dead architecture left by refactors. Do not repeat Fowler smells owned by Standards unless repository evidence materially changes the conclusion. Look beyond imports and grep at formats, schemas, configuration, lifecycle or timing, downstream consumers, external-library behavior, and other languages when the diff crosses those seams. For each finding separate Diff fact, Repository evidence, Interpretation, Confidence/limitations, and Action. For a consequential risk, name the key safety fact and the strongest cheap proof reached: assertion, source, failure-path, executed, or runtime. Include cleared candidates. Prefer a few high-confidence structural findings. Do not invoke `/code-review`, spawn agents, install tools, mutate the target, or run broad diagnostics. Under 500 words."

If the harness supports multiple reviewers within one axis, give them this same intent and rubric in isolated contexts. Preserve consensus, lone findings, and explicit disagreement. The lead decides which findings are actionable; never blindly union every comment. A single Health Regression sub-agent is sufficient when further fan-out is disproportionate or unsupported.

### 6. Aggregate

Present the reports under `## Standards`, `## Spec`, and `## Health Regression`. Keep the axes separate and do not rerank findings across them. Within Health Regression, the lead may lightly clean or omit unsupported comments after preserving any material disagreement.

When no health regression survives the bounded checks, say: "No diff-attributable maintainability, verification, or reasoning regressions found within the bounded checks performed." Then name any limitation that left a material safety assumption unproved.

End with a one-line summary: total findings per axis, and the worst issue _within each axis_ (if any). Do not calculate a health score or pick a single winner across axes.

## Why three axes

A change can pass one axis and fail the other:

- Code that follows every standard but implements the wrong thing → **Standards pass, Spec fail.**
- Code that does exactly what the issue asked but breaks the project's conventions → **Spec pass, Standards fail.**
- Code that passes both while adding a second authority, a hidden ordering dependency, or a much broader verification loop → **Standards and Spec pass, Health Regression fail.**

Reporting them separately stops one axis from masking the other.
