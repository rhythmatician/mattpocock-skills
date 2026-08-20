import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(path, "utf8");
const skill = read("skills/engineering/codebase-health/SKILL.md");
const metadata = read("skills/engineering/codebase-health/agents/openai.yaml");
const docs = read("docs/engineering/codebase-health.md");

test("codebase-health is user invoked in both harnesses", () => {
  assert.match(skill, /disable-model-invocation: true/);
  assert.match(metadata, /allow_implicit_invocation: false/);
  assert.match(docs, /typing `\/codebase-health`/);
});

test("codebase-health dispatches five isolated perspectives", () => {
  for (const lens of [
    "maintenance-risk",
    "improve-codebase-architecture",
    "test-suite-health",
    "knowledge-hygiene",
    "feedback-loop-health",
  ]) {
    assert.match(skill, new RegExp("- `" + lens + "`"));
  }
  assert.match(skill, /Dispatch all five in parallel/);
  assert.match(skill, /without forwarding sibling conclusions/);
  assert.match(skill, /same intent, depth, snapshot/);
});

test("codebase-health normalizes evidence before synthesis", () => {
  for (const field of [
    '"category"',
    '"locations"',
    '"evidence"',
    '"interpretation"',
    '"confidence"',
    '"limitations"',
    '"nextAction"',
    '"artifactRefs"',
  ]) {
    assert.match(skill, new RegExp(field));
  }
  assert.match(skill, /not prose for the lead to scrape/);
  assert.match(skill, /Never calculate a health score/);
});

test("codebase-health applies bounded lead judgment and safe handoffs", () => {
  for (const category of ["Prioritize", "Investigate", "Watch", "Clear"]) {
    assert.match(skill, new RegExp(`\\*\\*${category}\\*\\*`));
  }
  assert.match(skill, /quick.*standard.*deep/s);
  assert.match(skill, /Never invoke it automatically/);
  assert.match(skill, /does not repair the repository/);
});
