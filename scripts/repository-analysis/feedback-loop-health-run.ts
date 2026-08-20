import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { performance } from "node:perf_hooks";

import { isPathInsideRepository, writeJsonEvidence } from "./evidence.ts";
import { runGit } from "./git.ts";
import { ProcessExecutionError, runProcess } from "./process.ts";
import { readRepositoryState } from "./repository-state.ts";

type Condition = "cold-clean" | "warm-incremental";
type Latency = "machine" | "manual";
type Lifecycle = "cleanup" | "doctor" | "drive" | "evidence" | "launch";
type Signal =
  | "automated-confidence"
  | "first-signal"
  | "hitl-setup"
  | "hitl-verdict"
  | "human-observable-state";
type Availability = "available" | "partial" | "unavailable";

type Command = {
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  executable: string;
};

type Stage = {
  agentWait: "blocked" | "concurrent" | "unknown";
  availability: Availability;
  command?: Command;
  condition: Condition;
  environment: "ci" | "local" | "other";
  id: string;
  latency: Latency;
  lifecycle: Lifecycle;
  manual?: {
    durationMs: number;
    evidence: string;
    verdict?: "accepted" | "rejected" | "inconclusive";
  };
  reason?: string;
  repeatCount?: number;
  signal: Signal;
  timeoutMs?: number;
};

type Scenario = {
  baseline: boolean;
  description: string;
  grounding: Record<"drive" | "isolate" | "observe" | "run" | "surface", string>;
  hitlRequired: boolean;
  id: string;
  regressionRatchetOpportunities?: string[];
  stages: Stage[];
};

export type FeedbackLoopPlan = {
  repositoryPath: string;
  scenarios: Scenario[];
  schemaVersion: 1;
};

type StageStatus = "failed" | "partial" | "passed" | "skipped" | "unavailable";

type StageResult = {
  agentWait: Stage["agentWait"];
  availability: Availability;
  condition: Condition;
  environment: Stage["environment"];
  id: string;
  lifecycle: Lifecycle;
  machineDurationMs: number;
  manualDurationMs: number;
  provenance: {
    command?: Command & { repeatCount: number; timeoutMs: number };
    manual?: { evidence: string; verdict?: "accepted" | "rejected" | "inconclusive" };
  };
  reason?: string;
  runs: Array<{
    durationMs: number;
    exitCode: number | null;
    status: "failed" | "passed";
    stderr: string;
    stdout: string;
  }>;
  signal: Signal;
  status: StageStatus;
};

