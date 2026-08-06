---
name: preserve-futures
description: Preserve concrete futures in a diff, ticket, or named area as the sole futures operator. In the distributed futures trigger, Wayfinder is the scheduler, Implement is the sensor, and Code Review is the read-only safety net; Preserve Futures alone assesses and resolves candidate closures.
---

# Preserve Futures

A **future** is a concrete path a change keeps open. AI-accelerated development closes futures faster than a developer can notice. This skill identifies which closures are unnecessary and acts within its authority, routing on evidence to the right specialist.

## Distributed futures trigger

Preserve Futures is the **sole futures operator**. Its peer skills may create evidence-backed handoffs, but they do not perform this assessment or restoration workflow:

- **Wayfinder is the futures scheduler.** It schedules a later checkpoint at a predicted optionality pressure point and does not assess or restore a future while planning.
- **Implement is the futures sensor.** It triggers a checkpoint only when emergent semantic ambiguity or structural friction in the current ticket risks closing a concrete option. It supplies bounded change evidence and does not classify or restore the option.
- **Code Review is the futures safety net.** It recommends a separate Preserve Futures session when its read-only review finds concrete optionality loss in a completed diff. It does not invoke restoration or fold a futures classification into Standards or Spec findings.
- **Preserve Futures is the futures operator.** It establishes scope, classifies every candidate closure, and restores, accepts, records, or hands off each finding.

A scheduled checkpoint, implementation trigger, or review recommendation starts a separate Preserve Futures workflow under the authority and scope of that handoff. None transfers operator ownership to the peer skill.

## Modes

### Change mode (default)

Scope: the current ticket or fixed-point diff, plus the **immediate module neighborhood** — modules directly imported by or importing the changed modules, and any module whose interface the change touches.

### Baseline mode (explicit only)

Scope: a named, bounded module, subsystem, hot spot, or comparable existing area the user explicitly supplies.

Baseline mode requires the user to name the area. The skill does not select or infer a scope.

## The smart zone

Before scanning, confirm the scope is a **smart zone**: one coherent task that can be understood, changed, verified, and reviewed with headroom for unexpected findings. This is a structural judgment, not a token count.

When scope exceeds the smart zone, route immediately and produce no findings:

- Decisions unresolved before ticketing → **`wayfinder`**
- Scope well-understood but too large → **`to-spec` then `to-tickets`**

## Process

### 1. Establish scope

Before scanning anything, follow the repository's domain-documentation instructions in `docs/agents/domain.md`. This loads the relevant context glossary and governing ADRs; their vocabulary governs every classification and output below.

**Change mode:** identify the scope anchor before collecting evidence:

- **Current ticket:** record its issue number, URL, path, or supplied title. A ticket-scoped assessment does not require or invent a fixed point.
- **Fixed-point diff:** resolve the supplied commit SHA, branch, or tag with `git rev-parse <ref>` and record it before collecting the diff. If the reference does not resolve, ask for a valid one before continuing.

If neither anchor is identifiable from the invocation or current task context, ask the user for a current ticket or base reference. Then collect the immediate module neighborhood — modules directly imported by or importing the changed modules, and any module whose interface the change touches.

**Baseline mode:** read the named area.

_Done when domain context is loaded, scope is a confirmed smart zone, and (for change mode) the current ticket or resolved fixed point is recorded — or a routing decision is made._

### 2. Identify and classify candidate closures

Scan the scope for changes that may close concrete paths:

- Interface narrowing — removed parameters, collapsed return types, deleted overloads
- Coupling that requires touching N call sites to reverse a local decision
- Constraint added without a requirement forcing it
- Abstraction removed where it controlled a variable the caller can no longer reach
- Test structure that locks the implementation rather than the behavior

For every candidate, record three kinds of evidence before classifying it:

1. **Closure evidence** — the changed interface, coupling, constraint, abstraction, or test structure.
2. **Option evidence** — a named current use or planned use of the path that the candidate closes, plus evidence of why preserving that path is valuable. A merely imaginable use is not evidence that the option is valuable.
3. **Forcing-requirement evidence** — the named requirement, deliberate trade-off, or dependency that requires this closure. If none is supplied or found, record `none` rather than inferring one.

Then assign exactly one classification using this decision table, in order. Use the exact lowercase classification labels shown in the table and output contract:

