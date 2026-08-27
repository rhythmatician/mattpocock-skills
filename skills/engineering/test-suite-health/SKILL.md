---
name: test-suite-health
description: Audit confidence in an existing test suite. Use when asked whether tests are trustworthy, coverage is high but bugs escape, flakes/order dependence/slow tests are suspected, configuration modes or failure/retry/interruption behavior need assessment, or before a risky refactor. Routine feature TDD belongs to tdd.
---

# Test Suite Health

Audit the suite, not the implementation task. The question is: **how much confidence should this suite earn?**

Coverage and a green run are inputs, never verdicts. Prefer measured experiments over inspection, and keep measured behavior separate from interpretation. Do not collapse the result into one score.

## Evidence workspace

Create a fresh directory in the OS temp directory for commands, machine-readable reports, seeds, and the final report. Keep every artifact outside the target repository. Record the repository HEAD, dirty state, stable state ID, command, tool version, mechanical seed source, repeat count, and target scope beside each observation.

Redact secrets from commands and artifacts. Use synthetic or disposable state for failure experiments. Preserve evidence through cleanup.

## 1. Cheap survey

Run the shared TypeScript survey before test execution or new tool installation:

```text
<skills-root>/scripts/repository-analysis/test-suite-health-survey.ts
  --repo <target-repository>
  --depth quick
  --output <temp-directory>/survey.json
```

Resolve `<skills-root>` by first resolving this skill's real path (follow any junction or symlink to its target), then walking up from that real path to the `package.json` containing `test-suite-health:survey`. Use the skills repository's package manager and existing dependencies to execute the script. If the script or its runtime is unavailable, record a `harness-gap`; never replace missing evidence with intuition.

Read the normalized JSON. It inventories test/source/configuration files, test tooling and capabilities, skips/focus/quarantine markers, assertionless candidates, environment axes, failure-path signals, and source-to-test co-evolution candidates. Treat static matches as investigation leads, not confirmed defects.

Create a JSON experiment plan in the evidence workspace, then run every dynamic command through the shared TypeScript experiment runner:

```text
<skills-root>/scripts/repository-analysis/test-suite-health-run.ts
  --plan <temp-directory>/plan.json
  --output <temp-directory>/experiments.json
```

Use plan `schemaVersion: 2`. Version 1 is rejected because its standalone seed string cannot prove that the seed reached the tool. Migrate by replacing the string with the version 2 mechanical seed pointer described below.

Each plan experiment names an ID, diagnostic, executable, argument array, parser, repeat count, timeout, and optional target, environment, working directory, report path, capability gaps, or safe version argument array. Pass arguments as an array, never through a shell. Before each repeat, the runner fingerprints the configured report path and preserves a deterministic per-run copy only when execution creates or changes that report, including on timeout or failure. A missing or unchanged report is an explicit stale-evidence gap and is never attributed to the later run. The runner also preserves raw stdout/stderr, records repository state before and after, and normalizes supported machine-readable formats into one report; a normalization failure is a named partial result, not permission to reason from the tool's presentation.

The runner has no universal seed flag. Put the seed into the tool's real argument array or environment map, then configure `seed` as either `{ "source": "argument", "argumentIndex": <index> }` or `{ "source": "environment", "environmentVariable": "<name>" }`. The runner derives the recorded value from that location and rejects a seed pointer that does not resolve. Configure `versionArgs` only when that executable has a safe version command; otherwise retain the named tool-version capability gap.

Start the plan with the repository's existing test command once, using its native machine-readable timing/reporting option where available. Do not add dependencies just to complete this pass. Capture:

- pass, fail, and skip counts, plus quarantine and retry counts;
- per-test or per-file duration and runtime concentration;
- existing random seed and ordering settings;
- fixture scope and setup cost;
- machine output, exit code, and wall-clock duration.

Capture each count only when the native machine reporter exposes it; never infer missing fields from console prose. The cheap survey is complete when every available cheap diagnostic has an artifact, and every unavailable metric or diagnostic has a named capability gap. Preserve the native machine report when it contains evidence the shared parser does not normalize.

## 2. Model the investigation

Rank leads by risk and uncertainty. A high-risk lead protects critical behavior, changes often, dominates runtime, flakes, has weak assertions, or covers a failure boundary.

For configuration analysis, derive axes only from repository evidence: feature flags, mode enums, environment variables, CLI flags, providers, backends, and interacting booleans. Record the source for each axis and each validity constraint. If validity cannot be established from code, tests, docs, or configuration, ask for domain input. Once constraints are known, use an established pairwise or higher-order generator appropriate to the ecosystem.

For detailed state/order reasoning before changing tests, call the Skill tool with "tdd". It remains authoritative for seams, hidden inputs, behavior-level assertions, and implementation-coupled tests.

## 3. Focused experiments

Choose the smallest experiment that can confirm or reject each lead. Add it to the experiment plan and rerun the shared runner.

### Flakiness, order, state, and runtime

- Repeat the suspicious test or smallest relevant shard. Report failures divided by runs, with the exact repeat count.
- Configure the repository tool's seeded shuffle or an established order-randomization tool through its real argument or environment mechanism. Point the plan's seed provenance at that configured value, preserve every failing seed, and rerun it to confirm reproducibility.
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

Use an established mutation tool detected for the target ecosystem; never write or simulate a mutation engine. Target the smallest high-risk module or function the tool supports, preferring incremental or changed-code modes. Capture generated/killed/survived/timeout counts and surviving mutant locations only via a supported machine-readable parser; otherwise keep the native report and exit code as a named normalization gap.

Survivors are leads, not verdicts: equivalent mutations, unreachable code, and implementation-detail mutants do not demand tests. Expand the target only if the first slice yields actionable evidence and the user accepts the cost.

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

Attribute residue only to paths new, removed, or changed relative to each experiment's starting state, keeping pre-existing dirty state distinct. The bounded residue view fingerprints ignored trees up to 2,000 entries and 16 MiB; dependency-scale trees (`node_modules`, `vendor`, `.venv`, `target`) are named capability gaps. Crossing a bound makes the evidence partial. Report unexpected residue as unknown user state; remove checkout state only when the harness created it and can identify it safely.

Architectural redesign of failure boundaries belongs in architecture work. Report the behavioral evidence and hand a redesign candidate to `codebase-design` or `improve-codebase-architecture`.
