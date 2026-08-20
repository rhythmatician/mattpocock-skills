---
name: maintenance-risk
description: "Find empirically risky repository areas from churn, temporal coupling, change amplification, cognitive complexity, dependency pathology, and dead-architecture evidence. Use for maintenance hotspots, hidden co-change coupling, shotgun surgery, or evidence-based refactor prioritization. For whole-codebase health use codebase-health; for designing a chosen refactor use improve-codebase-architecture."
---

# Maintenance Risk

Find where repository evidence shows that change is unusually risky, expensive, or confusing. This skill measures risk candidates. It does not treat a score as permission to redesign code.

## Route the request

- Use this skill for empirical maintenance risk, technical-debt hotspots, temporal coupling, repeated wide changes, or evidence-based refactor prioritization.
- Hand generic "assess this codebase's health" requests to `codebase-health` when that orchestrator is available.
- Hand the design of a chosen module or refactor to `improve-codebase-architecture`.
- Ordinary feature work and isolated bugs stay with their owning workflow unless the user explicitly asks for repository-risk evidence.

## Run the survey

1. Resolve this skill's repository root by walking upward from `SKILL.md` to the `package.json` containing `maintenance-risk:survey`.
2. Pick `standard` depth unless the user asked for a quick scan or deep history. The depth bounds history, analyzer output, and runtime. It never changes the meaning of a metric.
3. Create a fresh output path outside the target repository, under the OS temp directory.
4. Run:

   ```text
   npm run maintenance-risk:survey -- --repo <absolute-target> --depth <quick|standard|deep> --output <absolute-temp-json>
   ```

   Run it from the resolved skills repository root. The survey uses Git directly, calls Omen when it is already available, and consumes `graphify-out/graph.json` when present. It does not add audit dependencies to the target repository.
5. Read the JSON even when the command exits `2`: that exit means partial evidence, and `failures` names every unavailable or bounded capability. Exit `1` means the survey itself failed.

If the runner cannot be resolved, report `survey-runner` as unavailable and stop. Never replace a missing deterministic phase with model-calculated metrics.

The survey step is complete when all six evidence sets have an explicit status and every non-complete set has a matching failure or bounded-analysis explanation:

- temporal coupling;
- churn x complexity hotspots;
- change amplification;
- cognitive complexity;
- dependency pathology;
- dead architecture.

## Interpret the evidence

Rank within this repository. Use observations, percentiles supplied by analyzers, and convergence between phases. A universal complexity or file-size cutoff is not an architectural verdict.

For each high-value candidate:

1. **Understand before critiquing.** Trace the subsystem and runtime role from source. A metric nominates an investigation target; it does not explain why the code has its current shape.
2. **Separate fact from interpretation.** Preserve the measured values verbatim, then state the architectural meaning as a distinct interpretation.
3. **Look where static edges stop.** When temporal coupling has no matching mechanical dependency, or a finding depends on an unseen seam, inspect wire formats, schemas, configuration, conventions, cross-language consumers, lifecycle timing, and external-library behavior.
4. **Prove the consequential fact cheaply.** If one testable claim determines whether the risk is real, run a focused script, test, or reproduction. Do not promote an unrun explanation to proof.
5. **Treat dead code as a candidate.** Reachability evidence can nominate a fossil adapter, queue, factory, compatibility path, or stale flag. Confirm its role and history before calling the architecture dead.

Mechanical Graphify edges can support hard dependency findings. `INFERRED` and `AMBIGUOUS` edges are investigation clues only.
Use the traced subsystem model to assess suspicious dependency direction; graph centrality alone cannot establish which direction is architecturally correct.

## Evidence ladder

Every important finding states where its strongest claim stopped:

1. `assertion`: agent interpretation only;
2. `source`: analyzer artifact or cited source location;
3. `failure-path`: the relevant failure or change path was traced;
4. `executed`: a deterministic analyzer, script, or test established the fact;
5. `runtime`: the behavior was reproduced in the running system.

The survey records level `4` for executed Git/Omen evidence and level `2` for a persisted Graphify artifact. Raise a claim only when this run adds the stronger proof.

## Report

Load [the report contract](references/report-contract.md). Emit its JSON object first, followed by a short ranked summary for the human.

Keep measured facts, interpretations, unavailable capabilities, and cleared candidates distinct. A partial survey is a valid report with narrower claims, not a complete-looking fallback.

The skill is complete when every important finding names its files, suspicious metric, practical maintenance consequence, claim type, evidence strength and provenance, and one focused next investigation or refactoring target.
