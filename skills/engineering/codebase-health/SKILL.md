---
name: codebase-health
description: Orchestrate independent repository-health perspectives, judge what matters, and route the next investigation.
disable-model-invocation: true
---

# Codebase Health

Answer one question: **what is actually unhealthy or risky here, which findings matter most, and what should we investigate next?**

This skill orchestrates existing diagnostics. It owns snapshot consistency, evidence reuse, correlation, prioritization, and handoff. Each child skill still owns its diagnostic method and conclusions. Never calculate a health score.

## 1. Bound the run

Resolve the target repository and choose a depth:

| Depth | Use | Bound |
| --- | --- | --- |
| `quick` | Orientation or a time-constrained check | Cheap static surveys and existing artifacts only. No mutation, repeated test runs, browser drives, or broad history. |
| `standard` | Default | Each lens runs its normal bounded survey. Expensive experiments target only leads that could change the priority order. |
| `deep` | A consequential decision or an explicitly comprehensive request | Widen history and focused experiments, but only in nominated subsystems. Comprehensive never means every analyzer against every file. |

State the intent in one paragraph: the repository, any user concern, the selected depth, and the decision this audit should support. The run is complete only when every lens has returned a normalized result or an explicit capability gap.

## 2. Freeze the evidence contract

Record one snapshot before dispatch:

```json
{
  "root": "absolute repository path",
  "head": "commit SHA or unknown",
  "dirty": false,
  "stateId": "shared repository state identifier"
}
```

Use the shared TypeScript repository-analysis substrate when it is available to establish repository state and discover existing survey artifacts. Reuse a normalized artifact only when its repository root, HEAD, dirty state, state identity, diagnostic, and schema version match this run; record rejected artifacts and the mismatch. Never rerun an expensive analyzer merely to change presentation.

Create one fresh evidence directory under the OS temp directory. Child artifacts, task briefs, and normalized returns live there for the life of this run. Do not create a durable health report unless the user asks.

If the worktree changes after dispatch, finish the current children against their recorded snapshot, mark the run `stale`, and do not silently combine new-state evidence with old-state evidence. Ask whether to rerun only when the change could alter the priority judgment.

## 3. Dispatch five independent lenses

Call the Skill tool in five isolated, read-only subagents, once for each child:

- `maintenance-risk`
- `improve-codebase-architecture`
- `test-suite-health`
- `knowledge-hygiene`
- `feedback-loop-health`

Dispatch all five in parallel when the harness supports it. Otherwise run them sequentially with the same task contract and without forwarding sibling conclusions. Every child receives the same intent, depth, snapshot, evidence-directory inventory, and normalization contract. A child may reuse matching evidence from the inventory, but it never receives another child's interpretation before returning its own result.

The architecture child runs `improve-codebase-architecture` in **health-lens mode**: ground and qualify structural candidates, then return structured findings. It does not write the visual report or start the grilling loop. Ground the full trigger-to-outcome path before escalating an architecture candidate; a metric alone is never an architectural model.

Tell each child to return exactly one JSON object, not prose for the lead to scrape:

```json
{
  "schemaVersion": 1,
  "lens": "maintenance-risk | improve-codebase-architecture | test-suite-health | knowledge-hygiene | feedback-loop-health",
  "snapshot": {
    "root": "absolute repository path",
    "head": "commit SHA or unknown",
    "dirty": false,
    "stateId": "shared repository state identifier"
  },
  "status": "complete | partial | unavailable",
  "findings": [
    {
      "id": "stable within this run",
      "category": "lens-owned category",
      "locations": ["repository-relative path or named runtime surface"],
      "evidence": [
        {
          "kind": "measurement | source | failure-path | execution | runtime | artifact",
          "value": "measured fact or direct observation",
          "provenance": "command, source location, or artifact path"
        }
      ],
      "interpretation": "why the evidence may matter",
      "confidence": "high | medium | low",
      "limitations": ["important uncertainty or unavailable evidence"],
      "nextAction": "one focused diagnostic or improvement",
      "owner": "owning skill or workflow",
      "artifactRefs": ["absolute ephemeral artifact path"]
    }
  ],
  "cleared": [
    {
      "candidate": "what was investigated",
      "reason": "why it was not elevated"
    }
  ],
  "capabilityGaps": ["unavailable or deliberately bounded diagnostic"],
  "artifactRefs": ["absolute ephemeral artifact path"]
}
```

Measured numbers remain JSON numbers inside `evidence.value`. Preserve a child's richer native report as an artifact and map it to this envelope inside that child's context. Keep `findings` empty when the lens finds no important problem: a partial or clean result is evidence, not a prompt to invent findings.

## 4. Correlate without flattening

Validate every return against the snapshot and schema before synthesis. Keep invalid or stale returns visible as capability gaps.

Build a finding ledger keyed by the repository concern, not by similar wording. Two findings converge only when their locations, mechanism, or practical consequence overlap. Record:

- supporting lenses and their independent evidence;
- lone findings with strong evidence;
- explicit contradictions, including clean evidence from another lens;
- limitations and snapshot gaps;
- the workflow that owns the next action.

Consensus raises confidence, not truth. A complex, stable, cohesive, well-tested module may be healthy despite one metric. A lone runtime failure may outrank four quiet static lenses. Preserve both cases.

## 5. Lead judgment

Act as the lead diagnostician, not a neutral aggregator. Judge each ledger item in repository context:

| Judgment | Meaning |
| --- | --- |
| Prioritize | Strong evidence and practical consequence justify a focused next action now. |
| Investigate | Plausible and consequential, but one named uncertainty must be resolved first. |
| Watch | Real signal with low current leverage or a condition that has not yet materialized. |
| Clear | Considered and rejected, contradicted, already controlled, or irrelevant here. |

Elevate cross-lens mechanisms, such as churn plus a leaking architectural secret plus weak tests, when the evidence supports the same change risk; judge mechanisms, not finding count. State why every top item outranks the strongest alternative, and why dismissed candidates were cleared.

The judgment step is complete when each important candidate has one category, its supporting and disagreeing lenses, the consequential evidence, the uncertainty boundary, and one owner for the next step.

## 6. Report and hand off

Default to the few highest-leverage findings. Report:

1. the snapshot, depth, and whether the run became stale;
2. **Prioritize** and **Investigate** items, each with evidence, supporting lenses, disagreement, and next owner;
3. important **Watch** and **Clear** decisions;
4. capability gaps and expensive diagnostics deliberately skipped;
5. ephemeral artifact locations.

Recommend the smallest focused follow-up to the owning skill: `maintenance-risk` for deeper empirical targeting, `improve-codebase-architecture` for a chosen structural candidate and its user-facing report, `test-suite-health` for confidence experiments, `knowledge-hygiene` for authority remediation planning, `feedback-loop-health` for latency or human-ceremony work. Feature implementation returns to the normal spec flow.

`architecture-guardrails` is user-invoked only: never invoke it automatically; if a settled decision needs enforcement, tell the user it is available.

The run ends with judgment and handoff. It does not repair the repository, install audit dependencies, or turn ephemeral evidence into a permanent binder unless asked.
