## What it does

`domain-architect-interrogator` runs a requirements-elicitation session where you play the **Domain Expert** and the [agent](https://www.aihero.dev/ai-coding-dictionary/agent) plays the **Senior Architect**. It walks a fixed loop: frame one sea-level goal, walk the main flow as player tasks, stress the operational boundaries with context-free questions, interrogate every exception, then play the design back as a black-box behavioral contract for you to confirm.

The defining constraint: the conversation is held strictly at the domain level. The session runs on [domain-voice](https://aihero.dev/skills-domain-voice), which redirects implementation mechanics on sight and enforces one concept one name; this skill supplies what that discipline does not, the phases themselves and when each is done.

## When to reach for it

You invoke this by typing `/domain-architect-interrogator`, and the agent won't reach for it on its own.

Reach for it when you are designing a feature or product and the conversation keeps collapsing into implementation talk, especially in domains whose vocabulary is not the codebase's: a game mod (gameplay mechanics, entity interactions, block states), an ML toolchain (datasets, experiments, model behavior), anything where the interesting decisions live above the execution layer. For sharpening an idea with no Scripter Trap problem, use [grill-with-docs](https://aihero.dev/skills-grill-with-docs) instead; it is stateful and leaves a paper trail, which this skill deliberately does not.

## The Scripter Trap

The skill's leading word is the **Scripter Trap**: the slide from product design into implementation mechanics (mixins, quality gates, schemas, graphing) that turns a design session into a code review. Deep programmers trigger it constantly, because technical vocabulary is their default register. The skill's answer is a redirect protocol: acknowledge the mechanic in half a sentence, translate it into the domain question it is serving, and ask that question. The mechanic's purpose always has a domain-level shape, and that shape is what the session exists to pin down.

## Common questions

**How is this different from grill-with-docs?**
Different problem. [grill-with-docs](https://aihero.dev/skills-grill-with-docs) resolves the branches of a plan or design tree and records what it learns in `CONTEXT.md` and ADRs. `domain-architect-interrogator` exists for one failure mode: a domain expert who out-codes the model, so the conversation keeps sinking into the execution layer. It saves nothing locally; its only artifact is the confirmed behavioral contract in the conversation.

**I want the domain-level discipline without the full elicitation loop.**
That is [domain-voice](https://aihero.dev/skills-domain-voice), the skill this one runs on. Grilling pulls it in when rounds drift technical, and wayfinder maps can pin it in their Notes. Reach for the interrogator only when you want the whole five-phase pass.

**What do I do with the design once the playback is confirmed?**
The skill ends by suggesting [to-spec](https://aihero.dev/skills-to-spec) to publish the contract as a spec, and offers to record the fixed glossary via [domain-modeling](https://aihero.dev/skills-domain-modeling). From there the main flow applies: spec, tickets, implement.

## It's working if

- Your technical asides come back as gameplay or product questions, not code opinions.
- A glossary of domain terms grows as the session runs, and the names stop drifting.
- The final playback reads like a player-facing behavior contract, with zero class, library, or framework names in it.

## Where it fits

A reach-for-it-anytime standalone. Its neighbours are [grill-with-docs](https://aihero.dev/skills-grill-with-docs), the stateful interview for design sharpening without the Scripter Trap problem, and [to-spec](https://aihero.dev/skills-to-spec), which the confirmed contract feeds. Technical decisions the session deliberately black-boxed are the exit ramp: hand them to [grilling](https://aihero.dev/skills-grilling), which decides them with full technical depth while keeping that depth on a leash. For the full map of the skills, see [ask-matt](https://aihero.dev/skills-ask-matt).
