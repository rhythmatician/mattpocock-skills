# Engineering

Skills I use daily for code work.

## User-invoked

Reachable only when you type them (Claude Code: `disable-model-invocation: true`; Codex: `policy.allow_implicit_invocation: false` in `agents/openai.yaml`).

- **[ask-matt](./ask-matt/SKILL.md)**: Ask which skill or flow fits your situation. A router over the user-invoked skills in this repo.
- **[architecture-guardrails](./architecture-guardrails/SKILL.md)**: Turn a settled architectural invariant into executable dependency or boundary enforcement that runs locally and in CI.
- **[codebase-health](./codebase-health/SKILL.md)**: Orchestrate five independent repository-health perspectives, prioritize what matters, and route the next focused investigation.
- **[grill-with-docs](./grill-with-docs/SKILL.md)**: Grilling session that also builds your project's domain model, sharpening terminology and updating `CONTEXT.md` and ADRs inline.
- **[domain-architect-interrogator](./domain-architect-interrogator/SKILL.md)**: Interrogate the domain expert (you) about a product design as a senior architect: sea-level goals, ubiquitous language, boundary stress tests, with implementation mechanics firmly black-boxed.
- **[triage](./triage/SKILL.md)**: Move issues through a state machine of triage roles.
- **[setup-matt-pocock-skills](./setup-matt-pocock-skills/SKILL.md)**: Configure this repo for the engineering skills (issue tracker, triage labels, domain doc layout). Run once per repo.
- **[to-spec](./to-spec/SKILL.md)**: Turn the current conversation into a spec and publish it to the issue tracker.
- **[to-tickets](./to-tickets/SKILL.md)**: Break any plan, spec, or conversation into a set of tracer-bullet tickets, each declaring its blocking edges, whether as text in a local file or as native blocking links on a real tracker.
- **[implement](./implement/SKILL.md)**: Build the work described by a spec or set of tickets, driving `/tdd` at pre-agreed seams and closing out with `/code-review` before committing.
- **[wayfinder](./wayfinder/SKILL.md)**: Plan a huge chunk of work (more than one agent session can hold) as a shared map of decision tickets on the issue tracker, resolved one at a time until the way to the destination is clear.

## Model-invoked

Model- or user-reachable (rich trigger phrasing so the model can reach for them).

- **[prototype](./prototype/SKILL.md)**: Build a throwaway prototype to answer a design question: a single shareable HTML file for state/logic, or several toggleable UI variations.

- **[diagnosing-bugs](./diagnosing-bugs/SKILL.md)**: Disciplined diagnosis loop for hard bugs and performance regressions: build a feedback loop that goes red on this bug → minimise → hypothesise → instrument → fix → regression-test.
- **[research](./research/SKILL.md)**: Investigate a question against high-trust primary sources and capture the findings as a cited Markdown file in the repo, run as a background agent.
- **[improve-codebase-architecture](./improve-codebase-architecture/SKILL.md)**: Supply the architecture lens for `codebase-health`; direct invocation presents grounded deepening candidates in an HTML report, then grills the one you pick.
- **[knowledge-hygiene](./knowledge-hygiene/SKILL.md)**: Audit duplicate authority, stale repository knowledge, conflicting agent instructions, and code/doc source-of-truth splits without rewriting suspected duplicates.
- **[feedback-loop-health](./feedback-loop-health/SKILL.md)**: Measure end-to-end time from an edit to trustworthy automated or human feedback, then identify the stages that dominate the wait.
- **[maintenance-risk](./maintenance-risk/SKILL.md)**: Find empirical maintenance hotspots through deterministic history, complexity, dependency, and dead-architecture evidence.
- **[skill-ecosystem-auditor](./skill-ecosystem-auditor/SKILL.md)**: Audit a cooperating skill ecosystem for trigger collisions, ownership conflicts, unsafe composition, host differences, and user-only invocation leaks.
- **[tdd](./tdd/SKILL.md)**: Test-driven development with a red-green-refactor loop. Builds features or fixes bugs one vertical slice at a time.
- **[test-suite-health](./test-suite-health/SKILL.md)**: Audit whether an existing test suite deserves confidence through cheap diagnostics, focused resilience and state checks, and optional targeted mutation.
- **[domain-modeling](./domain-modeling/SKILL.md)**: Actively build and sharpen a project's domain model by challenging terms, stress-testing with scenarios, and updating `CONTEXT.md` and ADRs inline.
- **[domain-voice](./domain-voice/SKILL.md)**: Hold any design conversation at the domain level: redirect implementation mechanics on sight, enforce one concept one name, and ask every question in plain words.
- **[codebase-design](./codebase-design/SKILL.md)**: Shared discipline and vocabulary for designing deep modules: small interfaces, clean seams, testable through the interface.
- **[graphify](./graphify/SKILL.md)**: Build and query an evidence-backed knowledge graph for code, documents, and other project content.
- **[code-review](./code-review/SKILL.md)**: Three-axis review of the diff since a fixed point: **Standards**, **Spec**, and diff-scoped **Health Regression**, run in isolated parallel sub-agents.
- **[preserve-futures](./preserve-futures/SKILL.md)**: Assess a bounded completed region for concrete optionality loss and hand planning consequences to the owning workflow.
- **[resolving-merge-conflicts](./resolving-merge-conflicts/SKILL.md)**: Work through an in-progress git merge or rebase conflict hunk by hunk, resolving by intent traced to each side's primary source, then finish the operation, never `--abort`.
- **[wizard](./wizard/SKILL.md)**: Generate an interactive bash wizard that walks a human through steps only they can perform: provisioning infrastructure, setting up credentials or CI secrets, walking an unfamiliar third-party dashboard, or running a one-off migration or cutover.
