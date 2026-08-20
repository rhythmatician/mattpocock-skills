# Host profiles

Read only the profiles required by the requested audit. Verify time-sensitive facts against the linked primary source and record the check date. Treat product issues and forum reports as `FIELD-REPORTED`, not host guarantees.

## Portable Agent Skills

Primary source: <https://agentskills.io/specification>

Facts carried forward from the source audit on 2026-08-03:

- A skill requires `SKILL.md`; `scripts/`, `references/`, and `assets/` are optional.
- `name` and `description` are required. `license`, `compatibility`, `metadata`, and experimental `allowed-tools` are portable optional fields.
- The full body loads after activation. Resources load on demand.
- Fewer than 5,000 body tokens and fewer than 500 main-file lines are recommendations.
- Keep file references one level deep from `SKILL.md`.

Portable semantics do not define host discovery, precedence, catalog budgets, implicit matching algorithms, or lifecycle behavior.

## Codex

Primary source: <https://developers.openai.com/codex/skills>

Facts carried forward from the source audit on 2026-08-03:

- The startup catalog contains name, description, and path.
- The catalog uses at most 2% of model context, or 8,000 characters when context is unknown.
- Codex shortens descriptions before omitting skills and may warn when skills are omitted.
- Explicit invocation uses `/skills` or `$skill`; implicit invocation is description-based.
- Repository discovery scans `.agents/skills` from the current directory to the repository root, plus user, admin, and system locations.
- Same-name skills are not merged.
- `agents/openai.yaml` supplies UI metadata, tool dependencies, and `policy.allow_implicit_invocation`; `false` preserves explicit invocation while disabling implicit selection.

The public documentation did not specify a Claude-Code-equivalent persistence or compaction lifecycle. Report it as `unknown` unless runtime evidence is supplied.

## Claude Code

Primary source: <https://code.claude.com/docs/en/skills>

Facts carried forward from the source audit on 2026-08-03:

- Invoked skill content stays in conversation context.
- Identical reinvocation adds a short already-loaded note; changed rendered content is appended again.
- Auto-compaction reattaches the most recent invocation of each skill, retaining the first 5,000 tokens per skill within a combined 25,000-token budget, newest first.
- Older skills can be dropped entirely after compaction.
- Tool preapproval is turn-scoped even though skill instructions remain in context.

Treat Claude-specific frontmatter and lifecycle behavior as host extensions, not portable guarantees.

## Cline

Primary source: <https://docs.cline.bot/customization/skills>

Facts carried forward from the source audit on 2026-08-03:

- Cline documents approximately 100 startup metadata tokens per skill.
- It loads full instructions through `use_skill` after description matching and supports explicit slash invocation.
- It documents an under-5,000-token instruction target.
- It recommends scripts for deterministic operations and states that script output, rather than script source, enters context.

## Cursor

Primary sources:

- <https://cursor.com/changelog/2-4>
- <https://cursor.com/docs/skills>

Facts carried forward from the source audit on 2026-08-03:

- Cursor supports dynamically selected Agent Skills and explicit slash invocation.
- Project discovery includes `.cursor/skills` and `.agents/skills` according to current documentation.

No authoritative public catalog budget, matcher threshold, or compaction lifecycle was established. Keep those values `unknown` and test actual visibility.

## Field-reported test cases

Use these only to seed regression tests:

- Codex invocation-sidecar drift: <https://github.com/mattpocock/skills/issues/516>
- Harness-specific instruction-file selection: <https://github.com/mattpocock/skills/issues/558>
- Cursor Remote SSH skill discovery failure: <https://forum.cursor.com/t/remote-ssh-to-windows-host-all-agent-skills-fail-to-load-including-built-in-create-skill-cursor-3-1-15-macos-windows/158377>
- Optional-frontmatter drift in a creator skill: <https://github.com/anthropics/skills/issues/249>

Confirm each report still applies to the selected version before treating it as reproduced behavior.
