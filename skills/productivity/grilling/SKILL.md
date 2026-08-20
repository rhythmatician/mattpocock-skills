---
name: grilling
description: Grill the user relentlessly about a plan, decision, or idea. Use when the user wants to stress-test their thinking, or uses any 'grill' trigger phrases.
---

Interview the user relentlessly until you reach a shared understanding. Map this as a **design tree**: every decision branches into the decisions that hang off it.

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled: the questions you can ask _now_ without guessing at answers you haven't heard yet. Ask the whole frontier in one round: number each question and give your recommended answer. Then wait for the user's answers before the next round.

Each question should be formatted like so:

```
❓ **Q1** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>
```

Each round the user answers reshapes the tree: settled decisions push the frontier outward and unblock questions that depended on them. Recompute the frontier and ask the next round. A question whose answer depends on another question still open in this round belongs to a _later_ round, not this one.

Finding _facts_ is your job, never the user's. When a frontier question needs a fact from the environment (filesystem, tools, etc.), dispatch a sub-agent to find it; don't ask the user for anything you could look up yourself. Don't block on it: a running exploration is an unsettled prerequisite, so only the questions downstream of it wait for the sub-agent to report; ask the rest of the frontier now. The _decisions_ are the user's: put each to them and wait.

### Technical depth stays on a leash

Some frontier questions are genuinely technical, and deciding them is the point of the session. But grilling fails when each round drifts one level more technical than the last until the user can no longer follow what is being decided. Guard against it:

- A question's technical depth may serve the decision on the frontier, never spawn sub-decisions about implementation mechanics. If answering a question properly requires a mechanic the user would have to take on faith, that is a smell: pull the question back up to the decision the user actually owns.
- When you have a technical recommendation, state it as a decision ("➡️ I recommend X because Y") the user can accept or reject, not as a topic to explore together. The user decides; they do not need to re-derive your reasoning.
- Watch for the hydra pattern across rounds: round N's questions noticeably more implementation-flavored than round 1's. If the tree keeps sprouting technical sub-branches, stop, name what is happening, and re-anchor at the highest unsettled decision. Where the user wants the interview held at the domain level from the start, route them to `/domain-architect-interrogator` instead.

The session is done when the frontier is empty: every branch of the design tree visited, nothing left silently assumed. Do not act on it until the user confirms you have reached a shared understanding.
