---
name: knowledge-hygiene
description: Repository-knowledge health perspective for codebase-health. Direct invocation audits duplicate authority, stale guidance, orphan artifacts, and code/doc source-of-truth splits without rewriting them.
---

# Knowledge Hygiene

Audit whether the repository has one coherent account of reality or several independently maintained accounts. The unit of concern is **authority**, not matching text: two artifacts can use different words while both claiming to define the same fact, rule, mapping, invariant, workflow, term, or current state.

This is a review. Collect evidence, classify each candidate, and recommend the smallest consolidation or deprecation move. Similarity alone never justifies rewriting or deleting an artifact.

## Codebase-health child mode

When `codebase-health` calls this skill as its knowledge lens, use the snapshot, depth, intent, evidence inventory, and normalized return contract supplied by the parent. Keep the audit independent of sibling conclusions. Reuse matching deterministic artifacts as candidate sources, then apply the authority tests below yourself.

Map findings into the parent's structured contract inside this context. Preserve the concept, every location, direct evidence, inference, contradictions, authority status, confidence limits, and smallest next action. Classify dismissed candidates under `cleared`. At `quick` depth, inspect declared authorities, agent instructions, durable state, and obvious code/doc splits. At deeper levels, widen history and semantic candidate generation only where it can change priority.

Stop after the read-only audit. Remediation remains separately approved work.

## 1. Map the repository's authority model

Read the repository's own instructions and structure before judging it. Look for:

- root and nested agent instructions, contribution guides, and documentation indexes;
- declared canonical files, generated-file headers, schemas, registries, and code generation;
- ADR status and supersession conventions;
- domain glossaries, context maps, product docs, and API contracts;
- issue-tracker conventions for plans, progress, and current work.

Build an authority map using the repository's language. Classify each relevant artifact as one of:

- **canonical authority**: owns the current fact or rule;
- **derived representation**: intentionally projects a canonical source;
- **generated output**: reproducibly produced from another source;
- **explanation**: teaches or summarizes without defining;
- **historical record**: preserves an earlier decision or delivery record;
- **temporary state**: plans, progress, scratch notes, or handoffs;
- **unclear**: no evidence establishes its role.

Do not impose a universal documentation hierarchy. Record absent or contradictory role declarations as evidence gaps.

Complete this step when every artifact class relevant to the audit has a declared or evidence-based role, or is explicitly marked unclear.

## 2. Generate candidates deterministically

Use the evidence surfaces available in the environment. Record what was searched and any unavailable surface.

- If `graphify-out/graph.json` exists and the model-invoked `graphify` skill is available, call the Skill tool with `graphify` to query shared concepts, definitions, mappings, and relationships. Treat graph results as candidates with provenance, not findings. Build or update a graph only when the user explicitly requests it.
- Inventory durable docs, instructions, ADRs, plans, scratch artifacts, generated files, schemas, enums, registries, mappings, and tables. Flag orphan documents whose status, owner, audience, or inbound references are unclear.
- Run exact searches for canonical terms, policy language, status words, named mappings, enum members, configuration keys, and repeated instructions. Search code and docs together.
- Use semantic search when available to find independently worded definitions. Semantic similarity generates candidates only.
- Compare code, tests, configuration, schemas, generated outputs, and docs for independently maintained representations of the same fact.
- Use Git history, blame, and issue or PR state to test claims of currency, supersession, and intent. A newer artifact is not automatically authoritative.
- Look for durable files carrying temporary state: active plans, progress reports, backlogs, implementation checklists, abandoned handoffs, or scratch notes.
- Search for ADRs and decisions whose successors exist but whose status or links do not make supersession clear. A null search for a supersession record is useful evidence, not proof that supersession was intended.

Keep a candidate ledger with the concept, locations, discovery method, and searched evidence surfaces. Complete this step when every available deterministic surface has been searched or named as a coverage gap.

