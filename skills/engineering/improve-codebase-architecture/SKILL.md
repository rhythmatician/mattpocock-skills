---
name: improve-codebase-architecture
description: Scan a codebase for deepening opportunities, present them as a visual HTML report, then grill through whichever one you pick.
disable-model-invocation: true
---

# Improve Codebase Architecture

Surface architectural friction and propose **deepening opportunities**: refactors that turn shallow modules into deep ones. The aim is testability and AI-navigability.

This command is _informed_ by the project's domain model and built on a shared design vocabulary:

- Call the Skill tool with "codebase-design" for the architecture vocabulary (**module**, **interface**, **depth**, **seam**, **adapter**, **leverage**, **locality**) and its principles (the deletion test, "the interface is the test surface", "one adapter = hypothetical seam, two = real"). Use these terms exactly in every suggestion, and don't drift into "component," "service," "API," or "boundary."
- The domain language in `CONTEXT.md` gives names to good seams; ADRs in `docs/adr/` record decisions this command should not re-litigate.

## Process

### 1. Ground the subsystem

**Scope before you scan: YAGNI.** Deepening a module pays off by making future changes to it easier, so put extra weight on the parts of the codebase that have recently changed. Decide *where* to look before you look:

- If the user named a direction (a module, a subsystem, a pain point), take it, and skip the inference below.
- Otherwise, walk back a good stretch of the commit history (`git log --oneline`) to find the codebase's hot spots, the files and areas that keep coming up, and let those paths pull your attention first. If the changes are scattered with no clear hot spot, widen the net.

Read the project's domain glossary (`CONTEXT.md`) and any ADRs in the area you're touching first. Then spawn a sub-agent to walk the codebase. For each area it investigates, require a traced model of:

- the trigger or input and the callers that initiate the flow;
- the call, data, and state path through the relevant modules;
- what each module owns and what callers must already know;
- the observable outcomes, tests, and non-obvious constraints.

Grounding is complete when the full path from trigger to outcome can be explained without guessing from file names or hand-waving a transition. Explain the subsystem before critiquing it. A suspicious file, metric, or dependency nominates an area to understand, not a redesign.

### 2. Qualify candidates

Explore organically and note where you experience friction:

- Where does understanding one concept require bouncing between many small modules?
- Where are modules **shallow**, with an interface nearly as complex as the implementation?
- Where have pure functions been extracted just for testability, but the real bugs hide in how they're called (no **locality**)?
- Where must callers or modules preserve the same knowledge across a seam?
- Which parts of the codebase are untested, or hard to test through their current interface?

For each plausible candidate, work in this order:

1. **Caller shape first.** Write how callers use the current shape, then the smaller set of facts and actions an improved caller should need. Keep this as usage prose. Types and interfaces come after the user chooses a candidate.
2. **Module secret.** Ask what difficult, likely-to-change, or implementation-specific decision the module should hide. Does that secret justify the seam? Do callers still know fragments of it? Is the module mostly ceremony? Are pieces of one secret scattered across several modules? A trivial utility does not need a grand secret.
3. **Leaking agreement.** Name the exact knowledge that must agree across the seam and where the participants live. Distinguish strong coordination kept local from strong coordination spread across distant modules. Weak agreement at distance may be harmless. Read [CONNASCENCE.md](CONNASCENCE.md) when a candidate depends on cross-seam agreement; use its qualitative vocabulary without assigning fake taxonomy precision.
4. **Cohesion gate.** Ask whether the responsibilities belong together for one reason to change. Interaction alone does not justify merging. A grab-bag fails this gate and should split around coherent secrets instead of being deepened as one module.
5. **Deletion test.** Would deleting the module concentrate complexity, or just move it? A "yes, concentrates" is the signal you want.
6. **Friction pattern.** Repeated escape hatches, caller-side special cases, duplicated sequencing, or deviations of the same shape are redesign evidence. One isolated edge case is not.

For a consequential redesign, sketch at least two structurally distinct module shapes before recommending one. Compare whole shapes, not point fixes inside the first idea. Each shape starts from the target caller usage and states which secret and agreement it would localize.

### 3. Present candidates as an HTML report

Write a self-contained HTML file to the OS temp directory so nothing lands in the repo. Resolve the temp dir from `$TMPDIR`, falling back to `/tmp` (or `%TEMP%` on Windows), and write to `<tmpdir>/architecture-review-<timestamp>.html` so each run gets a fresh file. Open it for the user (`xdg-open <path>` on Linux, `open <path>` on macOS, `start <path>` on Windows) and tell them the absolute path.

