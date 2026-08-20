---
name: test-suite-health
description: Audit confidence in an existing test suite. Use when asked whether tests are trustworthy, coverage is high but bugs escape, flakes/order dependence/slow tests are suspected, configuration modes or failure/retry/interruption behavior need assessment, or before a risky refactor. Routine feature TDD belongs to tdd.
---

# Test Suite Health

Audit the suite, not the implementation task. The question is: **how much confidence should this suite earn?**

Coverage and a green run are inputs, never verdicts. Prefer measured experiments over inspection, and keep measured behavior separate from interpretation. Do not collapse the result into one score.

## Evidence workspace

Create a fresh directory in the OS temp directory for commands, machine-readable reports, seeds, and the final report. Keep every artifact outside the target repository. Record the repository HEAD, dirty state, command, tool version, seed, repeat count, and target scope beside each observation.

Redact secrets from commands and artifacts. Use synthetic or disposable state for failure experiments. Preserve evidence through cleanup.

## 1. Cheap survey

Run the shared TypeScript survey before test execution or new tool installation:

```text
<skills-root>/scripts/repository-analysis/test-suite-health-survey.ts
  --repo <target-repository>
  --depth quick
  --output <temp-directory>/survey.json
```

Resolve `<skills-root>` by walking up from this skill's installed path. Use the skills repository's package manager and existing dependencies to execute the script. The survey uses the shared bounded process runner and tool catalog. If the script or its runtime is unavailable, record a `harness-gap`; never replace missing evidence with intuition.

Read the normalized JSON. It inventories test/source/configuration files, test tooling and capabilities, skips/focus/quarantine markers, assertionless candidates, environment axes, failure-path signals, and source-to-test co-evolution candidates. Treat static matches as investigation leads, not confirmed defects.

Create a JSON experiment plan in the evidence workspace, then run every dynamic command through the shared TypeScript experiment runner:

```text
<skills-root>/scripts/repository-analysis/test-suite-health-run.ts
  --plan <temp-directory>/plan.json
  --output <temp-directory>/experiments.json
```

Each plan experiment names an ID, diagnostic, executable, argument array, parser, repeat count, timeout, and optional seed, target, environment, working directory, or report path. Pass arguments as an array, never through a shell. Keep report paths outside the repository. The runner bounds execution, preserves raw stdout/stderr per run, and normalizes TAP, JUnit XML, Jest/Vitest JSON, Stryker mutation JSON, and exit-code-only tools into one report with failure rates, durations, test counts, and mutation counts. A normalization failure is a named partial result, not permission to reason from the tool's presentation.

Start the plan with the repository's existing test command once, using its native machine-readable timing/reporting option where available. Do not add dependencies just to complete this pass. Capture:

- pass, fail, skip, quarantine, and retry counts;
- per-test or per-file duration and runtime concentration;
- existing random seed and ordering settings;
- fixture scope and setup cost reported by the runner;
- machine output, exit code, and wall-clock duration.

The cheap survey is complete when every available cheap diagnostic has an artifact, and every unavailable one has a named capability gap.

## 2. Model the investigation

Rank leads by risk and uncertainty. A high-risk lead protects critical behavior, changes often, dominates runtime, flakes, has weak assertions, or covers a failure boundary.

For configuration analysis, derive axes only from repository evidence: feature flags, mode enums, environment variables, CLI flags, providers, backends, and interacting booleans. Record the source for each axis and each validity constraint. If validity cannot be established from code, tests, docs, or configuration, ask for domain input. Once constraints are known, use an established pairwise or higher-order generator appropriate to the ecosystem. Do not manually enumerate a Cartesian product.

For detailed state/order reasoning before changing tests, call the Skill tool with "tdd". It remains authoritative for seams, hidden inputs, behavior-level assertions, and implementation-coupled tests.

## 3. Focused experiments

Choose the smallest experiment that can confirm or reject each lead. Add it to the experiment plan and rerun the shared runner. Do not execute dynamic diagnostics ad hoc.

### Flakiness, order, state, and runtime

- Repeat the suspicious test or smallest relevant shard. Report failures divided by runs, with the exact repeat count.
- Use the runner's seeded shuffle or an established order-randomization tool. Preserve every failing seed and rerun it to confirm reproducibility.
- Compare isolated and suite runs to expose order prerequisites.
- Vary one evidenced hidden input at a time: working directory, timezone, locale, clock, randomness seed, environment, concurrency, filesystem state, or cache state.
- Use runner timing data to report concentration, such as the slowest tests' share of total runtime. Do not infer slowness from file size.
- Inspect broad fixtures and assertionless candidates only after measurement points at them. Confirm whether they exercise observable behavior.

### Failure containment and runtime resilience

Exercise only safe seams already supplied by the project, framework, test doubles, disposable services, or dry-run modes. Never fault-inject against real persistent data or external production services.

For runtime-facing checks, use this loop:

1. **Launch:** start the real surface in isolated state, or start a fresh process per drive for short-lived CLIs.
2. **Doctor:** prove the instance is ready and is the instance you launched.
3. **Drive:** inject one dependency failure, timeout, interruption, retry, cleanup failure, or partial-progress event through an existing seam.
4. **Evidence:** capture the caller-visible result and durable side effects. Check failure propagation, state validity, retry idempotence, cache/durable agreement, and background-task visibility.
5. **Cleanup:** remove only state and processes created by this drive. Keep evidence. On a shared instance, clean residue rather than killing the instance.

Doctor again after surprising behavior. If a drive fails, clean its residue before retrying. Verify cleanup did not delete evidence.

Classify each surprising result:

- `product-defect`: behavior is broken through the real path;
- `harness-gap`: the behavior works, but the test or verification harness cannot exercise or observe it;
- `verification-drift`: test configuration or verification instructions describe a stale path.

Changing a harness to match broken product behavior is not a fix.

## 4. Optional targeted mutation

Mutation is an expensive branch. Enter it only when the user requests it, the target is critical or changing heavily, bugs escape despite high coverage, or cheaper evidence suggests assertions do not protect behavior.

Use an established mutation tool detected for the target ecosystem. Never write or simulate a mutation engine. Target the smallest high-risk module, file, class, or function the tool supports, and use incremental or changed-code modes when available. Run it through the experiment plan with a supported mutation parser or an explicit exit-code-only capability gap. Capture the tool version, target, baseline tests, generated/killed/survived/timeout counts, runtime, and surviving mutant locations.

Survivors are evidence to investigate. Equivalent mutations, unreachable code, and implementation-detail mutations do not automatically demand tests. Expand the target only when the first slice produces actionable evidence and the user accepts the cost.

## 5. Report

Normalize every result into this shape before reasoning from it:

```text
Diagnostic:
Measured behavior:
Provenance: command/tool/version/seed/repeats/artifact
Interpretation:
Scope and severity:
Classification: product-defect | harness-gap | verification-drift | suite-risk
Next targeted diagnostic or improvement:
```

Group findings by diagnostic: mutation, pathology, configuration state, state/order, failure containment, and evolutionary mismatch. Include clean evidence and capability gaps so absence of a finding is not mistaken for a completed check.

Finish with:

- confidence boundaries: what this suite protects well and what remains uncertain;
- the smallest ordered improvements that would buy the most confidence;
- expensive diagnostics deliberately not run;
- cleanup confirmation and surviving evidence paths.

Architectural redesign of failure boundaries belongs in architecture work. Report the behavioral evidence, then hand a redesign candidate to `codebase-design` or `improve-codebase-architecture` rather than solving it inside this audit.
