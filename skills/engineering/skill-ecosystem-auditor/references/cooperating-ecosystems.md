# Cooperating ecosystems

Use this reference when several independently invocable skills intentionally share a workflow, artifact, principle, or synthesis phase. Composition evidence narrows a trigger finding only when the relationship is explicit. Similar descriptions alone neither prove a collision nor prove cooperation.

## Relationship tests

| Relationship | Safe when | Finding when |
|---|---|---|
| Router to specialist | The router owns routing and final synthesis; the child owns a bounded analysis | Both claim the same transition or final synthesis |
| Independently invocable child | Direct entry has its own precondition and output contract | Direct entry bypasses a required parent invariant |
| User-only skill | Every supported host excludes it from autonomous selection while preserving explicit use | Host metadata disagrees or runtime selection activates it implicitly |
| Shared principle | Procedural skills read one canonical rule and do not restate it as independent authority | Copies drift or the principle begins owning workflow state |
| Generated or project-local skill | Discovery scope, precedence, regeneration owner, and safe rerun behavior are explicit | It shadows a global skill or has multiple incompatible writers |
| Independent evidence gathering | One owner assigns questions and synthesizes returned evidence | Every worker can remediate or publish the final verdict |

## This repository's intended health network

Treat unavailable skills as conditional nodes, not broken dependencies. Audit the installed discovery scope first.

| Skill | Invocation and ownership | Intended composition |
|---|---|---|
| `codebase-health` | User-only orchestrator when installed | Routes to narrower health diagnostics and owns cross-diagnostic synthesis |
| `maintenance-risk` | Independently invocable diagnostic | Produces empirical risk candidates; hands a selected design target to `improve-codebase-architecture` |
| `test-suite-health` | Independently invocable diagnostic | Owns confidence in an existing test suite; `tdd` owns new-behavior tests |
| `knowledge-hygiene` | User-only review | Owns repository authority and stale knowledge; a separately requested report may feed synthesis, and remediation remains separately authorized |
| `feedback-loop-health` | Independently invocable diagnostic when installed | Measures feedback speed and reliability without taking test-suite or maintenance ownership |
| `improve-codebase-architecture` | User-only survey and design workflow | Consumes nominated targets and owns architectural critique, not empirical risk ranking |
| `architecture-guardrails` | User-only enforcement workflow when installed | Applies a settled durable constraint; it does not discover or choose the constraint |
| `code-review` Health Regression | Review phase when that branch is requested | Validates that a change did not regress established health evidence; remediation belongs to the implementation owner |

These handoffs can create shared vocabulary and overlapping prompt terms without creating a competing owner. Test selection and phase ownership separately.

## Deterministic composition manifest

Place an optional `.agents/skill-ecosystem.json` at the audited repository root when composition edges should be checked in CI. Version `1` has `nodes` and `edges` arrays:

```json
{
  "version": "1",
  "nodes": [
    { "name": "router", "invocation": "model-invoked" },
    {
      "name": "future-specialist",
      "availability": "conditional",
      "invocation": "model-invoked"
    }
  ],
  "edges": [
    {
      "from": "router",
      "kind": "invokes",
      "to": "specialist",
      "bounded": true
    },
    {
      "from": "specialist",
      "kind": "may-invoke",
      "to": "router",
      "bounded": true
    }
  ]
}
```

`from` and `to` name discovered or declared skills. A conditional node may be absent from the current discovery scope; a required node may not. `invocation` records `model-invoked` or `user-only` and is checked against discovered metadata. `kind` uses the composition vocabulary from `SKILL.md`. Set `bounded` only when a declared invocation cycle has an independently enforceable stop condition. The check rejects an unknown endpoint, an autonomous edge into a user-only skill, or a cycle whose every edge is not explicitly bounded. Semantic ownership still belongs to the deep audit.

## External case study

The repository fixture at `scripts/repository-analysis/fixtures/cooperating-skill-ecosystem` adapts the MIT-licensed [pstack plugin](https://github.com/cursor/plugins/tree/main/pstack) as a host-neutral composition graph:

- one explicit router over specialist skills;
- independent interrogation and architecture specialists;
- several procedural skills reading one short shared principle;
- creation and maintenance workflows around a project-local verification skill;
- one synthesis owner for independent evidence gathering.

The fixture deliberately omits model rosters, sticky modes, Cursor discovery paths, terminal multiplexers, and browser assumptions. Its purpose is to challenge the composition model with a real nontrivial shape, not to reproduce pstack's host runtime.

Ask of this case:

- Does intentional routing avoid a false trigger-collision verdict?
- Can each child remain independently invocable without competing for parent synthesis?
- Does the shared principle remain a canonical dependency rather than a duplicated workflow?
- Can the project-local verification skill coexist with globally discovered skills?
- Are creation and maintenance distinct writers with compatible entry conditions?