## 3. Test authority, not resemblance

For each candidate, answer:

1. What exact concept, fact, rule, mapping, invariant, workflow, term, or state may be defined more than once?
2. Why would a reader treat each location as current or binding?
3. Is one location explicitly derived, generated, explanatory, historical, or temporary?
4. Can one representation be regenerated or checked from another, or must they be synchronized by hand?
5. What direct evidence establishes ownership, precedence, currency, or supersession?
6. What remains inference because the record is silent?
7. Do the locations actually contradict, or do they merely overlap?

Confirm **duplicate authority** only when at least two independently maintained locations are **empowered by the repository's authority model** to define the same current truth. "Looks current or binding" is not sufficient. Current-sounding legacy or unadmitted prose that lacks such empowerment is **authority-shaped debt**. Classify it as such rather than as duplicate authority.

**Supersession is decided by proposition, not ancestry.** A current contract is not stale merely because a rule originated under a superseded ADR. Compare the actual proposition against the successor or current authority.

**Do not strengthen a finding beyond the minimum claim the evidence establishes.** Distinguish at least three grades: metadata or status is misleading; two artifacts overlap; two artifacts assert incompatible current authority. A discoverable supersession relation prevents the last grade even when stale status metadata still requires repair.

Code shape can establish current mechanics, but it does not establish historical intent. Never retrofit a rationale or a supersession story that the record does not contain.

## 4. Report findings

Start with the authority model and coverage map. Report every candidate, including candidates classified as intentional, historical, temporary, or not a problem. Group confirmed findings first, suspected findings second, and dismissed candidates last. For each candidate include:

- **Concept**: the fact or rule with competing authority.
- **Locations**: every file, symbol, issue, ADR, or generated artifact involved.
- **Why they appear authoritative or stateful**: direct evidence for each location's role.
- **Direct evidence**: citations to declarations, headers, history, issue state, or executable representations.
- **Inference**: clearly hedged conclusions not stated by a source.
- **Status**: confirmed duplicate authority, misleading status metadata, suspected, intentional projection, generated output, explanation, historical record, temporary state, or not a problem.
- **Contradictions and gaps**: disagreements, missing precedence, unavailable evidence, and null searches.
- **Likely authority**: only when repository evidence makes it clear.
- **Action**: the smallest consolidation, reference, generation, validation, archival, or deprecation move.

If no candidate clears the evidence bar, say so and list the surfaces searched. Do not inflate similarity into a finding.

## Structural follow-through

When the same correction has recurred, recommend the strongest feasible authority mechanism: an unrepresentable or derived relationship, generated output, schema, lint or CI check, canonical helper, runtime validation, then prose as the last resort. Settle the underlying rule before proposing enforcement. If `architecture-guardrails` is available, tell the user to invoke `/architecture-guardrails` for a durable architectural constraint only after the rule is settled. It is user-invoked and cannot be called by this skill.

**Do not create synchronization debt as remediation.** A derived or explanatory artifact with clear deference normally needs no change or one stable source pointer. Explicitly discourage per-entry or line-number backlinks unless granular provenance solves a demonstrated ambiguity, preferably with generation or validation.

## Safety

- Preserve reviewability. Never auto-delete, auto-archive, or rewrite competing artifacts from a similarity result.
- Preserve artifact class semantics in remediation. Do not resolve a finding by moving an artifact into a category whose admission contract its content does not satisfy, such as filing an internal architecture document under external references or historical records.
- Separate direct evidence, inference, contradictions, and coverage gaps.
- Treat generated, derived, explanatory, and historical representations as legitimate when their role and source are clear.
- Keep issue-tracker state in the audit evidence rather than copying it into durable documentation.

## Completion criteria

The audit is complete when the repository's authority model is recorded, every available evidence surface is searched or named as a gap, every candidate is classified, and every reported finding contains the required evidence fields. No repository artifact is changed unless the user separately approves remediation.
