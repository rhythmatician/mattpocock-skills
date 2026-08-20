import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  parseFeedbackLoopPlan,
  runFeedbackLoopPlan,
} from "./feedback-loop-health-run.ts";

const machineStage = (overrides: Record<string, unknown> = {}) => ({
  agentWait: "blocked",
  availability: "available",
  command: {
    args: ["-e", "process.stdout.write('ready')"],
    executable: process.execPath,
  },
  condition: "cold-clean",
  environment: "local",
  id: "launch",
  latency: "machine",
  lifecycle: "launch",
  repeatCount: 2,
  signal: "first-signal",
  timeoutMs: 2_000,
  ...overrides,
});

const plan = (repositoryPath: string) => {
  const evidenceDirectory = mkdtempSync(join(tmpdir(), "feedback-loop-evidence-"));
  const evidencePath = join(evidenceDirectory, "scenario.json");
  writeFileSync(evidencePath, "{}\n");
  return {
    evidencePaths: [evidencePath],
    schemaVersion: 1,
    repositoryPath,
    scenarios: [
      {
      baseline: true,
      description: "Edit a component and obtain a reviewable state",
      grounding: {
        drive: "Use the existing browser scenario",
        isolate: "Use a disposable profile",
        observe: "Capture a screenshot",
        run: "Use the repository dev command",
        surface: "Web UI",
      },
      hitlRequired: true,
      id: "component-change",
      lifecycleApplicability: {
        cleanup: "required",
        doctor: "required",
        drive: "required",
        evidence: "required",
        launch: "required",
      },
      stages: [
        machineStage(),
        machineStage({
          condition: "warm-incremental",
          id: "test",
          lifecycle: "drive",
          finding: {
            classification: "serial",
            owner: "feedback-loop-health",
            regressionRatchetOpportunity: "Add a budget around the focused test path",
            smallestImprovement: "Run the focused test independently of the full build",
            whyItMatters: "This stage blocks the first adequate confidence signal",
          },
          signal: "automated-confidence",
        }),
        {
          availability: "available",
          condition: "warm-incremental",
          id: "review-setup",
          latency: "manual",
          lifecycle: "doctor",
          manual: {
            durationMs: 1_500,
            evidence: "Reviewer opened the changed screen",
          },
          signal: "hitl-setup",
        },
        {
          availability: "unavailable",
          condition: "warm-incremental",
          id: "visual-verdict",
          latency: "manual",
          lifecycle: "evidence",
          reason: "No reviewer was present for this run",
          signal: "hitl-verdict",
        },
        machineStage({
          condition: "warm-incremental",
          id: "cleanup",
          lifecycle: "cleanup",
          repeatCount: 1,
          signal: "human-observable-state",
        }),
      ],
      },
    ],
  };
};

test("requires a baseline before optimization evidence", () => {
  const repositoryPath = mkdtempSync(join(tmpdir(), "feedback-loop-run-"));
  const input = plan(repositoryPath);
  input.scenarios[0]!.baseline = false;

  assert.throws(() => parseFeedbackLoopPlan(input), /baseline/i);
});

test("rejects destructive cache-clearing commands", () => {
  const repositoryPath = mkdtempSync(join(tmpdir(), "feedback-loop-run-"));
  const input = plan(repositoryPath);
  input.scenarios[0]!.stages[0] = machineStage({
    command: { args: ["-rf", ".cache"], executable: "rm" },
  });

  assert.throws(() => parseFeedbackLoopPlan(input), /destructive cache clearing/i);
});

test("requires an explicit verdict for an available HITL verdict stage", () => {
  const repositoryPath = mkdtempSync(join(tmpdir(), "feedback-loop-run-"));
  const input = plan(repositoryPath);
  input.scenarios[0]!.stages[3] = {
    availability: "available",
    condition: "warm-incremental",
    id: "visual-verdict",
    latency: "manual",
    lifecycle: "evidence",
    manual: {
      durationMs: 2_000,
      evidence: "Reviewer inspected the changed screen",
    },
    signal: "hitl-verdict",
  };

  assert.throws(() => parseFeedbackLoopPlan(input), /verdict/i);
});

