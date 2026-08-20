# Feedback-loop-health report contract

## Runner plan

The runner accepts one JSON object. The first scenario must be a baseline.

```json
{
  "schemaVersion": 1,
  "repositoryPath": "/absolute/repository/path",
  "scenarios": [
    {
      "id": "representative-change",
      "description": "Edit behavior and obtain a trustworthy verdict",
      "baseline": true,
      "hitlRequired": true,
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
          "timeoutMs": 30000
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

Allowed lifecycle values are `launch`, `doctor`, `drive`, `evidence`, and `cleanup`. Allowed signal values are `first-signal`, `automated-confidence`, `human-observable-state`, `hitl-setup`, and `hitl-verdict`. `environment` distinguishes `local`, `ci`, and other evidence. `agentWait` records whether a stage blocks the agent, can run concurrently, or remains unknown.

Every stage declares `available`, `partial`, or `unavailable`. Partial and unavailable stages carry a reason. Available machine stages carry an executable, argument array, repeat count, and timeout. Available manual stages carry observed duration and evidence, with an optional `accepted`, `rejected`, or `inconclusive` verdict.

`cold-clean` records a naturally cold or repository-defined clean run. It does not authorize deleting caches. `warm-incremental` records the normal loop after a representative edit.

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
      "whyItMatters": "The reviewer waits here before the changed behavior is observable",
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
    "evidencePaths": ["absolute artifact path"]
  }
}
```

Rank only bottlenecks supported by the baseline and assign an owning follow-up skill. Preserve numeric measurements as JSON numbers, cite the runner artifact, and leave `findings` empty when no measured bottleneck warrants action. Never collapse the evidence into one score.
