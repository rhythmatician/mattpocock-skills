# Quantitative rubric

Use this reference only for quantitative certification, CI design, or calibration. These formulas and thresholds are `HEURISTIC` operational defaults, not Agent Skills specification requirements. Report `not measured` whenever required inputs are absent. Never renormalize missing dimensions or let a score conceal a blocker.

## Evidence prerequisites

Use exact host and model tokenization when available. Otherwise use the larger of whitespace-token count and `ceil(characters / 4)`, labeled `HEURISTIC`.

Dynamic metrics require:

- a versioned host and model;
- a saved representative workload or trigger corpus;
- selection or behavior observations for the complete ecosystem;
- isolation and no-skill baselines where quality uplift is claimed;
- workload frequencies for expected-cost calculations.

## Token economics

For skill `i`:

```text
E_i = M_i + p_i * (B_i + sum(q_ik * R_ik))
TER_i = 10000 * (Q_with - Q_without) / E_i
TER_static_i = 1000 * D_i / B_i
CatalogPressure = catalog_cost / host_catalog_budget
ActiveSkillPressure = retained_active_tokens / min(25000, 0.25 * effective_context)
```

`M` is catalog cost, `p` is observed activation probability, `B` is rendered body tokens, `q` and `R` model resource loading, `Q` is mean workload score, and `D` is the count of unique testable directives.

| Measure | Green | Amber | Red | Blocker |
|---|---:|---:|---:|---:|
| TER | `>=20` | `5 to <20` | `0 to <5` | `<0` |
| TER static | `>=8` | `4 to <8` | `<4` | none |
| Catalog or active pressure | `<0.70` | `0.70 to 1.00` | `>1.00` | host hard limit exceeded |

`TER_static` is not evidence that a skill improves task quality.

## Trigger evaluation

For each implicitly invocable skill, start with at least 20 intended positives, 20 clear negatives, 10 near-neighbors per likely collision, 10 paraphrases, 5 underspecified prompts, and 5 irrelevant prompts containing trigger terms.

For pair `i,j`:

```text
O_ij = |A_i intersection A_j| / min(|A_i|, |A_j|)
J_ij = |P_i intersection P_j| / |P_i union P_j|
U_ij = 0.25 when composition is explicit; otherwise 1.0
C_ij = U_ij * (0.7 * O_ij + 0.3 * J_ij)
TO = 100 * (1 - mean(max_pair_collision_per_skill))
```

Default policy bands:

- precision and recall at least `0.85`;
- trigger orthogonality green at `>=85`, amber at `70 to 84`, and red below `70`;
- undeclared pair collision warning at `>=0.35` and blocker at `>=0.50`;
- precision below `0.60` is a blocker.

Report intended workflow or domain co-activation separately from competing ownership.

## Imperative determinism

Assign each atomic directive a binary value:

```text
A = concrete actor and action
I = explicit input or precondition
O = explicit output or transition
V = explicit verification
S = explicit stop condition, branch boundary, or retry limit
G = unresolved vague modal, referent, or discretion
ID = 100 * clamp(0, 1, 0.30A + 0.20I + 0.20O + 0.15V + 0.15S - 0.20G)
```

Default bands are green at `>=85`, amber at `70 to 84`, and red below `70`. Any destructive, privileged, externally visible, or irreversible action without explicit input, output, and verification is a blocker independent of ID.

## Boundary separation

Classify directives as workflow, domain mechanics, repository or business, or shared interface.

```text
BS = 100 * (1 - 0.60L_h - 0.25L_s - 0.15D_c)
```

`L_h` is hard tier leakage, `L_s` is soft tier leakage, and `D_c` is duplicated cross-tier meaning without a declared source or override. Default bands are green at `>=90`, amber at `75 to 89`, and red below `75`.

Treat conflicting ownership and conditionally loaded universal safety invariants as blockers.

## Composition safety

```text
CS = 100 * (0.25P + 0.20X + 0.20T + 0.20M + 0.15R)
```

`P` is one owner per phase, `X` is explicit entry and exit conditions, `T` is persisted transition artifacts, `M` is explicit nonconflicting mutation permission, and `R` is bounded or idempotent reruns.

Default bands are green at `>=90`, amber at `75 to 89`, and red below `75`. Block unbounded cycles, competing transition owners, unauthorized review writes, repeatable non-idempotent destruction, conversation-only completion state, and required contracts removable by documented compaction.

## Cross-dimension verdict

Report each measured dimension and its gate separately. Certification requires every dimension named by the selected policy to be measured and to meet its calibrated gate. Any blocker rejects independently.

An aggregate score remains unavailable until the repository defines reproducible dimension formulas and calibrates their weighting against the target workload. Label incomplete measurement sets `not certified`.

## Calibration and CI

Before enforcing thresholds, seed known failures and clean controls, then record false positives and false negatives. Calibrate by repository, host, model tier, and workload date.

A changed-skill CI run should cover canonical validation, reference validation, token delta, description collision scanning, changed-skill trigger regression, affected composition chains, and sidecar consistency. A scheduled full run may add the complete trigger corpus, host matrix, quality baseline, and lifecycle simulations.
