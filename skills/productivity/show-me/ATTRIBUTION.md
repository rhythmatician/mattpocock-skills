# Attribution

Imported from [HumanLayer skills](https://github.com/humanlayer/skills/tree/653b6411c1f70c275a18e37673b042ff99f67ceb/plugins/show-me), commit `653b6411c1f70c275a18e37673b042ff99f67ceb`.

The upstream skill is credited to Dex Horthy / HumanLayer. Copyright (c) 2026 HumanLayer. Distributed under the MIT license; the complete upstream notice is preserved in [LICENSE](LICENSE).

Source files:

- `plugins/show-me/skills/show-me/SKILL.md`
- `plugins/show-me/skills/show-me/agents/openai.yaml`
- Repository-root `LICENSE`

Local adaptations:

- Replaced the macOS-specific `Bash(open ...)` HTML-opening instruction with available host preview tools, including Codex `open_in_codex` with an absolute file path. The same paragraph uses a colon to follow the repository's prose convention.
- Added Codex picker display name and short description above the unchanged explicit-only invocation policy.
- Relocated the skill into `skills/productivity/show-me` and registered it in the repository's catalog, router, plugin, ecosystem metadata, docs, and changeset.

All other skill behavior and both user-only invocation settings are unchanged. The skill body does not automatically invoke another skill.
