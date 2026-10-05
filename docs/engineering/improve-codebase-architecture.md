## What it does

`improve-codebase-architecture` surveys a codebase for **deepening opportunities**. These are places where a shallow module (an interface nearly as complex as the thing it hides) could become a deep one. It grounds the subsystem first, writes candidates to a self-contained HTML report, and then [grills](https://www.aihero.dev/ai-coding-dictionary/grilling) you through the one you pick.

It never changes the code. The whole run produces a conversation and one HTML file in your OS temp directory. You do the refactor later, in a separate [session](https://www.aihero.dev/ai-coding-dictionary/session), through the normal build flow. This makes it a survey, not a refactoring tool, so you can run it on a codebase you are not ready to touch yet.

Three disciplines keep the report from becoming generic cleanup advice. It explains the full path from trigger to outcome before critique. Every candidate asks what significant **secret** the module should hide and what **agreement** leaks across its seam. Then it applies the **deletion test**: would removing this module concentrate complexity behind a smaller interface, or just spread it across callers? Unless you point it at a specific area, recent commit history biases the scan toward paths that are actively changing, where the leverage can pay back.

## When to reach for it

Type `/improve-codebase-architecture` for the full report and grilling flow. The [agent](https://www.aihero.dev/ai-coding-dictionary/agent) reaches for it automatically only as the architecture child of [codebase-health](https://aihero.dev/skills-codebase-health); that child run returns grounded structured candidates and stops before the report or interview.

It is not a step in the main build loop. You run it periodically to queue up more work that improves the codebase. People use it in four situations:

| Situation | How it is used |
| --- | --- |
| Routine upkeep | Run it every few days, or when you have a spare moment, so the structure does not decay between features. |
| Before a big build | Point it at the [spec](https://www.aihero.dev/ai-coding-dictionary/spec) and ask "how can we make this change easy?" This is the most effective prompt for it. |
| Brownfield audit | Run it on a large, unstructured or [vibe-coded](https://www.aihero.dev/ai-coding-dictionary/vibe-coding) repo to find out what shape it is in. |
| Legacy test work | Use it to find the missing seams before you write tests against untestable code. |

Where it is confusable with siblings:

- To design one module you have already chosen, use [codebase-design](https://aihero.dev/skills-codebase-design). This skill finds the module to work on, and `codebase-design` is where you design it.
- For measured churn, temporal coupling, or evidence-based hotspot ranking, use `/maintenance-risk`. A metric can nominate an area for this survey, but it cannot replace grounding.
- For confidence in the safety net before a risky refactor, use `/test-suite-health`.
- For conflicting definitions or competing sources of truth, use `/knowledge-hygiene`.
- For a whole effort too big to hold in one session, use [wayfinder](https://aihero.dev/skills-wayfinder).
- For "this specific thing is broken," use [diagnosing-bugs](https://aihero.dev/skills-diagnosing-bugs). It sends you back here when the real finding is that there is no good seam to lock the bug down.

## Prerequisites

None to run it. If `GLOSSARY.md` or ADRs in `docs/adr/` exist, it reads them and uses your domain's own nouns. A candidate then reads as "deepen the Order intake module," not "refactor the FooBarHandler."

It writes in two places. The report goes to `<tmpdir>/architecture-review-<timestamp>.html`, outside the repo. During the grilling loop it adds or sharpens terms in `GLOSSARY.md`, and creates that file if it does not exist. It also offers to record a rejected candidate as an ADR, so a future run does not suggest it again.

## Depth, secrets, and leaking agreement

The skill turns on **depth**. A deep module puts a lot of behaviour behind a small, stable interface. The secret lens asks what difficult or changeable decision earns that interface, and whether callers still have to know fragments of it. Trivial utilities can stay trivial. A grab-bag with several unrelated secrets should split rather than deepen as one module.

The second lens is **connascence**: the concrete knowledge that must agree across a seam, judged together with its distance. Strong coordination inside one coherent module can be healthy. The same state sequence or algorithm duplicated across distant modules is a locality candidate. Weak, explicit agreement at distance may be fine.

Each card follows one stable report contract so later health work can consume it without translating free-form prose. The contract keeps the secret, leaking agreement, distance, caller shape, alternatives, direction, and evidence distinct. Caller shape comes first in the design reasoning: it says what an improved caller should know and do before types or interfaces are proposed. Consequential redesigns show at least two structurally distinct shapes.

| Badge | What it means for you |
| --- | --- |
| `Strong` | The deletion test passes clearly and the friction is real. Take these seriously. |
| `Worth exploring` | Plausible deepening, but the payoff depends on where the code is going next. |
| `Speculative` | Included for completeness. You can ignore most of these. |

The report ends with a **Top recommendation**, the candidate it would do first. Then the skill stops and asks which candidate you want to explore. At that point you have decided nothing, and no code has changed.

Inside `codebase-health`, the same grounding and qualification discipline runs without the report or grilling loop. This keeps the architecture lens independent and machine-readable while reserving the interactive design flow for a candidate you explicitly choose.

## What happens after you pick one

When you pick a candidate, a [grilling](https://aihero.dev/skills-grilling) session starts on it. It covers constraints, target caller usage, what goes behind the seam, which tests survive, and which of at least two interface shapes is strongest. The output is a decision, not a diff. From there the normal flow applies: take the decision into [to-spec](https://aihero.dev/skills-to-spec), then [to-tickets](https://aihero.dev/skills-to-tickets), then [implement](https://aihero.dev/skills-implement). Repeated escape hatches or caller-side exceptions of the same shape during implementation are evidence to re-ground and redesign; one hard edge case is not.

## Common questions

**It grilled me for an hour about one idea instead of showing me options. Can I turn that off?**

Yes. Say so when you invoke it ("don't grill me, just show the report"). This is the most common complaint about the skill. One user liked it as "a convenient way to get a thorough analysis of improvements," but after the grilling loop was added, found it "borderline unusable." In their sessions it proposed a single solution and then asked "10's or 100's of questions." The design intent is that the report comes first, and the grilling starts only on a candidate you chose. But weaker [models](https://www.aihero.dev/ai-coding-dictionary/model) skip straight to an interview about the first idea they had. Results in that thread vary a lot by model. It is an open issue, and the skill does not yet have a documented no-grill mode.

**The report opened as unstyled raw HTML with no diagrams. What happened?**

The report loads Tailwind and Mermaid from CDNs, so it needs network access when you open it. If something blocks those scripts, the page breaks with no error. In the reported case, a security hook required SRI hashes. The agent added them, but the CDN served different bytes to the browser than to the `curl` that computed the hash, so the browser blocked the script. Offline and locked-down environments have the same problem. The agent cannot see it, because it never renders the page. As a workaround, ask for inline CSS and hand-built SVG diagrams instead of the CDN setup. This is an open issue.

**It gave me twelve candidates. Do I work through them in the same session or start a new one?**

Use one candidate per session. If you work through several in one conversation, the [context window](https://www.aihero.dev/ai-coding-dictionary/context-window) fills with the report, the grilling, the domain-model edits and the code changes all at once. The report is only a temp file, so carry the candidate forward, not the file. Pick one, grill it, and take the decision into `/to-spec`. Turn the rest into [tickets](https://www.aihero.dev/ai-coding-dictionary/ticket) that you can pick up separately later. Put the chosen improvement into a spec instead of going straight to implementation. People ask this often, and the skill itself documents no workflow for it.

**How should I prompt it?**

Prompt it with the next thing you are building. If a big build is coming up, point it at the spec and ask "how can we make this change easy?" A run with no prompt looks for hot spots on its own. That is fine for routine upkeep, but a direction makes the report actionable.

**Does it work on a large legacy codebase?**

Partly. It works well on big existing codebases that lack consistent structure, and it is the recommended upkeep tool after any one-time structural setup. But users with out-of-control projects report it "helped a little but still doesn't seem to cut it." One developer with an eight-year-old legacy codebase reported that the model went in circles, though the same skill produces a clean graph on a tidy repo. There is no dedicated `/refactor` skill for that case yet. If the codebase has no shared vocabulary, run [grill-with-docs](https://aihero.dev/skills-grill-with-docs) first to create one. That usually makes this skill's output much better.

**How is this different from `/codebase-design`?**

`/codebase-design` is a reference, not a session driver. It supplies the vocabulary (module, interface, depth, seam, adapter, leverage, locality), and this skill uses it. If you give a fresh agent `/codebase-design` as the task, it fails in a known way. It has no process of its own to follow, so the agent invents one, explores the code again, and runs for a very long time before it asks you anything. Run this skill, and let it use that one.

**Does every module need an architectural secret?**

No. The question is useful when a seam claims to hide meaningful complexity. A parser may hide grammar and recovery decisions; an orchestration module may hide transition ordering. A small formatter or obvious utility can earn its keep without a grand secret. Forcing one onto trivial code produces ceremony, not depth.

**Will it ever tell me the codebase is fine?**

Rarely, so know that before you start. The skill exists to output findings, so it tends to produce candidates instead of concluding that nothing is wrong. Use the strength badges to correct for this. If every candidate in a report is `Speculative`, the skill found nothing.

**Does it work in Codex or another harness?**

Yes. The exploration step asks the current [harness](https://www.aihero.dev/ai-coding-dictionary/harness) to dispatch a subagent without naming one vendor's tool or agent type. The report format and grounding criteria are the same across harnesses; the exact dispatch mechanism can differ.

**How do I actually implement deep modules in TypeScript?**

The skill does not ship a good answer. People often ask for a `TYPESCRIPT.md` with concrete file and module layouts for the principles, and it does not exist. The skill tells you where a deepening belongs and what goes behind the seam. You must turn that into a package or directory structure yourself.

## It's working if

- The candidates name your domain's concepts, not invented class names: "the Order intake module," not "the FooBarHandler."
- The candidates are in files you edited recently, not in parts of the repo nobody touches.
- Every candidate traces the subsystem before judging it, names the module's secret, and identifies the exact agreement leaking across the seam.
- Strong local coordination is left alone when it is cohesive; strong coordination at distance earns scrutiny, while weak harmless agreement does not get inflated into a finding.
- A consequential redesign shows two distinct shapes derived from target caller usage, not two small variations on one interface.
- No code changed during the run. The only new file is the HTML report in your temp directory.
- It stops after the report and asks which candidate you want. It does not continue on its own.
- Each card explains the payoff as locality or leverage, and says which tests get simpler, not just "this is cleaner."
- When you reject a candidate for a lasting reason, it offers to record an ADR, so the next run does not suggest it again.

## Where it fits

`improve-codebase-architecture` is **periodic maintenance**. You run it every few days, outside any chain, to queue up work, not to do it. Its neighbours:

- `/maintenance-risk` ranks empirical hotspots.
- [codebase-design](https://aihero.dev/skills-codebase-design) owns the depth-and-seam vocabulary that every candidate uses.
- [grilling](https://aihero.dev/skills-grilling) walks the decision tree after you choose a candidate.
- [domain-modeling](https://aihero.dev/skills-domain-modeling) keeps `GLOSSARY.md` and the ADRs current as you make the decision.

Its output is an idea, which goes back into the main build flow at [grill-with-docs](https://aihero.dev/skills-grill-with-docs) or [to-spec](https://aihero.dev/skills-to-spec). Its counterpart at the end of the main flow is [retro](https://aihero.dev/skills-retro). This skill improves the code the agent works in, and `retro` improves the environment around it (checks, standards, steering files) after a build. For which skill fits a situation, [ask-matt](https://aihero.dev/skills-ask-matt) is the router over the whole set.
