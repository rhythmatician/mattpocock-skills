## What it does

`code-review` reviews the diff between `HEAD` and a fixed point you name (a commit, a branch, a tag, `main`, `HEAD~5`) along three axes. **Standards** asks whether the code follows how this repo writes code. **Spec** asks whether the code does what the originating issue or [spec](https://www.aihero.dev/ai-coding-dictionary/spec) asked for. **Health Regression** asks whether the change made the repository materially harder to maintain, verify, or reason about. Each axis runs in its own [sub-agent](https://www.aihero.dev/ai-coding-dictionary/subagent) so it does not inherit sibling conclusions.

The three axes are never merged or re-ranked across one another. The report ends with a worst issue *per axis* and refuses to name a single winner. Code can pass Standards and Spec while still adding a second source of truth, hidden ordering state, or a verification loop that became materially broader. A blended verdict lets a passing axis hide a failing one.

## When to reach for it

Type `/code-review`, or the agent reaches for it automatically when you ask to review a branch, a PR, work in progress, or anything "since X".

| Your situation | Reach for |
| --- | --- |
| A diff exists and you want to know if it is built right, is the right thing, and preserves repository health | `code-review` |
| You want bugs hunted in the diff: null paths, races, off-by-one | Claude Code's own built-in review, not this one (see the name clash below) |
| Nothing is written yet and you want it written test-first | [tdd](https://aihero.dev/skills-tdd) |
| A whole spec needs building, review included | [implement](https://aihero.dev/skills-implement), which calls this skill itself |
| The whole codebase has drifted, not one diff | [improve-codebase-architecture](https://aihero.dev/skills-improve-codebase-architecture) |
| Something is broken and you do not know why | [diagnosing-bugs](https://aihero.dev/skills-diagnosing-bugs) |

You must supply the fixed point. If you do not, the skill asks for one rather than guessing. Before it spawns anything, it checks that the ref resolves and that the diff is not empty, so a mistyped branch name fails in front of you instead of inside the parallel axis reviews.

## Prerequisites

The Standards axis needs nothing. It reads whatever the repo documents (`CODING_STANDARDS.md`, `CONTRIBUTING.md`, and the like) and falls back on a built-in baseline when the repo documents nothing.

The Spec axis needs a spec to exist and be findable. It looks in this order:

1. Issue references in the commit messages (`#123`, `Closes #45`, a GitLab `!67`), fetched through `docs/agents/issue-tracker.md`.
2. A path you pass in as an argument.
3. A spec file under `docs/`, `specs/`, or `.scratch/` matching the branch or feature name.
4. Asking you.

Step 1 depends on `docs/agents/issue-tracker.md`, which [setup-matt-pocock-skills](https://aihero.dev/skills-setup-matt-pocock-skills) writes. Without it the axis still works if you hand it a path. With no spec at all, the skill skips the Spec sub-agent and the report says "no spec available" rather than inventing requirements.

## The three axes

| | Standards | Spec | Health Regression |
| --- | --- | --- | --- |
| Question | Is it built right? | Is it the right thing? | Did the diff make future change or verification materially worse? |
| Reads | The repo's documented standards, plus the smell baseline | The originating issue or spec | The diff, immediate repository relationships, and bounded quick evidence |
| Reports | Documented breaches (can be hard), and smells (always judgement calls) | Missing or partial requirements, scope creep, requirements implemented wrongly | Diff-attributable regressions in authority, coupling, complexity, state, tests, verification, or dead architecture |
| Every finding cites | The standards file and the rule, or the named smell plus the hunk | The line of the spec | A diff fact, repository evidence, interpretation, proof status, and limitation |

This design exists to avoid a generic review skill that does not know your standards. Such a skill flags what is deliberate in your codebase and misses the invariants your codebase depends on. So the repo's own documentation is the [primary source](https://www.aihero.dev/ai-coding-dictionary/primary-source) on the Standards axis, and **the repo always overrides**.

The **smell baseline** sits under the repo's standards. It is twelve code smells from chapter 3 of Fowler's _Refactoring_: Mysterious Name, Duplicated Code, Feature Envy, Data Clumps, Primitive Obsession, Repeated Switches, Shotgun Surgery, Divergent Change, Speculative Generality, Message Chains, Middle Man, Refused Bequest. Each is a labelled heuristic ("possible Feature Envy"), never a hard violation. Each states what the smell is and how to fix it, so a finding comes with a fix attached rather than only a complaint. Standards skips anything your linter already enforces.

Health Regression is deliberately cheap and diff-scoped. It starts with changed files and their immediate relationships, detects the repository ecosystem, and escalates to a quick maintenance-risk or test-suite-health survey only when a material candidate needs stronger evidence. It can also use authority reasoning from knowledge-hygiene, existing feedback-loop evidence, and a valid Graphify artifact. Normalized artifacts must match the reviewed worktree identity and are intersected with the diff before they influence a finding.

It does not launch surveys by default, run a whole-codebase audit, install durable tooling, run mutation testing, or turn a generic threshold into doctrine. Missing analyzers and partial failures narrow the claim instead of being silently replaced by intuition.

Its leading question for consequential risks is the **key safety fact**: the one assumption the change is safe because of. The reviewer proves that fact only as far down the evidence ladder as proportionate, from assertion to source, failure-path reasoning, an executed check, or runtime observation. It also looks where imports and grep stop when the diff crosses formats, schemas, configuration, lifecycle timing, downstream consumers, libraries, or languages.

If the harness fans an axis out to multiple reviewers, they receive the same intent and rubric in isolated contexts. Synthesis preserves consensus, lone findings, and disagreement, then applies lead judgment. It does not blindly union every comment or manufacture reviewer personas.

## Common questions

**It collides with Claude Code's own `/code-review`. What do I do?**

This is the most reported problem with the skill, and it is not fixed. Claude Code ships its own `/code-review`, which does something different: it hunts bugs in the diff, where this one checks spec compliance and repo standards. When you install this library, one of them wins, and which one depends on how you installed:

- **Plugin marketplace.** Every skill gets a `mattpocock-skills:` prefix, and the built-in becomes hard to reach at the unqualified name.
- **Plain skills install.** The local file wins, and this skill shadows the built-in.

One answer is to remove Claude Code's built-in skills entirely. That saves a lot of [context](https://www.aihero.dev/ai-coding-dictionary/context), and the collision stops mattering. The shadowing itself is arguably a Claude Code [harness](https://www.aihero.dev/ai-coding-dictionary/harness) bug (a skill author should be free to name a skill anything), so the other answer is to rename the local copy. `npx skills update` undoes an edit to the frontmatter or a renamed directory. The durable workaround users report is to fork the skill to a new name and drop `code-review` from the managed set. Keep a note of the commit you forked from so you can re-sync by hand.

**Its sub-agents keep invoking `/code-review` again and spawn more agents.**

Every axis brief explicitly forbids recursive review and further delegation. If a harness still fans out recursively, handle that as a harness-level failure rather than accepting the extra reports.

**Should I run it in the same [session](https://www.aihero.dev/ai-coding-dictionary/session) that wrote the code?**

Prefer a fresh one. As one reader put it: "Same context reviewing itself isn't review, it's confirmation bias with a slash command." An agent that reviews in the authoring session has every assumption that shaped the code in its context. An independent reviewer would not have that context. This is also why people ask for [implement](https://aihero.dev/skills-implement) without its built-in review step, because that step runs the review inside the session that just wrote the diff. The independent version is to invoke `/code-review` yourself from a clean session.

**After every ticket, or once at the end?**

Both work, and the skill does not decide for you. Per-ticket keeps each diff small enough that the Spec axis has one clear spec to check against, which is the mode `implement` uses. Batching to the end of a branch catches interactions between tickets that the per-ticket passes each miss. If you are unsure, review per ticket and run one final pass against the branch point.

**Can I trust the findings?**

Not without checking. Sub-agent output is a hypothesis, not evidence: one team reported a dozen breaking changes that prose-based reviews had waved through. The skill keeps the three reports separate and only applies lead judgment within Health Regression, so a finding can still cite the wrong location or overstate an impact. Read the evidence on each finding before acting on it. Every finding carries a checkable anchor: a standards rule or smell hunk, a spec line, or a diff fact plus repository evidence and proof status.

**Why does it find new problems every single time I run it?**

Each fix adds new code to review, and the judgement-call half of the Standards axis gives different results from run to run. One reader described the loop: "/code-review and /improve-code-architecture always find new stuff every time. I implement fixes, rerun these skills, and again and again." There is no convergence guarantee. Treat a pass as a list of leads. Act on the ones with a cited rule behind them, then stop. Do not run it in a loop until it comes back clean, because it never will.

**Does it review my uncommitted work?**

No. It diffs `<fixed-point>...HEAD`. The three-dot form measures from the merge-base and excludes staged and working-tree changes. If `implement` has not made an interim commit, the review cannot see the work that is about to go into the next commit. Commit first, then review, then amend or add a fixup.

## It's working if

- It refuses to start on a bad ref or an empty diff, before any sub-agent is spawned.
- The report arrives as three separate blocks under `## Standards`, `## Spec`, and `## Health Regression`, not one merged list.
- Every Standards finding names either a rule in one of your repo's files or one of the twelve smells, with the hunk quoted; every Spec finding quotes a line of the spec.
- Every Health Regression finding separates the diff fact, repository evidence, interpretation, proof status, and limitations, or the axis reports a clean bounded result.
- The closing summary gives a worst issue per axis, no numeric health score, and no overall winner.
- With no spec available, the Spec block says so instead of listing requirements it inferred from the code.

## Where it fits

`code-review` is the review step near the tail of the build chain: `grill-with-docs → to-spec → to-tickets → implement → code-review → retro`. It also stands alone on any branch or PR you point it at.

- [implement](https://aihero.dev/skills-implement) is the closest neighbour. It drives the build and calls this skill as its own closing review before committing. [implement-spec](https://aihero.dev/skills-implement-spec) does the same once, over the whole integration branch.
- [retro](https://aihero.dev/skills-retro) comes after it and tunes it. When a session shows the review missing a class of mistake, `retro` proposes the check or the `CODING_STANDARDS.md` rule the Standards axis then reads.
- [pr](https://aihero.dev/skills-pr) writes the pull request body once the reviewed work goes up.
- [to-spec](https://aihero.dev/skills-to-spec) and [to-tickets](https://aihero.dev/skills-to-tickets) produce the document the Spec axis checks against, so a vague spec makes that axis vague.
- [improve-codebase-architecture](https://aihero.dev/skills-improve-codebase-architecture) is the whole-codebase counterpart, because this skill only looks at one diff.

[ask-matt](https://aihero.dev/skills-ask-matt) routes across the whole set when you are unsure which skill the situation wants.