| Category | Meaning |
|---|---|
| **necessary constraint** | Forcing-requirement evidence names a requirement, deliberate trade-off, or dependency that requires the closure. |
| **unnecessary constraint** | Closure evidence and option evidence show that the candidate closes a named, concrete current or planned option, and no forcing requirement requires that closure. |
| **speculative flexibility** | No forcing requirement requires the closure, and there is no evidence that a named, concrete current or planned option is valuable. |

The classifications are mutually exclusive: forcing-requirement evidence makes the constraint necessary; without it, positive option evidence makes the constraint unnecessary; without either, the flexibility is speculative. Do not classify the same evidence as both unnecessary and speculative, and do not use speculative flexibility as a fallback when option evidence exists.

_Done when every candidate has exactly one classification and its evidence supports that classification._

### 3. Resolve every finding

Each classified finding reaches exactly one compatible resolution before the session ends. Use the exact lowercase resolution labels shown in the table and output contract:

| Classification | Allowed resolution | When to use it |
|---|---|---|
| **unnecessary constraint** | **restore now** | The three conditions in Step 4 are met; perform the restoration. |
| **unnecessary constraint** | **record for later** | The option is evidenced, but restoration exceeds the smart zone or the task's authority; package it for a fresh agent session. |
| **unnecessary constraint** | **hand off** | Restoring the evidenced option requires a specialist; route it as described in [Routing](#routing). |
| **necessary constraint** | **accept as necessary** | Record the forcing requirement and close the finding. |
| **speculative flexibility** | **reject as speculative** | Record that no evidence makes a concrete option valuable and close the finding. |

Do not attach multiple resolutions, leave a resolution pending, or resolve a finding in a way that conflicts with its classification.

_Done when every finding has exactly one compatible resolution._

### 4. Restoration

A **restore now** action must satisfy all three:

1. **Behavior-preserving** — observable behavior at the module's interface does not change.
2. **Within the smart zone** — no edit outside the established scope.
3. **Within authority** — the invoking task has the right to make this change.

When any condition fails, resolve the unnecessary constraint as **record for later** or **hand off**.

After making the change, verify it: run the existing tests for the affected module and confirm all pass. If no tests cover the restored interface, note this as a weak-confidence signal in the output.

_Done when each restore-now change has passed all three conditions and verification is complete._

## Routing

Route only when an unnecessary constraint reaches **hand off**. Most sessions produce no routes.

Package every routed item for a fresh agent session: include the bounded scope, the specific finding, and any context the specialist needs. Use the Codebase Design vocabulary — **module**, **interface**, **seam**, **depth**, **adapter**, **leverage**, **locality** — when packaging. Reach for the `codebase-design` skill for the full vocabulary.

| Situation | Route to |
|---|---|
| Semantic ambiguity — unclear concept meaning or behavioral ownership | `domain-modeling` |
| Local interface or seam question | `codebase-design` |
| Deeper structural friction beyond local scope | `improve-codebase-architecture` |
| Uncertain alternative — worth exploring before deciding | `prototype` |
| Weak test confidence — structural restoration not covered by behavioral tests | `strengthen-test-suite` |
| Clear oversized work | `to-spec` then `to-tickets` |
| Unclear oversized work — decisions unresolved before ticketing | `wayfinder` |

## Output

```
## Futures assessment — <scope identifier>

**Mode:** change | baseline
**Ticket:** <identifier> (ticket-scoped change mode only)
**Fixed point:** <resolved ref> (diff-scoped change mode only)
**Smart zone:** confirmed | exceeded (<reason>)

### Findings

| # | Closure evidence | Concrete option evidence | Forcing requirement | Classification | Resolution |
|---|---|---|---|---|---|
| 1 | parameter narrows `Iterable` to `list` | named current or planned iterable use | none | unnecessary constraint | restore now |
| 2 | provider limit rejects batches above 100 items | named option closed by the provider limit | provider accepts at most 100 items | necessary constraint | accept as necessary |
| 3 | return type narrows `Iterable` to `list` | none found | none | speculative flexibility | reject as speculative |

### Restorations performed

<list any restore-now changes made, or "none">
<for each: note whether verification passed or flagged weak test confidence>

### Recorded work

<for each record-for-later finding:>
- **Scope:** <bounded module or area>
- **Option:** <concrete path that was closed>
- **Evidence:** <what in the diff or code closes it>
- **Destination:** <fresh agent session | named skill>
- **Verification context:** <what a subsequent session needs to confirm restoration is safe>

### Routed work

<list any hand-offs packaged for fresh sessions, or "none">
```

When scope exceeds the smart zone, produce only the smart zone judgment and the routing recommendation.
