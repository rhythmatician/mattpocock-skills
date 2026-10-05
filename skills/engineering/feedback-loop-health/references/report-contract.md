# Feedback-loop-health report contract

## Runner plan

The runner accepts one JSON object. The first scenario must be a baseline.

```json
{
  "schemaVersion": 1,
  "repositoryPath": "/absolute/repository/path",
  "evidencePaths": ["/absolute/temp/path/scenario.json"],
  "scenarios": [
    {
      "id": "representative-change",
      "description": "Edit behavior and obtain a trustworthy verdict",
      "baseline": true,
      "hitlRequired": true,
      "lifecycleApplicability": {
        "launch": "required",
        "doctor": "required",
        "drive": "required",
        "evidence": "required",
        "cleanup": "required"
      },
      "grounding": {
        "surface": "the user or reviewer surface",
        "run": "the repository-owned startup path",
        "drive": "the programmable scenario path",
        "observe": "the durable evidence surface",
        "isolate": "the disposable state or concurrency boundary"
      },
      "regressionRatchetOpportunities": [],
      "stages": [
        {
          "id": "fast-check",
          "lifecycle": "drive",
          "signal": "first-signal",
          "latency": "machine",
          "agentWait": "blocked",
          "condition": "warm-incremental",
          "environment": "local",
          "availability": "available",
          "command": {
            "executable": "npm",
            "args": ["test", "--", "changed.test.ts"]
          },
          "repeatCount": 5,
          "timeoutMs": 30000,
          "finding": {
            "classification": "serial",
            "whyItMatters": "This stage blocks adequate confidence",
            "smallestImprovement": "Run the focused check independently",
            "regressionRatchetOpportunity": "Add a duration budget",
            "owner": "feedback-loop-health"
          }
        },
        {
          "id": "reviewer-setup",
          "lifecycle": "doctor",
          "signal": "hitl-setup",
          "latency": "manual",
          "condition": "warm-incremental",
          "availability": "available",
          "manual": {
            "durationMs": 12000,
            "evidence": "Reviewer opened the seeded scenario"
          }
        },
        {
          "id": "visual-verdict",
          "lifecycle": "evidence",
          "signal": "hitl-verdict",
          "latency": "manual",
          "condition": "warm-incremental",
          "availability": "unavailable",
          "reason": "No reviewer was present"
        }
      ]
    }
  ]
}
```

Allowed lifecycle values are `launch`, `doctor`, `drive`, `evidence`, and `cleanup`. Every scenario maps each one to `required` or `not-required`; a required stage with no successful result is an explicit confidence boundary. Allowed signal values are `first-signal`, `automated-confidence`, `human-observable-state`, `hitl-setup`, and `hitl-verdict`. `environment` distinguishes `local`, `ci`, and other evidence. `agentWait` records whether a stage blocks the agent, can run concurrently, or remains unknown.

Every stage declares `available`, `partial`, or `unavailable`. Partial and unavailable stages carry a reason. Available machine stages carry an executable, argument array, repeat count, and timeout. Available manual stages carry observed duration and evidence, with an optional `accepted`, `rejected`, or `inconclusive` verdict.

`cold-clean` records a naturally cold or repository-defined clean run. It does not authorize deleting caches. `warm-incremental` records the normal loop after a representative edit.

The example is intentionally partial: it omits cold evidence and several required lifecycle stages, and its HITL verdict is unavailable. A complete result needs at least one successful cold/clean and warm/incremental sample, every required lifecycle stage, and, when `hitlRequired` is true, successful human-observable-state, HITL setup, and HITL verdict milestones.

Add `finding` only after a baseline identifies a measured bottleneck. Its reason, classification, smallest improvement, regression ratchet, and owner are interpretations supplied by the investigation. The runner attaches measured timing and provenance and labels the resulting claim `interpretation`; it never fabricates a recommendation from duration alone.

The finding ID is `<scenario-id>:<stage-id>`. A finding on a scenario with `baseline: false` also supplies `baselineFindingId`, pointing to an emitted finding from a baseline scenario. Without that measured link the runner omits the recommendation from `findings`, marks `finding:<stage-id>` unavailable, and makes the comparison scenario partial.

Every `evidencePaths` entry must be an absolute path to an artifact file that exists after the scenario run and resolves outside the target repository. The runner keeps only valid files in `cleanup.evidencePaths`. Relative paths, directories, missing files, and in-repository paths appear in `cleanup.unavailableEvidencePaths`, make cleanup partial, and become confidence boundaries.

## Normalized result

The runner emits `schemaVersion: 1` and `diagnostic: feedback-loop-health` for composition by future health surveys. Each scenario preserves:

- baseline identity and Surface / Run / Drive / Observe / Isolate grounding;
- lifecycle stage results, raw outputs, repeats, exit codes, and explicit gaps;
- milestone status and separate machine/manual duration;
- cold/clean and warm/incremental totals and sample counts;
- local and CI totals, plus blocking agent idle time where observed;
- the three longest measured stages as bottleneck candidates;
- regression-ratchet opportunities supplied by the investigation.

`partial` is a valid result. It means at least one planned stage failed, was skipped, or remained partial or unavailable. The report must retain that boundary instead of filling it with inference.

## Diagnostic report

Before the human summary, emit one JSON object that keeps interpretation separate from the runner's measurements:

```json
{
  "schemaVersion": 1,
  "diagnostic": "feedback-loop-health",
  "repository": {
    "root": "absolute path",
    "head": "commit SHA or unknown",
    "stateId": "repository state identifier",
    "dirty": false
  },
  "status": "complete | partial",
  "findings": [
    {
      "id": "stable finding identifier",
      "baselineFindingId": "baseline-scenario:baseline-stage when this is a comparison",
      "rank": 1,
      "scenarioId": "representative-change",
      "stageId": "reviewer-setup",
      "signal": "hitl-setup",
      "classification": "necessary | redundant | unstable | overbroad | serial | uncached | local-ci-divergence | manual-ceremony",
      "measurement": {
        "condition": "warm-incremental",
        "environment": "local",
        "machineMs": 0,
        "manualMs": 12000,
        "agentIdleMs": 12000,
        "sampleCount": 1
      },
      "reason": "The reviewer waits here before the changed behavior is observable",
      "smallestImprovement": "Seed and deep-link the review scenario",
      "regressionRatchetOpportunity": "none | deterministic oracle to add",
      "owner": "feedback-loop-health | test-suite-health | maintenance-risk | tdd | codebase-design | improve-codebase-architecture | hillclimb",
      "provenance": ["artifact path or command record"]
    }
  ],
  "unavailableStages": [
    {
      "scenarioId": "representative-change",
      "stageId": "visual-verdict",
      "reason": "No reviewer was present"
    }
  ],
  "confidenceBoundaries": ["What remains unknown"],
  "cleanup": {
    "status": "complete | partial",
    "evidencePaths": ["validated absolute artifact path"],
    "unavailableEvidencePaths": [
      {
        "path": "rejected artifact path",
        "reason": "missing or inside the target repository"
      }
    ]
  }
}
```

Rank only bottlenecks supported by the baseline and assign an owning follow-up skill. Preserve numeric measurements as JSON numbers, cite the runner artifact, and leave `findings` empty when no measured bottleneck warrants action. Never collapse the evidence into one score.
