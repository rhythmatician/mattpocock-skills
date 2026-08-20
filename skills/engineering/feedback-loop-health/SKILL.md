---
name: feedback-loop-health
description: Diagnose time to trustworthy engineering feedback. Use for slow edit/test loops, delayed confidence, broad rebuild or restart friction, time to a visible testable change, CI-only confidence, agent idle time, or costly human scenario setup and verdicts.
---

# Feedback Loop Health

Measure the whole path from a change to a trustworthy verdict. A fast command is not a healthy loop when it provides weak confidence, and a fast build is not healthy when a reviewer still waits or performs substantial ceremony before the behavior is observable.

Keep these milestones separate throughout the investigation:

1. **First signal:** the earliest useful machine feedback after the edit.
2. **Automated confidence:** the machine checks needed for the change's risk.
3. **Human-observable state:** the changed behavior is ready to perceive or experience.
4. **HITL setup:** the human's manual work to reach the relevant state.
5. **HITL verdict:** the human accepts, rejects, or cannot decide from the evidence.

Human judgment stays human when the acceptance criterion is perceptual or experiential. Automation should establish everything cheap and mechanical around that judgment, never replace it with a weak proxy.

## Evidence workspace

Create a fresh OS temp directory. Keep plans, raw command output, timings, and the normalized report there, outside the target repository. Record HEAD and dirty state. Preserve evidence through cleanup and redact secrets from commands and output.

## 1. Survey before execution

Resolve `<skills-root>` by walking up from this installed skill, then run:

```text
<skills-root>/scripts/repository-analysis/feedback-loop-health-survey.ts
  --repo <target-repository>
  --depth quick
  --output <temp-directory>/survey.json
```

Use the skills repository's package manager and existing dependencies. The survey inventories repository-owned commands without executing them and grounds five scenario facts: **Surface / Run / Drive / Observe / Isolate**. Treat discovered commands as candidates, not proof of speed or confidence. A missing runtime, command, surface, or observation path is an explicit unavailable stage.

Prefer existing project commands and harnesses. Add no profiler or dependency during the cheap survey. Read source to understand a measurement, never to guess which stage is slow.

## 2. Model representative change scenarios

Choose the smallest scenarios that represent the user's actual wait. Include a narrow change and any broader high-risk change that invalidates more work. For each scenario, record:

- the five grounding facts from the survey;
- whether it is the baseline;
- which Launch / Doctor / Drive / Evidence / Cleanup stages are required or not required;
- cold/clean and warm/incremental conditions, without clearing shared caches;
- local or CI environment and whether each wait blocks the agent or can run concurrently;
- which command produces first signal and which commands earn adequate confidence;
- whether HITL is required, what makes behavior observable, and the manual setup burden;
- stage availability and the concrete reason for every partial or unavailable stage.

Write the runner plan using [the report contract](references/report-contract.md). The first scenario is the baseline. Every scenario declares lifecycle applicability, HITL applicability, and evidence paths. Run dynamic commands only through the shared runner:

```text
<skills-root>/scripts/repository-analysis/feedback-loop-health-run.ts
  --plan <temp-directory>/plan.json
  --output <temp-directory>/results.json
```

The runner accepts executable and argument arrays, never shell strings. It records machine and manual latency independently, compares cold/clean with warm/incremental evidence, retains partial stages, and runs declared cleanup after failed drives. Missing required lifecycle, HITL, cold, or warm evidence makes the normalized result partial. The runner rejects destructive cache-clearing commands.

## 3. Drive the real path

For runtime or HITL scenarios, use **Launch / Doctor / Drive / Evidence / Cleanup**:

1. **Launch:** start or build the real surface in isolated state.
2. **Doctor:** prove the intended instance is ready before driving it, and again after surprising behavior.
3. **Drive:** reproduce the representative change or reviewer path through an existing programmable harness where possible.
4. **Evidence:** retain command output and the action plus observable result. Record manual duration and the reviewer's own verdict.
5. **Cleanup:** remove only processes and scratch state created by the scenario. Evidence survives.

Run stages independently enough to identify startup versus execution cost. Repeat representative measurements until normal variance is visible. Record agent idle time only for waits that actually block progress. Never combine machine time with human ceremony into one unexplained duration.

## 4. Explain the measured bottleneck

Start with the dominant stage in the baseline. Classify it as necessary, redundant, unstable, overbroad, serial, uncached, divergent from CI, or manual ceremony. Investigate invalidation and test selection before recommending faster tools.

Use optimization families only as hypotheses that match measured evidence: elimination, divide and conquer, caching with named invalidation, indirection, batching, redundancy, lazy evaluation, or scheduling. Preserve verification strength. A smaller delay that loses trustworthy confidence is a regression.

When sustained optimization is warranted, hand off a frozen measurement harness: prove it is sensitive, sample enough to clear noise, freeze the ruler, then use one change, one measurement, keep or revert. Record a regression gate and a decision log so future hillclimb attempts compare against the same baseline.

## 5. Ratchet human discoveries upstream

For every human-discovered defect, ask whether its mechanism supports a deterministic regression oracle:

- invariant or state-transition assertion;
- fixture or scenario regression;
- differential or snapshot check;
- performance budget.

Record the opportunity even when it is not implemented during this audit. Keep genuinely visual, tactile, auditory, usability, or product judgment in HITL.

## 6. Report and hand off

After the baseline, annotate only measured bottleneck stages with a `finding` block from the report contract, then run the same frozen plan again. A finding in a comparison scenario names the measured baseline finding it compares against. An unlinked or missing baseline makes that recommendation unavailable instead of ranked. The runner emits the normalized diagnostic JSON before the human summary: findings, unavailable stages, confidence boundaries, and cleanup evidence. Each finding carries measured evidence and provenance, affected milestone, reason it dominates, classification, smallest plausible improvement, regression-ratchet opportunity, and owner. The recommendation remains labelled as interpretation rather than measured fact.

Evidence paths are proof, not declarations. Give the plan absolute artifact file paths in the external evidence workspace, and create each file before the runner finishes. Relative paths, directories, missing files, and paths inside the target repository make cleanup partial and appear as confidence boundaries.

Hand off by owner:

- test trustworthiness, flakes, order dependence, or confidence gaps to `test-suite-health`;
- risky churn, coupling, or change amplification to `maintenance-risk`;
- structural redesign to `codebase-design` or `improve-codebase-architecture`;
- one concrete behavior change to `tdd`;
- sustained performance work to a frozen-harness hillclimb workflow.

Finish with explicit confidence boundaries, unavailable stages, cleanup confirmation, evidence paths, and the first baseline measurement a future `codebase-health` run can consume. Do not produce a single health or performance score.
