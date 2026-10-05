---
"mattpocock-skills": minor
---

Split `domain-architect-interrogator` in two. The portable half becomes `domain-voice`, a new model-invoked skill that holds any conversation at the domain level: the Scripter Trap redirect protocol, one-concept-one-name ubiquitous-language enforcement, and a plain-words register so questions land on the first read. The interrogator keeps its five-phase elicitation loop and now runs on `domain-voice` instead of carrying its own copy of the discipline.

`grilling` gains a lever: where the whole interview should be held at the domain level, it calls `domain-voice` before the first round instead of only warning about technical drift. `wayfinder` maps can pin the domain-level discipline in their Notes, so every ticket session inherits it automatically. Sessions that want `/wayfinder` or `/grilling` to stay less technical and easier to follow get it without leaving the flow.
