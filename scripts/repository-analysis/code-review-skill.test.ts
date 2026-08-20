import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(path, "utf8");
const skill = read("skills/engineering/code-review/SKILL.md");
const docs = read("docs/engineering/code-review.md");

test("code-review defines three independent axes", () => {
  for (const axis of ["Standards", "Spec", "Health Regression"]) {
    assert.match(skill, new RegExp(`\\*\\*${axis}\\*\\*`));
    assert.match(docs, new RegExp(`\\*\\*${axis}\\*\\*`));
  }
  assert.match(skill, /parallel sub-agents.*separate contexts/);
  assert.doesNotMatch(skill, /Two-axis|two axes/);
});

test("health regression stays bounded and diff scoped", () => {
  assert.match(skill, /attributable to the diff/);
  assert.match(skill, /survey is not a default prerequisite/);
  assert.match(skill, /Detect the target ecosystem/);
  assert.match(skill, /Use `quick` depth/);
  assert.match(skill, /Do not install audit tools/);
  assert.match(skill, /whole-repository health orchestrator/);
  assert.match(skill, /Missing capabilities narrow the review/);
});

test("health evidence uses the shared substrate operationally", () => {
  assert.match(skill, /npm run maintenance-risk:survey/);
  assert.match(skill, /test-suite-health-survey\.ts/);
  assert.match(skill, /repository HEAD, dirty state, and state identity/);
  assert.match(skill, /Intersect findings with changed files first/);
  assert.match(skill, /partial failure/);
});

test("health findings carry evidence and proof status", () => {
  for (const field of [
    "Diff fact",
    "Repository evidence",
    "Interpretation",
    "Confidence/limitations",
    "Action",
    "key safety fact",
  ]) {
    assert.match(skill, new RegExp(field));
  }
  assert.match(skill, /assertion, source, failure-path, executed, or runtime/);
});

test("output keeps the axes separate without a health score", () => {
  assert.match(skill, /`## Standards`, `## Spec`, and `## Health Regression`/);
  assert.match(skill, /Do not calculate a health score/);
  assert.match(docs, /no numeric health score/);
});
