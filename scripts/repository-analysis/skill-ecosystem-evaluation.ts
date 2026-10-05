import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { writeJsonEvidence } from "./evidence.ts";

export type ActivationBaseline =
  | "full-ecosystem"
  | "isolated-skill"
  | "no-skill";

export type ActivationCase = {
  category: string;
  expected_skills: string[];
  expectations?: { activation_order?: string[] };
  forbidden_skills?: string[];
  id: string;
  metadata?: Record<string, unknown>;
  prompt: string;
};

export type ActivationCorpus = {
  cases: ActivationCase[];
  repository?: string | null;
  version: string;
};

export type ActivationObservation = {
  activation_order: string[];
  baseline: ActivationBaseline;
  case_id: string;
  selected_skills: string[];
};

export type ActivationObservations = {
  adapter: string;
  evidence_class: "FIXTURE" | "RUNTIME-OBSERVED";
  host: string;
  isolated_skill: string;
  model: string;
  runs: ActivationObservation[];
  version: string;
};

const BASELINES: ActivationBaseline[] = [
  "full-ecosystem",
  "isolated-skill",
  "no-skill",
];

const expectedForBaseline = (
  item: ActivationCase,
  baseline: ActivationBaseline,
  isolatedSkill: string,
) => {
  if (baseline === "no-skill") return [];
  if (baseline === "isolated-skill") {
    return item.expected_skills.filter((skill) => skill === isolatedSkill);
  }
  return item.expected_skills;
};

const sameOrder = (left: string[], right: string[]) =>
  left.length === right.length &&
  left.every((value, index) => value === right[index]);

export const evaluateSkillActivation = (
  corpus: ActivationCorpus,
  observations: ActivationObservations,
) => {
  const casesById = new Map(corpus.cases.map((item) => [item.id, item]));
  if (casesById.size !== corpus.cases.length) {
    throw new Error("Evaluation corpus case IDs must be unique.");
  }
  const runs = new Map<string, ActivationObservation>();
  for (const observation of observations.runs) {
    if (!casesById.has(observation.case_id)) {
      throw new Error(`Observation refers to unknown case ${observation.case_id}.`);
    }
    const key = `${observation.case_id}:${observation.baseline}`;
    if (runs.has(key)) throw new Error(`Duplicate observation ${key}.`);
    runs.set(key, observation);
  }

  const baselines = Object.fromEntries(
    BASELINES.map((baseline) => {
      let activationOrderMatches = 0;
      let activationOrderMeasured = 0;
      let exactMatches = 0;
      let falseNegativeSelections = 0;
      let falsePositiveSelections = 0;
      let selectedSkills = 0;
      let truePositiveSelections = 0;

      for (const item of corpus.cases) {
        const observation = runs.get(`${item.id}:${baseline}`);
        if (!observation) {
          throw new Error(
            `Missing observation for ${item.id} at ${baseline} baseline.`,
          );
        }
        const expected = expectedForBaseline(
          item,
          baseline,
          observations.isolated_skill,
        );
        const selected = new Set(observation.selected_skills);
        const expectedSet = new Set(expected);
        selectedSkills += selected.size;
        truePositiveSelections += [...selected].filter((skill) =>
          expectedSet.has(skill),
        ).length;
        falsePositiveSelections += [...selected].filter(
          (skill) => !expectedSet.has(skill),
        ).length;
        falseNegativeSelections += [...expectedSet].filter(
          (skill) => !selected.has(skill),
        ).length;
        if (
          selected.size === expectedSet.size &&
          [...selected].every((skill) => expectedSet.has(skill))
        ) {
          exactMatches += 1;
        }

        const declaredOrder = item.expectations?.activation_order;
        if (declaredOrder) {
          activationOrderMeasured += 1;
          const expectedOrder =
            baseline === "full-ecosystem"
              ? declaredOrder
              : baseline === "isolated-skill"
                ? declaredOrder.filter(
                    (skill) => skill === observations.isolated_skill,
                  )
                : [];
          if (sameOrder(observation.activation_order, expectedOrder)) {
            activationOrderMatches += 1;
          }
        }
      }

      const precisionDenominator =
        truePositiveSelections + falsePositiveSelections;
      const recallDenominator =
        truePositiveSelections + falseNegativeSelections;
      return [
        baseline,
        {
          activationOrderMatches:
            activationOrderMeasured === 0
              ? null
              : activationOrderMatches / activationOrderMeasured,
          cases: corpus.cases.length,
          exactMatchRate: exactMatches / corpus.cases.length,
          falseNegativeSelections,
          falsePositiveSelections,
          precision:
            precisionDenominator === 0
              ? 1
              : truePositiveSelections / precisionDenominator,
          recall:
            recallDenominator === 0
              ? 1
              : truePositiveSelections / recallDenominator,
          selectedSkills,
          truePositiveSelections,
        },
      ];
    }),
  ) as Record<ActivationBaseline, {
    activationOrderMatches: number | null;
    cases: number;
    exactMatchRate: number;
    falseNegativeSelections: number;
    falsePositiveSelections: number;
    precision: number;
    recall: number;
    selectedSkills: number;
    truePositiveSelections: number;
  }>;

  const coactivationCounts = new Map<string, number>();
  for (const observation of observations.runs.filter(
    ({ baseline }) => baseline === "full-ecosystem",
  )) {
    const selected = [...new Set(observation.selected_skills)].sort();
    for (let left = 0; left < selected.length; left += 1) {
      for (let right = left + 1; right < selected.length; right += 1) {
        const pair = `${selected[left]}\u0000${selected[right]}`;
        coactivationCounts.set(pair, (coactivationCounts.get(pair) ?? 0) + 1);
      }
    }
  }
  const coactivations = [...coactivationCounts.entries()]
    .map(([pair, count]) => ({ count, skills: pair.split("\u0000") }))
    .sort(
      (left, right) =>
        right.count - left.count ||
        left.skills.join("").localeCompare(right.skills.join("")),
    );

  return {
    adapter: observations.adapter,
    baselines,
    coactivations,
    evidenceClass: observations.evidence_class,
    host: observations.host,
    isolatedSkill: observations.isolated_skill,
    model: observations.model,
    version: "1",
  };
};

const argument = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

if (require.main === module) {
  const corpusPath = argument("--corpus");
  const observationsPath = argument("--observations");
  const outputPath = argument("--output");
  if (!corpusPath || !observationsPath || !outputPath) {
    console.error(
      "Usage: skill-ecosystem-evaluation.ts --corpus <path> --observations <path> --output <path>",
    );
    process.exitCode = 2;
  } else {
    try {
      const result = evaluateSkillActivation(
        JSON.parse(readFileSync(resolve(corpusPath), "utf8")) as ActivationCorpus,
        JSON.parse(
          readFileSync(resolve(observationsPath), "utf8"),
        ) as ActivationObservations,
      );
      writeJsonEvidence(outputPath, result);
      console.log(
        JSON.stringify({
          baselines: Object.keys(result.baselines),
          evidenceClass: result.evidenceClass,
          outputPath: resolve(outputPath),
        }),
      );
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