test("normalizes machine and manual latency, conditions, and unavailable stages", async () => {
  const repositoryPath = mkdtempSync(join(tmpdir(), "feedback-loop-run-"));
  const input = plan(repositoryPath);
  const result = await runFeedbackLoopPlan(input);

  assert.equal(result.schemaVersion, 1);
  assert.equal(result.diagnostic, "feedback-loop-health");
  assert.equal(result.status, "partial");
  assert.equal(result.scenarios[0]?.baseline, true);
  assert.equal(result.scenarios[0]?.latency.machineMs > 0, true);
  assert.equal(result.scenarios[0]?.latency.manualMs, 1_500);
  assert.equal(result.scenarios[0]?.latency.agentIdleMs > 0, true);
  assert.equal(result.scenarios[0]?.conditions["cold-clean"].sampleCount, 2);
  assert.equal(result.scenarios[0]?.conditions["warm-incremental"].sampleCount, 3);
  assert.equal(result.scenarios[0]?.environments.local.sampleCount, 5);
  assert.equal(result.scenarios[0]?.milestones["first-signal"].status, "passed");
  assert.equal(result.scenarios[0]?.milestones["automated-confidence"].status, "passed");
  assert.equal(result.scenarios[0]?.milestones["hitl-setup"].manualDurationMs, 1_500);
  assert.equal(result.scenarios[0]?.milestones["hitl-verdict"].status, "unavailable");
  assert.equal(result.scenarios[0]?.stages.at(-1)?.lifecycle, "cleanup");
  assert.equal(result.findings[0]?.classification, "serial");
  assert.equal(result.findings[0]?.claimType, "interpretation");
  assert.equal(result.findings[0]?.measurement.sampleCount, 2);
  assert.equal(result.findings[0]?.provenance[0]?.kind, "executed-command");
  assert.equal(result.findings[0]?.smallestImprovement, "Run the focused test independently of the full build");
  assert.equal(result.unavailableStages.some(({ stageId }) => stageId === "visual-verdict"), true);
  assert.equal(result.confidenceBoundaries.some((boundary) => /HITL verdict/i.test(boundary)), true);
  assert.equal(result.cleanup.status, "complete");
  assert.deepEqual(result.cleanup.evidencePaths, input.evidencePaths);
});

test("a HITL scenario is partial when required feedback milestones are absent", async () => {
  const repositoryPath = mkdtempSync(join(tmpdir(), "feedback-loop-run-"));
  const input = plan(repositoryPath);
  input.scenarios[0]!.hitlRequired = true;
  input.scenarios[0]!.lifecycleApplicability = {
    cleanup: "not-required",
    doctor: "not-required",
    drive: "required",
    evidence: "not-required",
    launch: "not-required",
  };
  input.scenarios[0]!.stages = [
    machineStage({
      condition: "cold-clean",
      id: "cold-test",
      lifecycle: "drive",
      repeatCount: 1,
      signal: "automated-confidence",
    }),
    machineStage({
      condition: "warm-incremental",
      id: "warm-test",
      lifecycle: "drive",
      repeatCount: 1,
      signal: "first-signal",
    }),
  ];

  const result = await runFeedbackLoopPlan(input);

  assert.equal(result.status, "partial");
  assert.equal(result.scenarios[0]?.status, "partial");
  assert.equal(result.unavailableStages.some(({ stageId }) => stageId === "human-observable-state"), true);
  assert.equal(result.unavailableStages.some(({ stageId }) => stageId === "hitl-setup"), true);
  assert.equal(result.unavailableStages.some(({ stageId }) => stageId === "hitl-verdict"), true);
});

test("reports required lifecycle stages that the plan did not provide", async () => {
  const repositoryPath = mkdtempSync(join(tmpdir(), "feedback-loop-run-"));
  const input = plan(repositoryPath);
  input.scenarios[0]!.hitlRequired = false;
  input.scenarios[0]!.stages = input.scenarios[0]!.stages.filter(
    ({ lifecycle }) => lifecycle !== "doctor",
  );

  const result = await runFeedbackLoopPlan(input);

  assert.equal(result.scenarios[0]?.lifecycleReadiness.doctor.status, "unavailable");
  assert.equal(result.scenarios[0]?.status, "partial");
  assert.equal(result.unavailableStages.some(({ stageId }) => stageId === "lifecycle:doctor"), true);
});

