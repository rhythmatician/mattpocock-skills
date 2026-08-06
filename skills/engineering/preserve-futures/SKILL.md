---

name: preserve-futures
description: Analyze a bounded completed region at a strategic checkpoint to detect concrete optionality loss, preserve non-obvious evidence for known future work, and route follow-up work before downstream fan-out multiplies the cost.
---

# Preserve Futures

A **future** is a concrete path a system may plausibly need to take later.

Features create value now, but they can also make later changes unnecessarily harder. Preserve Futures is a periodic architectural feedback sensor: it examines a bounded region of completed work, asks what options became more expensive or impossible, and preserves useful evidence for known future work.

It is not ordinary code review, and it is not an implementation concern.

## Place in the workflow

A deliberately narrow role:

* **Wayfinder schedules futures checkpoints.** It places them at strategic boundaries where completed work may constrain important downstream choices or where later work is about to amplify those constraints.
* **Preserve Futures executes the checkpoint.** It assesses optionality, records evidence, and returns planning consequences.
* **Implementation agents do not carry a futures watchlist.** They should concentrate on the current task.
* **Code Review does not perform futures analysis.** Code Review judges the completed change against present standards and specification; Preserve Futures judges what the completed region did to future option space.
* **Wayfinder owns roadmap changes.** Preserve Futures reports whether downstream work should proceed, pause, or be reconsidered; it does not rewrite the map itself.

The skill may also be invoked manually against a specific diff or named area.

### Read-only by default

Preserve Futures does **not** modify production code.

It may write planning artifacts when repository conventions and the invocation permit it, including:

* checkpoint resolution comments,
* evidence on registered future anchors,
* structured handoffs for follow-up work.

A futures checkpoint identifies structural pressure. A separate implementation session performs any remediation.

## Known futures are context, not requirements

A repository may maintain a registry of known future work: future tracker items, a roadmap, a futures document, architectural notes, or another project-specific convention.

When one exists, use it.

Known futures answer:

> Which plausible later changes are important enough that unnecessary constraints against them matter?

They do **not** mean:

> Build support for these futures now.

Never introduce speculative abstractions merely because a future is registered.

If the repository defines no futures registry, use only futures explicitly supplied by the invocation, current Wayfinder handoff, or user. Don't silently invent a registry or create future anchors.

## Modes

### Checkpoint mode - preferred

Used when Wayfinder or another planning workflow supplies a strategic checkpoint.

Scope is the bounded region completed since a named starting boundary and before a named downstream boundary.

Examples of boundaries include:

* a previous futures checkpoint,
* a closed decision ticket,
* an integration point,
* a commit or merge base,
* a completed phase,
* another explicit project landmark.

Checkpoint mode examines both:

1. **Optionality loss**:  what the completed region made harder.
2. **Future observations**:  non-obvious evidence discovered by the completed work that a known future effort should inherit.

### Change mode - explicit

Scope is one current ticket or one fixed-point diff plus its immediate architectural neighborhood.

Use when the user explicitly asks for futures analysis on a particular change rather than waiting for a scheduled checkpoint.

### Baseline mode - explicit

Scope is a named, bounded module, subsystem, hot spot, or comparable existing area supplied by the user.

Don't infer a baseline area.

## The smart zone

Before scanning, confirm the scope is a **smart zone**: one coherent region that can be understood with enough headroom to notice unexpected relationships.

This is a structural judgment, not a token count.

A checkpoint should normally cover work since the previous checkpoint, not an arbitrarily large project history.

When the scope exceeds the smart zone:

* don't produce a partial assessment that looks complete;
* identify natural split points;
* in checkpoint mode, recommend that Wayfinder insert earlier checkpoints or split the checkpoint by coherent subsystem;
* in change or baseline mode, route oversized well-understood work through `to-spec` / `to-tickets`, or unresolved planning through `wayfinder`.

When scope exceeds the smart zone, stop after the scope judgment and routing recommendation.

## Context loading

Before scanning:

