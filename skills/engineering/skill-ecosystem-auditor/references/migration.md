# Canonical migration checklist

This port does not become canonical until its pull request merges. The source copy remains valid until then, so deprecating it earlier would leave users without a reviewed replacement.

## Post-merge action

Target repository: `rhythmatician/skills`

Exact discovery path to remove: `skill-tooling/skill-ecosystem-auditor/`

Canonical replacement: `rhythmatician/mattpocock-skills`, path `skills/engineering/skill-ecosystem-auditor/`

- [ ] Confirm the canonical pull request has merged and record its merge commit.
- [ ] Open a follow-up change in `rhythmatician/skills` that deletes the complete `skill-tooling/skill-ecosystem-auditor/` directory, including its `SKILL.md`, `agents/`, `assets/`, `references/`, `scripts/`, and `tests/`.
- [ ] Update every catalog, README, installer, and internal link in `rhythmatician/skills` that names the deleted path so it points to the canonical repository instead.
- [ ] Search the old repository for `skill-ecosystem-auditor`, `inventory_skills.py`, and `validate_references.py`; resolve every remaining discoverable or executable reference.
- [ ] Verify the old repository exposes no `SKILL.md` named `skill-ecosystem-auditor` in any host discovery root.
- [ ] Link the old-repository cleanup change from the canonical issue and mark the migration complete only after both default branches satisfy the no-duplicate check.

Do not leave a compatibility `SKILL.md` at the old path. A discoverable tombstone would preserve the duplicate name and continue competing in host catalogs. If historical context is needed, keep it outside skill discovery roots.