test("reports a missing cold or warm comparison instead of completing silently", async () => {
  const repositoryPath = mkdtempSync(join(tmpdir(), "feedback-loop-run-"));
  const input = plan(repositoryPath);
  input.scenarios[0]!.hitlRequired = false;
  input.scenarios[0]!.lifecycleApplicability = {
    cleanup: "not-required",
    doctor: "not-required",
    drive: "required",
    evidence: "not-required",
    launch: "not-required",
  };
  input.scenarios[0]!.stages = [
    machineStage({
      condition: "warm-incremental",
      id: "warm-only",
      lifecycle: "drive",
      repeatCount: 1,
      signal: "first-signal",
    }),
  ];

  const result = await runFeedbackLoopPlan(input);

  assert.equal(result.scenarios[0]?.comparison.status, "partial");
  assert.deepEqual(result.scenarios[0]?.comparison.unavailableConditions, ["cold-clean"]);
  assert.equal(result.scenarios[0]?.status, "partial");
  assert.equal(result.unavailableStages.some(({ stageId }) => stageId === "condition:cold-clean"), true);
  assert.deepEqual(result.findings, []);
});

test("does not rank a non-baseline finding without measured baseline support", async () => {
  const repositoryPath = mkdtempSync(join(tmpdir(), "feedback-loop-run-"));
  const input = plan(repositoryPath);
  const baseline = input.scenarios[0]!;
  baseline.hitlRequired = false;
  baseline.lifecycleApplicability = {
    cleanup: "not-required",
    doctor: "not-required",
    drive: "required",
    evidence: "not-required",
    launch: "not-required",
  };
  baseline.stages = [
    machineStage({
      condition: "cold-clean",
      id: "baseline-cold",
      lifecycle: "drive",
      repeatCount: 1,
      signal: "automated-confidence",
    }),
    machineStage({
      condition: "warm-incremental",
      id: "baseline-warm",
      lifecycle: "drive",
      repeatCount: 1,
      signal: "first-signal",
    }),
  ];
  const optimization = structuredClone(baseline);
  optimization.baseline = false;
  optimization.id = "optimization-attempt";
  optimization.stages[1] = machineStage({
    condition: "warm-incremental",
    finding: {
      classification: "serial",
      owner: "feedback-loop-health",
      regressionRatchetOpportunity: "Add a focused-path budget",
      smallestImprovement: "Separate the focused path",
      whyItMatters: "This stage blocks adequate confidence",
    },
    id: "optimized-warm",
    lifecycle: "drive",
    repeatCount: 1,
    signal: "first-signal",
  });
  input.scenarios.push(optimization);

  const result = await runFeedbackLoopPlan(input);

  assert.equal(result.scenarios[0]?.status, "complete");
  assert.equal(result.scenarios[1]?.status, "partial");
  assert.deepEqual(result.findings, []);
  assert.equal(
    result.unavailableStages.some(
      ({ scenarioId, stageId }) =>
        scenarioId === "optimization-attempt" &&
        stageId === "finding:optimized-warm",
    ),
    true,
  );
  assert.equal(
    result.confidenceBoundaries.some((boundary) =>
      /measured baseline finding/i.test(boundary),
    ),
    true,
  );
});

test("emits a non-baseline finding linked to measured baseline evidence", async () => {
  const repositoryPath = mkdtempSync(join(tmpdir(), "feedback-loop-run-"));
  const input = plan(repositoryPath);
  const optimization = structuredClone(input.scenarios[0]!);
  optimization.baseline = false;
  optimization.id = "supported-optimization";
  optimization.stages[1] = machineStage({
    condition: "warm-incremental",
    finding: {
      baselineFindingId: "component-change:test",
      classification: "serial",
      owner: "feedback-loop-health",
      regressionRatchetOpportunity: "Keep the focused-path budget",
      smallestImprovement: "Keep the independent focused path",
      whyItMatters: "This comparison measures the same blocking stage",
    },
    id: "supported-warm",
    lifecycle: "drive",
    repeatCount: 1,
    signal: "automated-confidence",
  });
  input.scenarios.push(optimization);

  const result = await runFeedbackLoopPlan(input);

  const finding = result.findings.find(
    ({ id }) => id === "supported-optimization:supported-warm",
  );
  assert.equal(finding?.baselineFindingId, "component-change:test");
  assert.equal(finding?.rank > 0, true);
});

test("cleanup proof excludes missing and in-repository evidence paths", async () => {
  const repositoryPath = mkdtempSync(join(tmpdir(), "feedback-loop-run-"));
  const inRepositoryEvidence = join(repositoryPath, "evidence.json");
  const missingEvidence = join(
    mkdtempSync(join(tmpdir(), "feedback-loop-missing-")),
    "missing.json",
  );
  writeFileSync(inRepositoryEvidence, "{}\n");
  const input = plan(repositoryPath);
  input.evidencePaths = [inRepositoryEvidence, missingEvidence];

  const result = await runFeedbackLoopPlan(input);

  assert.equal(result.cleanup.status, "partial");
  assert.deepEqual(result.cleanup.evidencePaths, []);
  assert.equal(result.cleanup.unavailableEvidencePaths.length, 2);
  assert.equal(
    result.cleanup.unavailableEvidencePaths.some(({ reason }) =>
      /outside the target repository/i.test(reason),
    ),
    true,
  );
  assert.equal(
    result.cleanup.unavailableEvidencePaths.some(({ reason }) =>
      /does not exist/i.test(reason),
    ),
    true,
  );
});