The report uses **Tailwind via CDN** for layout and styling, and **Mermaid via CDN** for diagrams where a graph/flow/sequence reliably communicates the structure. Mix Mermaid with hand-crafted CSS/SVG visuals: use Mermaid when relationships are graph-shaped (call graphs, dependencies, sequences), and hand-built divs/SVG when you want something more editorial (mass diagrams, cross-sections, collapse animations). Each candidate gets a **before/after visualisation**. Be visual.

For each candidate, render a card with these exact fields in this order. Keep the labels stable so later health reports can consume a candidate without translating free-form prose:

- **Files**: which files/modules are involved
- **Secret**: the decision the proposed or deepened module would hide
- **Leaking agreement**: what callers or modules currently must know or coordinate
- **Distance/locality**: where the participants live and whether strong coordination is kept local or spread at distance
- **Caller shape**: what an improved caller should need to know and do, written as usage before any interface design
- **Alternative shapes considered**: for a consequential redesign, at least two materially different structures; otherwise `Not consequential` and why
- **Refactor direction**: how the recommended shape localizes the secret and agreement behind a smaller seam
- **Evidence**: the traced flow and repeated friction that support the candidate, with isolated incidents identified as such
- **Benefits**: locality, leverage, and how tests would improve
- **Before / After diagram**: side-by-side, custom-drawn, illustrating the shallowness and the deepening
- **Recommendation strength**: one of `Strong`, `Worth exploring`, `Speculative`, rendered as a badge

End the report with a **Top recommendation** section: which candidate you'd tackle first and why.

**Use CONTEXT.md vocabulary for the domain, and the `/codebase-design` vocabulary for the architecture.** If `CONTEXT.md` defines "Order," talk about "the Order intake module," not "the FooBarHandler," and not "the Order service."

**ADR conflicts**: if a candidate contradicts an existing ADR, only surface it when the friction is real enough to warrant revisiting the ADR. Mark it clearly in the card (e.g. a warning callout: _"contradicts ADR-0007, but worth reopening because…"_). Don't list every theoretical refactor an ADR forbids.

See [HTML-REPORT.md](HTML-REPORT.md) for the full HTML scaffold, diagram patterns, and styling guidance.

Do not propose types or interfaces yet. After the file is written, ask the user: "Which of these would you like to explore?"

### 4. Grilling loop

Once the user picks a candidate, call the Skill tool with "grilling" to walk the decision tree with them: constraints, dependencies, target caller usage, what sits behind the seam, what tests survive. For a consequential redesign, call the Skill tool with "codebase-design" and require at least two structurally distinct interfaces before synthesis.

Side effects happen inline as decisions crystallize; call the Skill tool with "domain-modeling" to keep the domain model current as you go:

- **Naming a deepened module after a concept not in `CONTEXT.md`?** Add the term to `CONTEXT.md`. Create the file lazily if it doesn't exist.
- **Sharpening a fuzzy term during the conversation?** Update `CONTEXT.md` right there.
- **User rejects the candidate with a load-bearing reason?** Offer an ADR, framed as: _"Want me to record this as an ADR so future architecture reviews don't re-suggest it?"_ Only offer when the reason would actually be needed by a future explorer to avoid re-suggesting the same thing; skip ephemeral reasons ("not worth it right now") and self-evident ones.
- **Implementation reports repeated deviations, escape hatches, or caller knowledge of the same shape?** Re-ground with the new evidence and redesign. Scrap a wrong shape instead of accumulating exceptions. One hard edge case does not trigger this.

## Ecosystem handoffs

Keep this skill on module shape. Route adjacent questions at the point they become the actual blocker:

- For empirical cost, churn, temporal coupling, change amplification, or hotspot ranking, call the Skill tool with "maintenance-risk". Its measurements can nominate an area, but grounding still precedes architecture critique.
- For whether the existing suite deserves confidence before a risky refactor, call the Skill tool with "test-suite-health".
- For conflicting definitions, duplicate authority, or stale agent guidance, tell the user to run `/knowledge-hygiene`; it is user-invoked and cannot be called by this skill.
- For slow time-to-confidence, use `feedback-loop-health` only when it appears in the available skill list. Otherwise name the gap and keep it out of the architecture verdict.
- For broad synthesis, tell the user to run `/codebase-health` only when it appears in the available skill list. Otherwise preserve the exact candidate fields above for that future orchestrator without claiming it is installed.
- Turn a settled decision into permanent enforcement only when the user explicitly asks. If `architecture-guardrails` is available, tell the user to invoke it; otherwise record the decision without inventing an enforcement workflow.
