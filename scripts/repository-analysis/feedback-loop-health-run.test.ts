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

const plan = (repositoryPath: string) => ({
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
      stages: [
        machineStage(),
        machineStage({
          condition: "warm-incremental",
          id: "test",
          lifecycle: "drive",
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
});

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
  const result = await runFeedbackLoopPlan(plan(repositoryPath));

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