export type FeedbackLoopHealthRun = {
  diagnostic: "feedback-loop-health";
  failures: Array<{ capability: "repository-state"; message: string }>;
  generatedAt: string;
  repository: { dirty: boolean; head: string; root: string; stateId: string };
  scenarios: Array<{
    baseline: boolean;
    bottlenecks: Array<{
      durationMs: number;
      latency: Latency;
      stageId: string;
    }>;
    conditions: Record<Condition, { machineMs: number; manualMs: number; sampleCount: number }>;
    description: string;
    grounding: Scenario["grounding"];
    hitlRequired: boolean;
    id: string;
    environments: Record<Stage["environment"], { machineMs: number; manualMs: number; sampleCount: number }>;
    latency: { agentIdleMs: number; machineMs: number; manualMs: number; totalMs: number };
    milestones: Record<Signal, {
      machineDurationMs: number;
      manualDurationMs: number;
      status: StageStatus;
    }>;
    regressionRatchetOpportunities: string[];
    stages: StageResult[];
    status: "complete" | "partial";
  }>;
  schemaVersion: 1;
  status: "complete" | "partial";
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requireString = (value: unknown, path: string) => {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${path} must be a non-empty string`);
  return value;
};

const oneOf = <T extends string>(value: unknown, values: readonly T[], path: string): T => {
  if (typeof value !== "string" || !values.includes(value as T)) throw new Error(`${path} must be one of ${values.join(", ")}`);
  return value as T;
};

const assertSafeCommand = (command: Command) => {
  const executable = basename(command.executable).toLowerCase().replace(/\.exe$/, "");
  const argumentsText = command.args.join(" ").toLowerCase();
  const destructive =
    ["rm", "rmdir", "del", "shred"].includes(executable) ||
    (executable === "git" && command.args[0]?.toLowerCase() === "clean") ||
    ((executable === "powershell" || executable === "pwsh") && /remove-item/.test(argumentsText)) ||
    (executable === "cmd" && /(^|\s)(del|rmdir|rd)(\s|$)/.test(argumentsText));
  if (destructive) {
    throw new Error("Feedback-loop plans cannot use destructive cache clearing. Record the existing cold or clean condition without deleting caches.");
  }
};

const parseStage = (value: unknown, path: string): Stage => {
  if (!isRecord(value)) throw new Error(`${path} must be an object`);
  const availability = oneOf(value.availability, ["available", "partial", "unavailable"] as const, `${path}.availability`);
  const latency = oneOf(value.latency, ["machine", "manual"] as const, `${path}.latency`);
  const stage: Stage = {
    agentWait: value.agentWait === undefined ? "unknown" : oneOf(value.agentWait, ["blocked", "concurrent", "unknown"] as const, `${path}.agentWait`),
    availability,
    condition: oneOf(value.condition, ["cold-clean", "warm-incremental"] as const, `${path}.condition`),
    environment: value.environment === undefined ? "local" : oneOf(value.environment, ["local", "ci", "other"] as const, `${path}.environment`),
    id: requireString(value.id, `${path}.id`),
    latency,
    lifecycle: oneOf(value.lifecycle, ["launch", "doctor", "drive", "evidence", "cleanup"] as const, `${path}.lifecycle`),
    signal: oneOf(value.signal, ["first-signal", "automated-confidence", "human-observable-state", "hitl-setup", "hitl-verdict"] as const, `${path}.signal`),
  };
  if (availability !== "available") {
    stage.reason = requireString(value.reason, `${path}.reason`);
    return stage;
  }
  if (latency === "manual") {
    if (!isRecord(value.manual)) throw new Error(`${path}.manual is required for available manual stages`);
    if (typeof value.manual.durationMs !== "number" || value.manual.durationMs < 0) throw new Error(`${path}.manual.durationMs must be a non-negative number`);
    stage.manual = {
      durationMs: value.manual.durationMs,
      evidence: requireString(value.manual.evidence, `${path}.manual.evidence`),
      verdict: value.manual.verdict === undefined ? undefined : oneOf(value.manual.verdict, ["accepted", "rejected", "inconclusive"] as const, `${path}.manual.verdict`),
    };
    if (stage.signal === "hitl-verdict" && stage.manual.verdict === undefined) {
      throw new Error(`${path}.manual.verdict is required for an available HITL verdict stage`);
    }
    return stage;
  }
  if (!isRecord(value.command) || !Array.isArray(value.command.args) || !value.command.args.every((argument) => typeof argument === "string")) {
    throw new Error(`${path}.command with an argument array is required for available machine stages`);
  }
  const command: Command = {
    args: value.command.args,
    executable: requireString(value.command.executable, `${path}.command.executable`),
  };
  if (value.command.cwd !== undefined) command.cwd = requireString(value.command.cwd, `${path}.command.cwd`);
  if (value.command.env !== undefined) {
    if (!isRecord(value.command.env) || !Object.values(value.command.env).every((entry) => typeof entry === "string")) throw new Error(`${path}.command.env must contain strings`);
    command.env = value.command.env as Record<string, string>;
  }
  assertSafeCommand(command);
  stage.command = command;
  stage.repeatCount = value.repeatCount === undefined ? 1 : value.repeatCount as number;
  stage.timeoutMs = value.timeoutMs === undefined ? 30_000 : value.timeoutMs as number;
  if (!Number.isInteger(stage.repeatCount) || stage.repeatCount! < 1 || stage.repeatCount! > 50) throw new Error(`${path}.repeatCount must be an integer from 1 to 50`);
  if (!Number.isFinite(stage.timeoutMs) || stage.timeoutMs! < 1 || stage.timeoutMs! > 600_000) throw new Error(`${path}.timeoutMs must be from 1 to 600000`);
  return stage;
};

export const parseFeedbackLoopPlan = (value: unknown): FeedbackLoopPlan => {
  if (!isRecord(value) || value.schemaVersion !== 1) throw new Error("Feedback-loop plan schemaVersion must be 1");
  const repositoryPath = requireString(value.repositoryPath, "repositoryPath");
  if (!Array.isArray(value.scenarios) || value.scenarios.length === 0) throw new Error("Feedback-loop plan requires at least one scenario");
  const scenarios = value.scenarios.map((rawScenario, scenarioIndex): Scenario => {
    const path = `scenarios[${scenarioIndex}]`;
    if (!isRecord(rawScenario) || !isRecord(rawScenario.grounding) || !Array.isArray(rawScenario.stages) || rawScenario.stages.length === 0) {
      throw new Error(`${path} requires grounding and stages`);
    }
    if (typeof rawScenario.baseline !== "boolean") throw new Error(`${path}.baseline must be boolean`);
    if (typeof rawScenario.hitlRequired !== "boolean") throw new Error(`${path}.hitlRequired must be boolean`);
    const stages = rawScenario.stages.map((stage, stageIndex) => parseStage(stage, `${path}.stages[${stageIndex}]`));
    const cleanupIndex = stages.findIndex(({ lifecycle }) => lifecycle === "cleanup");
    if (cleanupIndex !== -1 && stages.slice(cleanupIndex + 1).some(({ lifecycle }) => lifecycle !== "cleanup")) {
      throw new Error(`${path} cleanup stages must come last`);
    }
    return {
      baseline: rawScenario.baseline,
      description: requireString(rawScenario.description, `${path}.description`),
      grounding: {
        drive: requireString(rawScenario.grounding.drive, `${path}.grounding.drive`),
        isolate: requireString(rawScenario.grounding.isolate, `${path}.grounding.isolate`),
        observe: requireString(rawScenario.grounding.observe, `${path}.grounding.observe`),
        run: requireString(rawScenario.grounding.run, `${path}.grounding.run`),
        surface: requireString(rawScenario.grounding.surface, `${path}.grounding.surface`),
      },
      id: requireString(rawScenario.id, `${path}.id`),
      hitlRequired: rawScenario.hitlRequired,
      regressionRatchetOpportunities: Array.isArray(rawScenario.regressionRatchetOpportunities)
        ? rawScenario.regressionRatchetOpportunities.map((entry, index) => requireString(entry, `${path}.regressionRatchetOpportunities[${index}]`))
        : [],
      stages,
    };
  });
  if (!scenarios[0]?.baseline) throw new Error("The first scenario must establish a baseline before comparisons or optimization attempts");
  return { repositoryPath, scenarios, schemaVersion: 1 };
};

const executeStage = async (stage: Stage, repositoryPath: string, signal?: AbortSignal): Promise<StageResult> => {
  const base = {
    agentWait: stage.agentWait,
    availability: stage.availability,
    condition: stage.condition,
    environment: stage.environment,
    id: stage.id,
    lifecycle: stage.lifecycle,
    machineDurationMs: 0,
    manualDurationMs: 0,
    provenance: {} as StageResult["provenance"],
    reason: stage.reason,
    runs: [] as StageResult["runs"],
    signal: stage.signal,
  };
  if (stage.availability !== "available") return { ...base, status: stage.availability };
  if (stage.latency === "manual") {
    const status = stage.manual?.verdict === "rejected" ? "failed" : stage.manual?.verdict === "inconclusive" ? "partial" : "passed";
    return {
      ...base,
      manualDurationMs: stage.manual!.durationMs,
      provenance: {
        manual: {
          evidence: stage.manual!.evidence,
          verdict: stage.manual!.verdict,
        },
      },
      status,
    };
  }
  const runs: StageResult["runs"] = [];
  let machineDurationMs = 0;
  for (let index = 0; index < stage.repeatCount!; index += 1) {
    const startedAt = performance.now();
    try {
      const result = await runProcess({
        args: stage.command!.args,
        cwd: stage.command!.cwd ? resolve(repositoryPath, stage.command!.cwd) : repositoryPath,
        env: stage.command!.env ? { ...process.env, ...stage.command!.env } : process.env,
        executable: stage.command!.executable,
        signal,
        timeoutMs: stage.timeoutMs!,
      });
      const durationMs = Number((performance.now() - startedAt).toFixed(3));
      machineDurationMs += durationMs;
      runs.push({ durationMs, exitCode: result.exitCode, status: result.exitCode === 0 ? "passed" : "failed", stderr: result.stderr, stdout: result.stdout });
    } catch (error) {
      if (error instanceof ProcessExecutionError && error.kind === "cancelled") throw error;
      const durationMs = Number((performance.now() - startedAt).toFixed(3));
      machineDurationMs += durationMs;
      runs.push({ durationMs, exitCode: null, status: "failed", stderr: error instanceof Error ? error.message : String(error), stdout: "" });
      break;
    }
    if (runs.at(-1)?.status === "failed") break;
  }
  return {
    ...base,
    machineDurationMs: Number(machineDurationMs.toFixed(3)),
    provenance: {
      command: {
        ...stage.command!,
        repeatCount: stage.repeatCount!,
        timeoutMs: stage.timeoutMs!,
      },
    },
    runs,
    status: runs.every(({ status }) => status === "passed") ? "passed" : "failed",
  };
};

const emptyMilestones = (): FeedbackLoopHealthRun["scenarios"][number]["milestones"] => ({
  "automated-confidence": { machineDurationMs: 0, manualDurationMs: 0, status: "unavailable" },
  "first-signal": { machineDurationMs: 0, manualDurationMs: 0, status: "unavailable" },
  "hitl-setup": { machineDurationMs: 0, manualDurationMs: 0, status: "unavailable" },
  "hitl-verdict": { machineDurationMs: 0, manualDurationMs: 0, status: "unavailable" },
  "human-observable-state": { machineDurationMs: 0, manualDurationMs: 0, status: "unavailable" },
});

const statusRank: Record<StageStatus, number> = { failed: 5, partial: 4, unavailable: 3, skipped: 2, passed: 1 };

export const runFeedbackLoopPlan = async (input: unknown, options: { signal?: AbortSignal } = {}): Promise<FeedbackLoopHealthRun> => {
  const plan = parseFeedbackLoopPlan(input);
  const root = resolve(plan.repositoryPath);
  const failures: FeedbackLoopHealthRun["failures"] = [];
  let repository: FeedbackLoopHealthRun["repository"] = {
    dirty: false,
    head: "unknown",
    root,
    stateId: "unknown",
  };
  try {
    const head = (
      await runGit("git", ["rev-parse", "HEAD"], {
        cwd: root,
        signal: options.signal,
        timeoutMs: 5_000,
      })
    ).trim();
    const state = await readRepositoryState({
      gitExecutable: "git",
      head,
      root,
      signal: options.signal,
      timeoutMs: 5_000,
    });
    repository = { ...state, head, root };
  } catch (error) {
    if (error instanceof ProcessExecutionError && error.kind === "cancelled") throw error;
    failures.push({
      capability: "repository-state",
      message: error instanceof Error ? error.message : String(error),
    });
  }
  const scenarios: FeedbackLoopHealthRun["scenarios"] = [];
  for (const scenario of plan.scenarios) {
    const stageResults: StageResult[] = [];
    let failed = false;
    for (const stage of scenario.stages.filter(({ lifecycle }) => lifecycle !== "cleanup")) {
      if (failed) {
        stageResults.push({ agentWait: stage.agentWait, availability: stage.availability, condition: stage.condition, environment: stage.environment, id: stage.id, lifecycle: stage.lifecycle, machineDurationMs: 0, manualDurationMs: 0, provenance: {}, reason: "A prior stage failed", runs: [], signal: stage.signal, status: "skipped" });
        continue;
      }
      const result = await executeStage(stage, plan.repositoryPath, options.signal);
      stageResults.push(result);
      if (
        result.status === "failed" ||
        (result.status !== "passed" && stage.lifecycle !== "evidence")
      ) {
        failed = true;
      }
    }
    for (const stage of scenario.stages.filter(({ lifecycle }) => lifecycle === "cleanup")) {
      stageResults.push(await executeStage(stage, plan.repositoryPath, options.signal));
    }

    const measuredStages = stageResults.filter(({ lifecycle }) => lifecycle !== "cleanup");
    const conditions = {
      "cold-clean": { machineMs: 0, manualMs: 0, sampleCount: 0 },
      "warm-incremental": { machineMs: 0, manualMs: 0, sampleCount: 0 },
    };
    const environments = {
      ci: { machineMs: 0, manualMs: 0, sampleCount: 0 },
      local: { machineMs: 0, manualMs: 0, sampleCount: 0 },
      other: { machineMs: 0, manualMs: 0, sampleCount: 0 },
    };
    const milestones = emptyMilestones();
    for (const result of measuredStages) {
      const condition = conditions[result.condition];
      condition.machineMs += result.machineDurationMs;
      condition.manualMs += result.manualDurationMs;
      condition.sampleCount += result.runs.length + (result.manualDurationMs > 0 ? 1 : 0);
      const environment = environments[result.environment];
      environment.machineMs += result.machineDurationMs;
      environment.manualMs += result.manualDurationMs;
      environment.sampleCount += result.runs.length + (result.manualDurationMs > 0 ? 1 : 0);
      const milestone = milestones[result.signal];
      milestone.machineDurationMs += result.machineDurationMs;
      milestone.manualDurationMs += result.manualDurationMs;
      if (statusRank[result.status] > statusRank[milestone.status] || milestone.status === "unavailable" && result.status === "passed") milestone.status = result.status;
    }
    for (const condition of Object.values(conditions)) {
      condition.machineMs = Number(condition.machineMs.toFixed(3));
      condition.manualMs = Number(condition.manualMs.toFixed(3));
    }
    for (const environment of Object.values(environments)) {
      environment.machineMs = Number(environment.machineMs.toFixed(3));
      environment.manualMs = Number(environment.manualMs.toFixed(3));
    }
    const machineMs = Number(measuredStages.reduce((total, stage) => total + stage.machineDurationMs, 0).toFixed(3));
    const manualMs = Number(measuredStages.reduce((total, stage) => total + stage.manualDurationMs, 0).toFixed(3));
    const agentIdleMs = Number(
      measuredStages
        .filter(({ agentWait }) => agentWait === "blocked")
        .reduce((total, stage) => total + stage.machineDurationMs + stage.manualDurationMs, 0)
        .toFixed(3),
    );
    const incomplete = stageResults.some(({ status }) => status !== "passed");
    scenarios.push({
      baseline: scenario.baseline,
      bottlenecks: measuredStages
        .filter(({ status }) => status === "passed")
        .map((stage) => ({ durationMs: stage.machineDurationMs + stage.manualDurationMs, latency: stage.manualDurationMs > 0 ? "manual" as const : "machine" as const, stageId: stage.id }))
        .filter(({ durationMs }) => durationMs > 0)
        .sort((left, right) => right.durationMs - left.durationMs)
        .slice(0, 3),
      conditions,
      description: scenario.description,
      environments,
      grounding: scenario.grounding,
      hitlRequired: scenario.hitlRequired,
      id: scenario.id,
      latency: { agentIdleMs, machineMs, manualMs, totalMs: Number((machineMs + manualMs).toFixed(3)) },
      milestones,
      regressionRatchetOpportunities: scenario.regressionRatchetOpportunities ?? [],
      stages: stageResults,
      status: incomplete ? "partial" : "complete",
    });
  }
  return {
    diagnostic: "feedback-loop-health",
    failures,
    generatedAt: new Date().toISOString(),
    repository,
    scenarios,
    schemaVersion: 1,
    status:
      failures.length === 0 && scenarios.every(({ status }) => status === "complete")
        ? "complete"
        : "partial",
  };
};

const parseArguments = (args: string[]) => {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || !value) throw new Error("Usage: feedback-loop-health:run -- --plan <path> --output <path>");
    values.set(key, value);
  }
  const planPath = values.get("--plan");
  const outputPath = values.get("--output");
  if (!planPath || !outputPath) throw new Error("--plan and --output are required");
  return { outputPath, planPath };
};

if (require.main === module) {
  const options = parseArguments(process.argv.slice(2));
  try {
    const plan = parseFeedbackLoopPlan(JSON.parse(readFileSync(options.planPath, "utf8")));
    if (isPathInsideRepository(plan.repositoryPath, options.outputPath)) throw new Error("Feedback evidence must be written outside the target repository");
    runFeedbackLoopPlan(plan)
      .then((result) => {
        writeJsonEvidence(options.outputPath, result);
        process.stdout.write(`${JSON.stringify({ outputPath: resolve(options.outputPath), scenarioCount: result.scenarios.length, status: result.status }, null, 2)}\n`);
        process.exitCode = result.status === "complete" ? 0 : 2;
      })
      .catch((error) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
      });
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
