# Connascence

Use this reference when an architecture candidate depends on agreement across a seam. **Connascence** means that changing one participant requires a corresponding change in another. The useful question is not "how tightly coupled is this?" but "what must agree, and how far apart are the participants?"

## Name the agreement

Describe the concrete agreement in project language. Common kinds include:

| Agreement | What to trace |
| --- | --- |
| Names and identifiers | Matching keys, event names, routes, fields, or configuration names |
| Values and constants | Sentinels, units, ranges, flags, or protocol values that must match |
| Types and shapes | Data layouts, schemas, variants, and error forms understood in several places |
| Position and order | Argument position, field order, operation order, or precedence assumptions |
| Meaning and algorithms | Duplicated calculations, normalization, validation, or interpretation rules |
| State and sequence | Transitions or multi-step protocols that must happen in the same order |
| Timing and lifecycle | Startup, teardown, retries, expiry, concurrency, or delivery assumptions |

Use the most specific plain description the evidence supports. These rows are prompts for investigation, not a score or a requirement to assign a formal subtype.

## Judge strength with locality

Strength is the cost of changing the agreement safely. Distance is how much code, ownership, deployment, or runtime context separates the participants. Judge them together:

| Pattern | Architectural reading |
| --- | --- |
| Strong and local | Often healthy coordination inside one coherent module |
| Strong and distant | A candidate for moving the agreement behind one seam |
| Weak and distant | Often acceptable when the contract is stable and explicit |
| Weak and local | Usually low-value unless repeated friction says otherwise |

Distance is qualitative. State whether the participants are in the same expression, module, subsystem, repository, deployment, or team when that distinction affects change. Do not convert those descriptions into invented numeric precision.

## Establish evidence

1. Identify every participant that must agree.
2. Cite the source location or runtime behavior that establishes the agreement.
3. Trace what a representative change would require elsewhere.
4. Separate mechanical dependency from semantic agreement. Co-change history or a static edge can nominate the relationship, but neither proves why it exists.
5. Ask whether the agreement is contained by one coherent secret. If it spans unrelated responsibilities, splitting may improve cohesion more than merging.

A candidate statement should read like this:

> Order intake and retry scheduling both encode the payment-attempt transition order. The agreement crosses two subsystems and three callers. Move the transition behind the Order module's seam so callers request the outcome without reproducing the sequence.

If the agreement cannot be named this concretely, keep investigating or lower the recommendation strength.
