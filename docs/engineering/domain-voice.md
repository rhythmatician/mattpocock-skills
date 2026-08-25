## What it does

`domain-voice` holds a design conversation at the domain level, in the product's language and plain words. It is not a session of its own: it is the discipline that runs underneath one, so an interview or planning conversation keeps arguing about what the actor does and observes instead of drifting into how the code will do it.

The defining constraint: it changes how questions are asked, never what is being decided. Every decision still belongs to you; the skill only governs the register the conversation happens in.

## When to reach for it

Type `/domain-voice`, or the [agent](https://www.aihero.dev/ai-coding-dictionary/agent) reaches for it on its own when implementation mechanics start crowding out product decisions, or when the person making the decisions thinks in product terms rather than code terms. You rarely type it: usually a skill you did type pulls it in.

| What you want | How domain-voice gets there |
| --- | --- |
| A grilling round drifting into code talk | `grilling` calls it mid-session; the rest of the interview stays at the domain level |
| A whole wayfinder map argued in product terms | Write its invocation line into the map's **Notes**; every ticket session inherits it |
| A full requirements-elicitation pass under the same discipline | [domain-architect-interrogator](https://aihero.dev/skills-domain-architect-interrogator), which runs on this skill |

## The three moves

**Redirect mechanics on sight.** When code mechanics enter the conversation, yours or theirs, acknowledge them in half a sentence, translate the mechanic into the domain question it serves, and ask that question. One line per redirect, no lecture; redirect again if they insist the mechanic matters, because the mechanic's *purpose* always has a domain-level shape.

**One concept, one name.** Adopt the project's ubiquitous language and enforce it: identical words in your questions and their answers, no aliases. When two names circulate for one concept, stop and force the choice, then keep a running glossary and use only glossary words from then on.

**Plain words.** A question lands on the first read or it wastes a round. Short sentences, active voice, concrete nouns, the word they used over the fancier synonym.

## Common questions

**How is this different from domain-modeling?**
Different layer. [domain-modeling](https://aihero.dev/skills-domain-modeling) builds and records the project's glossary in `CONTEXT.md` and ADRs; domain-voice enforces that vocabulary *live* in a conversation and redirects anything below the domain level. They compose well: a session held under domain-voice often produces terms worth recording via domain-modeling.

**How is this different from domain-architect-interrogator?**
Discipline versus procedure. The interrogator walks a fixed five-phase elicitation loop (goal, flow, boundaries, exceptions, contract); domain-voice is just the loop's conversational rules, extracted so any other skill can run under them. Use the interrogator when you want the full elicitation pass; use domain-voice when you want your existing grilling or wayfinder session to stop sinking into code talk.

**Does it stop technical decisions from being made at all?**
No. Technical decisions get named as decisions and routed out: the interrogator hands black-boxed mechanism choices to [grilling](https://aihero.dev/skills-grilling), which decides them with full technical depth. Domain-voice only refuses to let mechanism discussion masquerade as design discussion.

## It's working if

- Your technical asides come back as product questions, not code opinions.
- Names stop drifting: one concept keeps one word across the whole session.
- Questions are answerable without rereading them.

## Where it fits

A **vocabulary-layer primitive**, like [domain-modeling](https://aihero.dev/skills-domain-modeling): not a step you schedule but something other skills run underneath themselves. [grilling](https://aihero.dev/skills-grilling) pulls it in when rounds drift technical, [wayfinder](https://aihero.dev/skills-wayfinder) maps can pin it in their Notes, and [domain-architect-interrogator](https://aihero.dev/skills-domain-architect-interrogator) runs its whole elicitation loop on top of it. For the full map of the skills, see [ask-matt](https://aihero.dev/skills-ask-matt).
