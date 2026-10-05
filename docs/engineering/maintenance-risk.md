## What it does

`maintenance-risk` finds parts of a repository where change is empirically risky, expensive, or confusing. It combines Git history with deterministic static analysis to rank temporal coupling, churn and complexity hotspots, wide changes, cognitive complexity, dependency pathology, and candidate dead architecture.

A metric nominates an investigation target; it never authorizes a redesign by itself. The skill traces the high-value candidates in source and keeps measured facts separate from architectural interpretation.

## When to reach for it

Type `/maintenance-risk`, or the [agent](https://www.aihero.dev/ai-coding-dictionary/agent) reaches for it automatically when a task asks for empirical repository risk.

| Situation | Reach for |
| --- | --- |
| Changes keep touching unrelated files | `maintenance-risk` to measure temporal coupling and change amplification |
| You need an evidence-based refactor starting point | `maintenance-risk` to rank candidates |
| You want a comprehensive health assessment | `codebase-health` when that orchestrator is available |
| You have chosen a module and need to redesign it | [improve-codebase-architecture](https://aihero.dev/skills-improve-codebase-architecture) |
| One isolated feature or bug is in scope | Keep the owning build or diagnosis workflow |

## Prerequisites

The target must be a Git repository for evolutionary evidence. Omen is optional: when it is already installed, the survey uses its machine-readable complexity, hotspot, dependency, and dead-code analyzers. Missing tools become explicit unavailable capabilities rather than invented findings.

An existing `graphify-out/graph.json` is reused for dependency evidence. The survey writes its JSON artifact to the OS temp directory, not into the repository being measured.

## Evidence, then judgment

The leading idea is **evidence**. Each finding carries provenance and an evidence-strength level, from an unsupported assertion through cited source, traced failure path, executed analysis, and a running-system reproduction.

The report ranks evidence relative to the repository. It does not turn a universal complexity or file-size threshold into an architectural verdict. A hotspot becomes important when repository context and multiple signals converge.

## Where static analysis stops

Temporal coupling often points to relationships imports cannot show. For consequential findings, the skill checks non-static seams such as:

- wire formats and schemas;
- configuration and shared conventions;
- cross-language readers and writers;
- lifecycle or timing behavior;
- external-library contracts.

Hard dependency claims use mechanically extracted edges. Semantic or inferred graph edges remain clues to investigate.

## Common questions

**Does it replace `improve-codebase-architecture`?**

No. `maintenance-risk` owns empirical nomination and ranking. [Improve-codebase-architecture](https://aihero.dev/skills-improve-codebase-architecture) owns architectural criticism and refactoring direction after a target has been understood.

**What happens if Omen or Graphify is missing?**

The report becomes partial and names the unavailable phases. Git-backed temporal coupling and change amplification can still run when Git is available. The agent does not calculate the missing metrics itself.

**Will the highest complexity score automatically become the top recommendation?**

No. The skill weighs repository-relative rank, how often the code changes, how widely changes fan out, and whether source tracing confirms a practical maintenance consequence.

## It's working if

- Every important finding contains measured values and names the tool or artifact that produced them.
- Facts and interpretations are visibly separate.
- Missing analyzers narrow the report instead of producing plausible-looking replacements.
- Existing Graphify output is consumed without rebuilding a second dependency graph.
- The top recommendation names one focused investigation or refactoring target.

## Where it fits

`maintenance-risk` is a reach-for-it-anytime diagnostic and an empirical input to a broader codebase-health assessment. It hands a chosen target to [improve-codebase-architecture](https://aihero.dev/skills-improve-codebase-architecture), which owns design judgment and refactoring direction. For the map over the complete skill set, use [ask-matt](https://aihero.dev/skills-ask-matt).
