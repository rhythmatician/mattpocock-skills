## What it does

Show-me explains the current topic visually, choosing the smallest view that makes the point clear. It keeps prose brief and includes only the calls, files, states, or boundaries needed to answer your question.

## When to reach for it

You invoke this by typing `/show-me`, and the agent won't reach for it on its own. Use it when a conversation about structure, control flow, a change, or a UI would be easier to follow as a visual.

For an explanation that needs different words or more context, use [wait-what](https://aihero.dev/skills-wait-what).

## The smallest useful view

The output follows the question:

- Logic becomes pseudocode; runtime flow becomes a call tree.
- UI structure becomes a component tree; file responsibilities become a shallow file tree.
- Interactions become a Mermaid diagram; changes become a focused diff.
- A dense concept or layout comparison becomes one HTML artifact, opened with the host's available preview tools.

The visual stays next to the short explanation it supports. A whole code block is appropriate when you need a copyable example or omitted context would hide ownership or order.

## Common questions

**Does it always generate HTML?**

No. HTML is for UI, layout, state comparisons, or concepts too dense for Mermaid. A small text sketch often answers the question.

**Can another skill invoke it automatically?**

No. Both Claude Code and Codex require you to invoke it explicitly.

## It's working if

- You can trace the relevant flow or change without reading unrelated details.
- The visual uses labels and data from the topic you are discussing.
- An HTML artifact opens in a preview and works at desktop and mobile sizes.

## Where it fits

Show-me is a reach-for-it-anytime standalone. It explains a topic visually; [pr](https://aihero.dev/skills-pr) shapes a pull request body, while [wait-what](https://aihero.dev/skills-wait-what) re-pitches an explanation. See [ask-matt](https://aihero.dev/skills-ask-matt) for the full map.
