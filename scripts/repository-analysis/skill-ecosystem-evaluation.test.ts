import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  evaluateSkillActivation,
  type ActivationCorpus,
  type ActivationObservations,
} from "./skill-ecosystem-evaluation.ts";

const auditorAssets = join(
  process.cwd(),
  "skills",
  "engineering",
  "skill-ecosystem-auditor",
  "assets",
);

test("compares full, isolated, and no-skill activation observations", () => {
  const corpus = JSON.parse(
    readFileSync(join(auditorAssets, "eval-corpus.json"), "utf8"),
  ) as ActivationCorpus;
  const observations = JSON.parse(
    readFileSync(join(auditorAssets, "eval-observations.fixture.json"), "utf8"),
  ) as ActivationObservations;

  const result = evaluateSkillActivation(corpus, observations);

  assert.deepEqual(Object.keys(result.baselines).sort(), [
    "full-ecosystem",
    "isolated-skill",
    "no-skill",
  ]);
  assert.equal(result.baselines["full-ecosystem"].cases, corpus.cases.length);
  assert.equal(result.baselines["full-ecosystem"].precision, 1);
  assert.equal(result.baselines["full-ecosystem"].recall, 1);
  assert.equal(result.baselines["full-ecosystem"].activationOrderMatches, 1);
  assert.equal(result.baselines["isolated-skill"].falsePositiveSelections, 0);
  assert.equal(result.baselines["no-skill"].selectedSkills, 0);
  assert.deepEqual(result.coactivations, [
    {
      count: 1,
      skills: ["skill-ecosystem-auditor", "writing-for-agents"],
    },
  ]);
  assert.equal(
    corpus.cases.some(
      ({ metadata }) =>
        metadata?.fixture ===
        "scripts/repository-analysis/fixtures/cooperating-skill-ecosystem",
    ),
    true,
  );
});

test("evaluation rejects a missing baseline observation", () => {
  const corpus: ActivationCorpus = {
    version: "1",
    cases: [
      {
        category: "positive",
        expected_skills: ["skill-ecosystem-auditor"],
        id: "one",
        prompt: "Audit this skill ecosystem",
      },
    ],
  };
  const observations: ActivationObservations = {
    adapter: "fixture",
    evidence_class: "FIXTURE",
    host: "fixture",
    isolated_skill: "skill-ecosystem-auditor",
    model: "fixture",
    runs: [],
    version: "1",
  };

  assert.throws(
    () => evaluateSkillActivation(corpus, observations),
    /missing observation.*full-ecosystem/i,
  );
});
