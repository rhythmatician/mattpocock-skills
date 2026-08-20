## What it does

`codebase-health` answers the broad repository question: what is actually unhealthy or risky, which findings matter most, and what should happen next? It runs five independent perspectives over one repository snapshot, then correlates and prioritizes their evidence.

It is an orchestrator, not another analyzer. Maintenance risk, architecture, test confidence, knowledge authority, and feedback latency keep their own methods. The skill adds **lead judgment**: convergence raises confidence, disagreement stays visible, and one strong finding can outrank a weak consensus. It never reduces the repository to a health score.

## When to reach for it

You invoke this by typing `/codebase-health`, and the [agent](https://www.aihero.dev/ai-coding-dictionary/agent) will not reach for it on its own.

| Your question | Reach for |
| --- | --- |
| What are the highest-leverage risks across this repository? | `codebase-health` |
| Which files are empirically expensive or risky to change? | [maintenance-risk](https://aihero.dev/skills-maintenance-risk) |
| Does this test suite deserve confidence? | [test-suite-health](https://aihero.dev/skills-test-suite-health) |
| Is our edit-to-verdict path too slow or manual? | [feedback-loop-health](https://aihero.dev/skills-feedback-loop-health) |
| Which chosen module shape should we improve? | [improve-codebase-architecture](https://aihero.dev/skills-improve-codebase-architecture) |
| Do docs, code, and instructions compete to define current truth? | [knowledge-hygiene](https://aihero.dev/skills-knowledge-hygiene) |

Use the focused skill when you already know which diagnostic question you are asking. Use `codebase-health` when prioritization across those questions is the work.

## Independent lenses, lead judgment

The five lenses start from the same intent and snapshot in separate [subagent](https://www.aihero.dev/ai-coding-dictionary/subagent) contexts. They do not see sibling conclusions before returning, so agreement is independent signal and disagreement cannot be quietly averaged away.

Each lens returns structured evidence: locations, measurements or source observations, interpretation, confidence boundaries, the next action, and ephemeral artifact references. The lead then classifies concerns as **Prioritize**, **Investigate**, **Watch**, or **Clear**. That classification is contextual judgment, not a vote. A lone reproduced failure can beat several weak static suspicions; a complex but stable, cohesive, well-tested module can be cleared.

## Bounded depth

| Mode | What it buys |
| --- | --- |
| `quick` | Orientation from cheap surveys and matching existing artifacts. |
| `standard` | The default bounded pass, with targeted experiments only where they can change priorities. |
| `deep` | Wider history and focused experiments in nominated subsystems for a consequential decision. |

All modes stay targeted. A deep run does not install every analyzer or run every expensive check against every file.

Evidence lives under the OS temp directory by default. The skill leaves no durable health report in the repository unless you ask for one.

## Common questions

**Will five lenses give me five unrelated reports?**

No. Their native evidence remains available, but the default output is a short priority judgment: the few findings with the most leverage, why they outrank the alternatives, which lenses support or contradict them, and which focused workflow owns the next move.

**Does agreement between several lenses prove a problem?**

No. Convergence raises confidence when the lenses point to the same mechanism or consequence. The lead still grounds the repository context and can clear a popular finding or elevate a strong lone one.

**Does it fix what it finds?**

No. It hands each next action to the owning skill or normal implementation flow. Architectural enforcement remains a separate, explicitly user-invoked choice.

## It's working if

- Every lens used the same repository HEAD, dirty state, and state identity, or the report clearly names the mismatch.
- The top findings explain why they outrank the strongest alternative rather than merely listing more evidence.
- Independent agreement is visible, and explicit disagreement remains attached to the finding.
- Clean results and cleared candidates appear where they materially narrow the conclusion.
- The report names expensive diagnostics it skipped and the uncertainty that remains.
- The next action belongs to one focused workflow, while the repository itself remains unchanged.

## Where it fits

`codebase-health` is periodic maintenance and a reach-for-it-anytime repository audit. It sits above the five focused health lenses and hands chosen work back down to them; it does not replace their methods or join the feature build chain.

[ask-matt](https://aihero.dev/skills-ask-matt) routes across the whole set when you are unsure whether the broad orchestrator or one focused diagnostic fits.