1. Follow the repository's domain-documentation instructions.
2. Load the current architectural vocabulary and governing decisions.
3. Establish the exact scope anchors.
4. Load the relevant Wayfinder map or planning context when checkpoint mode supplies one.
5. Load the project's registered futures at low resolution.
6. Open detailed future anchors only when they are relevant to the completed region.
7. Collect the code, diff, tests, decisions, or other artifacts inside the bounded scope.

Don't preload detailed future context into unrelated work.

### Graph evidence

When an existing repository graph can materially improve understanding of coupling, fan-out, cross-module dependencies, or architectural seams, use the repository's graph-analysis skill or tool.

Graph evidence supports the assessment; it does not replace source inspection or domain decisions.

## Process

### 1. Establish the checkpoint

Record:

* mode,
* scope start/end,
* downstream boundary, if any,
* known future anchors consulted,
* current architectural decisions governing the region.

For change mode, identify either:

* the current ticket, or
* a fixed-point diff resolved with `git rev-parse`.

For baseline, record user-named area.

*Done when the bounded scope and relevant future context are explicit.*

### 2. Scan for candidate closures

Look for concrete ways the change may have reduced future option space.

Common signals:

* **Interface narrowing**:  callers lose a degree of freedom they previously controlled.
* **Representation lock-in**:  a local representation leaks across boundaries and becomes expensive to replace.
* **Cross-module coupling**:  reversing one decision now requires coordinated changes in many places.
* **Assumption leakage**:  provider-, version-, platform-, backend-, environment-, or domain-specific assumptions escape the adapter or seam where they belong.
* **Fan-out multiplication**:  downstream components begin depending on a decision that was formerly local.
* **Constraint without requirement**:  the design forbids something no present requirement requires it to forbid.
* **Abstraction collapse**:  a seam disappears even though a concrete current or registered future depends on the variable it controlled.
* **Tests that freeze implementation**:  tests unnecessarily lock structure rather than behavior.
* **One-way migration**:  a transition removes a plausible rollback, compatibility, or alternate-path option without a forcing reason.

Don't treat general ugliness, large files, or stylistic preference as futures findings by themselves.

### 3. Gather evidence before classifying

For every candidate, record:

1. **Closure evidence**
   What concrete interface, dependency, representation, constraint, or test structure closes the path?

2. **Option evidence**
   What named current use or registered future makes the path valuable?

   A merely imaginable use is not evidence.

3. **Forcing-requirement evidence**
   What present requirement, deliberate trade-off, dependency, or invariant actually requires the closure?

   If none exists, record `none`.

4. **Amplification evidence**
   What downstream work, if any, is about to multiply the cost of reversing this decision?

   If none visible, record `none`.

### 4. Classify every closure

Assign exactly one classification.

| Classification              | Meaning                                                                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **necessary constraint**    | A present requirement, deliberate trade-off, dependency, or invariant requires the closure.                                           |
| **unnecessary constraint**  | A concrete current or registered future option is evidenced, and no present forcing requirement requires the closure.                 |
| **speculative flexibility** | No forcing requirement requires the closure, but no concrete current or registered future option makes preserving it valuable either. |

Use the decision order:

1. forcing requirement present → **necessary constraint**
2. otherwise concrete option evidence present → **unnecessary constraint**
3. otherwise → **speculative flexibility**

Don't classify a merely conceivable future as an unnecessary constraint.

### 5. Choose one disposition

Each finding receives exactly one.

| Classification              | Disposition                | Use when                                                                                                          |
| --------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **necessary constraint**    | **accept as necessary**    | The present requirement justifies the closure.                                                                    |
| **speculative flexibility** | **reject as speculative**  | No concrete option makes the flexibility valuable.                                                                |
| **unnecessary constraint**  | **protect before fan-out** | Downstream work is about to amplify the cost of the closure; planning should intervene before that work proceeds. |
| **unnecessary constraint**  | **record for later**       | The closure is real, but no imminent fan-out makes remediation urgent.                                            |
| **unnecessary constraint**  | **hand off**               | Resolving the closure requires a specialist or an unresolved design decision.                                     |

Preserve Futures does not repair the code itself.

