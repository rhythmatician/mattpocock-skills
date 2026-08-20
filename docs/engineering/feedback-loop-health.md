## What it does

`feedback-loop-health` measures how long it takes to move from an edit to trustworthy feedback, then identifies the few stages that dominate the wait. It covers fast machine signals, adequate automated confidence, the point where changed behavior becomes observable, manual setup, and the final [human-in-the-loop](https://www.aihero.dev/ai-coding-dictionary/human-in-the-loop) (HITL) verdict.

The baseline comes before optimization. The skill measures the real path and preserves verification strength, including genuinely perceptual judgments that belong with a human rather than a proxy metric.

## When to reach for it

Type `/feedback-loop-health`, or the agent reaches for it automatically when a task fits. Reach for it when:

- edit, build, test, restart, or preview loops feel slow;
- confidence arrives only in CI;
- a small edit invalidates or reruns too much work;
- an agent waits a long time before it can show a change;
- a reviewer performs substantial setup before the changed behavior is visible;
- machine checks are quick but the end-to-end verdict is still slow.

For a suite that is fast enough but may not deserve confidence, use [test-suite-health](https://aihero.dev/skills-test-suite-health). For one hard bug that needs a red reproducer, use [diagnosing-bugs](https://aihero.dev/skills-diagnosing-bugs).

## The path to trustworthy feedback

The skill keeps five milestones separate:

| Milestone | What becomes available |
| --- | --- |
| First signal | The earliest useful machine response to the edit |
| Automated confidence | The checks justified by the change's risk |
| Human-observable state | The behavior is ready to perceive or experience |
| HITL setup | The reviewer has reached the relevant scenario state |
| HITL verdict | The reviewer can accept, reject, or report inconclusive evidence |

Machine latency and manual ceremony are reported independently. Cold or clean behavior is compared with the normal warm incremental loop without destroying shared caches.

## The measurement story

Every runtime scenario is grounded in Surface / Run / Drive / Observe / Isolate, then exercised through Launch / Doctor / Drive / Evidence / Cleanup. This makes a slow stage attributable instead of leaving one opaque wall-clock number.

For sustained improvements, the skill hands off a frozen [harness](https://www.aihero.dev/ai-coding-dictionary/harness): one sensitive ruler, enough samples to clear noise, and one change followed by one measurement. Human-discovered mechanistic failures are recorded as regression-ratchet opportunities, while visual, auditory, tactile, usability, and product judgments stay with the reviewer.

## Common questions

**Will it make every human check automated?**

No. It automates cheap, deterministic setup and evidence collection around the judgment. A genuinely experiential decision remains human.

**Does a fast unit-test command mean the loop is healthy?**

Only if it is the right first signal and the rest of the path is also acceptable. A fast command can coexist with slow startup, broad rebuilds, weak confidence, or expensive reviewer setup.

**Does it clear caches to create a cold run?**

No. It observes a naturally cold or repository-defined clean condition. Destructive cache clearing can damage shared work and often measures an artificial workflow.

**What happens after it finds a bottleneck?**

It names the smallest plausible improvement and the owning skill. Test trust goes to `test-suite-health`, repository risk to `maintenance-risk`, structural redesign to `codebase-design` or `improve-codebase-architecture`, and sustained optimization to a frozen-harness hillclimb.

## It's working if

- You can name the first useful signal and the later point of adequate confidence separately.
- Cold/clean and warm/incremental numbers come from the same representative scenario.
- Human setup time is visible instead of being hidden inside machine timing.
- Missing or inconclusive stages remain explicit in the report.
- Each recommended change cites a measured bottleneck and preserves confidence.

## Where it fits

This is a periodic maintenance and diagnostic skill. It complements [test-suite-health](https://aihero.dev/skills-test-suite-health) and [maintenance-risk](https://aihero.dev/skills-maintenance-risk), and it can act as one lens inside a future whole-codebase health pass. See [ask-matt](https://aihero.dev/skills-ask-matt) for the complete map.
