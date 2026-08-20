---
"mattpocock-skills": minor
---

Add `domain-architect-interrogator`: a user-invoked requirements-elicitation session where the user plays domain expert and the agent plays senior architect. It holds the conversation strictly at the domain level (sea-level goals, ubiquitous language, context-free boundary stress tests, exception interrogation) and redirects implementation mechanics on sight, closing the "Scripter Trap" where a deeply technical domain expert pulls the model into code talk. Ends with a black-box behavioral contract that feeds `/to-spec`.

Also add a technical-depth guardrail to `grilling`: frontier questions may be technical, but depth must serve the current decision rather than spawn implementation sub-branches, and recommendations are stated as accept/reject decisions instead of topics to explore. Every consumer of the primitive (`grill-with-docs`, `wayfinder`, `triage`, `improve-codebase-architecture`) inherits the guardrail, so interview rounds stop drifting one level more technical than the last.