### 6. Harvest future observations

Optionality findings are not the only useful output.

The completed region may reveal a concrete, non-obvious fact that a registered future effort should inherit even when nothing is wrong today.

Examples:

* an API assumption that a future platform will not share;
* an external dependency behavior that future version support must account for;
* a semantic concept that turns out to be less universal than expected;
* an adapter boundary that successfully contains a future-sensitive detail;
* a test fixture or dataset limitation that a future effort will need to revisit;
* a compatibility hazard discovered while implementing unrelated current work.

A **future observation** must be:

* concrete,
* evidence-backed,
* materially relevant to a registered future,
* non-obvious enough to be worth preserving,
* outside the scope of current implementation unless it also produces a futures finding.

Don't proactively research registered futures during an ordinary checkpoint. Harvest what the completed region actually revealed.

### Recording future observations

When the project provides a writable future anchor, prefer one concise digest per affected future per checkpoint rather than many small comments.

Use this shape:

```markdown
### Future observation - <checkpoint or scope>

**Observation:** <concrete fact>

**Evidence:** <code, documentation, test result, external API, decision, etc.>

**Why this future cares:** <specific implication>

**Current action:** none | <planning consequence if one exists>
```

Avoid duplicating observations already recorded on the anchor.

If the project has no writable anchor, include the observation in the checkpoint output instead.

### Candidate new futures

Occasionally a checkpoint reveals a major plausible future that wasn't registered.

Don't create an anchor automatically.

Report it as a **candidate future anchor** only when:

* the future is concrete rather than imaginable,
* the evidence shows it may materially affect architecture,
* preserving it would be useful beyond the current checkpoint.

Wayfinder or the human decides whether it deserves a durable anchor.

### 7. Determine whether downstream work is safe to release

Checkpoint mode must answer:

> Can the named downstream work proceed without first addressing a futures finding?

Return one of:

* **release**:  no finding requires intervention before downstream fan-out;
* **hold for planning**:  at least one `protect before fan-out` or unresolved handoff should be addressed before downstream work proceeds.

This is a planning signal, not a code gate.

Wayfinder decides how to modify dependencies, create tickets, or alter the route.

## Routing

Route only when the evidence requires another skill or a fresh session.

Package every handoff with:

* bounded scope,
* concrete finding,
* closure evidence,
* option evidence,
* forcing-requirement evidence,
* amplification evidence,
* relevant future anchor,
* downstream work at risk.

| Situation                                       | Route to                        |
| ----------------------------------------------- | ------------------------------- |
| Semantic ambiguity or unclear concept ownership | `domain-modeling`               |
| Local interface or seam question                | `codebase-design`               |
| Deeper structural friction across modules       | `improve-codebase-architecture` |
| Alternative worth testing before deciding       | `prototype`                     |
| Weak behavioral confidence                      | `strengthen-test-suite`         |
| Clear oversized remediation                     | `to-spec` then `to-tickets`     |
| Route itself is unclear                         | `wayfinder`                     |

## Output

```markdown
## Futures assessment - <scope identifier>

**Mode:** checkpoint | change | baseline
**Scope start:** <anchor>
**end:** <anchor>
**Downstream boundary:** <named work or "none">
**Known futures consulted:** <anchors or "none">
**Smart zone:** confirmed | exceeded (<reason>)

### Optionality findings

| # | Closure evidence | Concrete option evidence | Forcing requirement | Amplification evidence | Classification | Disposition |
|---|---|---|---|---|---|---|
| 1 | ... | ... | none | ... | unnecessary constraint | protect before fan-out |

If none: `No concrete optionality loss found.`

### Future observations

| Future | Observation | Evidence | Why it matters later | Recorded |
|---|---|---|---|---|
| ... | ... | ... | ... | anchor link / output only |

If none: `No material future observations.`

### Candidate future anchors

<list evidence-backed candidates, or "none">

### Planning handoff

**Downstream:** release | hold for planning

<concise explanation of any work Wayfinder should reconsider, add, reorder, or route>

### Routed work

<packaged handoffs, or "none">
```