test("cleanup proof rejects relative paths and directories", async () => {
  const repositoryPath = mkdtempSync(join(tmpdir(), "feedback-loop-run-"));
  const evidenceDirectory = mkdtempSync(
    join(tmpdir(), "feedback-loop-directory-"),
  );
  const input = plan(repositoryPath);
  input.evidencePaths = ["..", evidenceDirectory];

  const result = await runFeedbackLoopPlan(input);

  assert.equal(result.cleanup.status, "partial");
  assert.equal(result.status, "partial");
  assert.deepEqual(result.cleanup.evidencePaths, []);
  assert.equal(result.cleanup.unavailableEvidencePaths.length, 2);
  assert.equal(
    result.cleanup.unavailableEvidencePaths.some(({ reason }) =>
      /absolute artifact file path/i.test(reason),
    ),
    true,
  );
  assert.equal(
    result.cleanup.unavailableEvidencePaths.some(({ reason }) =>
      /must be a file/i.test(reason),
    ),
    true,
  );
  assert.equal(
    result.unavailableStages.filter(
      ({ scenarioId }) => scenarioId === "report",
    ).length,
    2,
  );
  assert.equal(
    result.confidenceBoundaries.some((boundary) =>
      /absolute artifact file path/i.test(boundary),
    ),
    true,
  );
});

test("runs cleanup after a failed drive and preserves the failed stage", async () => {
  const repositoryPath = mkdtempSync(join(tmpdir(), "feedback-loop-run-"));
  const cleanupMarker = join(repositoryPath, "cleanup-ran");
  const input = plan(repositoryPath);
  input.scenarios[0]!.stages = [
    machineStage({ repeatCount: 1 }),
    machineStage({
      command: { args: ["-e", "process.exit(7)"], executable: process.execPath },
      condition: "warm-incremental",
      id: "drive",
      lifecycle: "drive",
      repeatCount: 1,
      signal: "automated-confidence",
    }),
    machineStage({
      command: {
        args: ["-e", `require('fs').writeFileSync(${JSON.stringify(cleanupMarker)}, 'yes')`],
        executable: process.execPath,
      },
      condition: "warm-incremental",
      id: "cleanup",
      lifecycle: "cleanup",
      repeatCount: 1,
      signal: "human-observable-state",
    }),
  ];
  input.scenarios[0]!.hitlRequired = false;
  input.scenarios[0]!.lifecycleApplicability = {
    cleanup: "required",
    doctor: "not-required",
    drive: "required",
    evidence: "not-required",
    launch: "required",
  };

  const result = await runFeedbackLoopPlan(input);

  assert.equal(result.status, "partial");
  assert.equal(result.scenarios[0]?.stages[1]?.status, "failed");
  assert.equal(readFileSync(cleanupMarker, "utf8"), "yes");
});

test("runner CLI writes evidence and returns a compact receipt", () => {
  const repositoryPath = mkdtempSync(join(tmpdir(), "feedback-loop-run-"));
  const workspacePath = mkdtempSync(join(tmpdir(), "feedback-loop-plan-"));
  const planPath = join(workspacePath, "plan.json");
  const outputPath = join(workspacePath, "results.json");
  writeFileSync(planPath, JSON.stringify(plan(repositoryPath)));
  const scriptPath = join(process.cwd(), "scripts", "repository-analysis", "feedback-loop-health-run.ts");
  const processResult = spawnSync(
    process.execPath,
    ["--import", "tsx", scriptPath, "--plan", planPath, "--output", outputPath],
    { encoding: "utf8" },
  );
  const stdout = processResult.stdout;
  const receipt = JSON.parse(stdout) as Record<string, unknown>;

  assert.equal(processResult.status, 2);
  assert.equal(receipt.status, "partial");
  assert.equal(receipt.outputPath, outputPath);
  assert.equal("scenarios" in receipt, false);
  assert.equal(JSON.parse(readFileSync(outputPath, "utf8")).diagnostic, "feedback-loop-health");
});
