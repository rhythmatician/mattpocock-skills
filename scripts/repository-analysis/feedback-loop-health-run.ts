import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, isAbsolute, resolve } from "node:path";
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
type LifecycleApplicability = "not-required" | "required";
type FindingClassification =
  | "local-ci-divergence"
  | "manual-ceremony"
  | "necessary"
  | "overbroad"
  | "redundant"
  | "serial"
  | "uncached"
  | "unstable";
type FindingOwner =
  | "codebase-design"
  | "feedback-loop-health"
  | "hillclimb"
  | "improve-codebase-architecture"
  | "maintenance-risk"
  | "tdd"
  | "test-suite-health";

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
  finding?: {
    baselineFindingId?: string;
    classification: FindingClassification;
    owner: FindingOwner;
    regressionRatchetOpportunity: string;
    smallestImprovement: string;
    whyItMatters: string;
  };
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
  lifecycleApplicability: Record<Lifecycle, LifecycleApplicability>;
  regressionRatchetOpportunities?: string[];
  stages: Stage[];
};

export type FeedbackLoopPlan = {
  evidencePaths: string[];
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
  cleanup: {
    evidencePaths: string[];
    status: "complete" | "partial";
    unavailableEvidencePaths: Array<{
      path: string;
      reason: string;
    }>;
  };
  confidenceBoundaries: string[];
  diagnostic: "feedback-loop-health";
  failures: Array<{ capability: "repository-state"; message: string }>;
  findings: Array<{
    claimType: "interpretation";
    baselineFindingId?: string;
    classification: FindingClassification;
    id: string;
    measurement: {
      agentIdleMs: number;
      condition: Condition;
      environment: Stage["environment"];
      machineMs: number;
      manualMs: number;
      sampleCount: number;
    };
    owner: FindingOwner;
    provenance: Array<
      | ({ kind: "executed-command" } & Command & {
          repeatCount: number;
          timeoutMs: number;
        })
      | {
          evidence: string;
          kind: "human-observation";
          verdict?: "accepted" | "rejected" | "inconclusive";
        }
    >;
    rank: number;
    reason: string;
    regressionRatchetOpportunity: string;
    scenarioId: string;
    signal: Signal;
    smallestImprovement: string;
    stage: Lifecycle;
    stageId: string;
  }>;
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
    comparison: {
      status: "complete" | "partial";
      unavailableConditions: Condition[];
    };
    description: string;
    grounding: Scenario["grounding"];
    hitlRequired: boolean;
    id: string;
    environments: Record<Stage["environment"], { machineMs: number; manualMs: number; sampleCount: number }>;
    latency: { agentIdleMs: number; machineMs: number; manualMs: number; totalMs: number };
    lifecycleReadiness: Record<
      Lifecycle,
      {
        applicability: LifecycleApplicability;
        stageIds: string[];
        status: "complete" | "not-required" | "partial" | "unavailable";
      }
    >;
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
  unavailableStages: Array<{
    reason: string;
    scenarioId: string;
    stageId: string;
  }>;
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
  if (value.finding !== undefined) {
    if (!isRecord(value.finding)) throw new Error(`${path}.finding must be an object`);
    stage.finding = {
      baselineFindingId:
        value.finding.baselineFindingId === undefined
          ? undefined
          : requireString(
              value.finding.baselineFindingId,
              `${path}.finding.baselineFindingId`,
            ),
      classification: oneOf(
        value.finding.classification,
        ["necessary", "redundant", "unstable", "overbroad", "serial", "uncached", "local-ci-divergence", "manual-ceremony"] as const,
        `${path}.finding.classification`,
      ),
      owner: oneOf(
        value.finding.owner,
        ["feedback-loop-health", "test-suite-health", "maintenance-risk", "tdd", "codebase-design", "improve-codebase-architecture", "hillclimb"] as const,
        `${path}.finding.owner`,
      ),
      regressionRatchetOpportunity: requireString(
        value.finding.regressionRatchetOpportunity,
        `${path}.finding.regressionRatchetOpportunity`,
      ),
      smallestImprovement: requireString(
        value.finding.smallestImprovement,
        `${path}.finding.smallestImprovement`,
      ),
      whyItMatters: requireString(
        value.finding.whyItMatters,
        `${path}.finding.whyItMatters`,
      ),
    };
  }
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
  const evidencePaths = value.evidencePaths === undefined
    ? []
    : Array.isArray(value.evidencePaths)
      ? value.evidencePaths.map((entry, index) => requireString(entry, `evidencePaths[${index}]`))
      : (() => { throw new Error("evidencePaths must be an array of paths"); })();
  if (!Array.isArray(value.scenarios) || value.scenarios.length === 0) throw new Error("Feedback-loop plan requires at least one scenario");
  const scenarios = value.scenarios.map((rawScenario, scenarioIndex): Scenario => {
    const path = `scenarios[${scenarioIndex}]`;
    if (!isRecord(rawScenario) || !isRecord(rawScenario.grounding) || !Array.isArray(rawScenario.stages) || rawScenario.stages.length === 0) {
      throw new Error(`${path} requires grounding and stages`);
    }
    if (typeof rawScenario.baseline !== "boolean") throw new Error(`${path}.baseline must be boolean`);
    if (typeof rawScenario.hitlRequired !== "boolean") throw new Error(`${path}.hitlRequired must be boolean`);
    if (!isRecord(rawScenario.lifecycleApplicability)) {
      throw new Error(`${path}.lifecycleApplicability must declare every lifecycle stage`);
    }
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
      lifecycleApplicability: {
        cleanup: oneOf(rawScenario.lifecycleApplicability.cleanup, ["required", "not-required"] as const, `${path}.lifecycleApplicability.cleanup`),
        doctor: oneOf(rawScenario.lifecycleApplicability.doctor, ["required", "not-required"] as const, `${path}.lifecycleApplicability.doctor`),
        drive: oneOf(rawScenario.lifecycleApplicability.drive, ["required", "not-required"] as const, `${path}.lifecycleApplicability.drive`),
        evidence: oneOf(rawScenario.lifecycleApplicability.evidence, ["required", "not-required"] as const, `${path}.lifecycleApplicability.evidence`),
        launch: oneOf(rawScenario.lifecycleApplicability.launch, ["required", "not-required"] as const, `${path}.lifecycleApplicability.launch`),
      },
      regressionRatchetOpportunities: Array.isArray(rawScenario.regressionRatchetOpportunities)
        ? rawScenario.regressionRatchetOpportunities.map((entry, index) => requireString(entry, `${path}.regressionRatchetOpportunities[${index}]`))
        : [],
      stages,
    };
  });
  if (!scenarios[0]?.baseline) throw new Error("The first scenario must establish a baseline before comparisons or optimization attempts");
  return { evidencePaths, repositoryPath, scenarios, schemaVersion: 1 };
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
const LIFECYCLES: Lifecycle[] = ["launch", "doctor", "drive", "evidence", "cleanup"];

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
  const findings: FeedbackLoopHealthRun["findings"] = [];
  const findingCandidates: Array<{
    baseline: boolean;
    baselineFindingId?: string;
    finding: FeedbackLoopHealthRun["findings"][number];
  }> = [];
  const unavailableStages: FeedbackLoopHealthRun["unavailableStages"] = [];
  const unavailableKeys = new Set<string>();
  const addUnavailable = (scenarioId: string, stageId: string, reason: string) => {
    const key = `${scenarioId}\u0000${stageId}`;
    if (unavailableKeys.has(key)) return;
    unavailableKeys.add(key);
    unavailableStages.push({ reason, scenarioId, stageId });
  };
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
      condition.sampleCount += result.runs.length + (result.provenance.manual ? 1 : 0);
      const environment = environments[result.environment];
      environment.machineMs += result.machineDurationMs;
      environment.manualMs += result.manualDurationMs;
      environment.sampleCount += result.runs.length + (result.provenance.manual ? 1 : 0);
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
    const lifecycleReadiness = Object.fromEntries(
      LIFECYCLES.map((lifecycle) => {
        const applicability = scenario.lifecycleApplicability[lifecycle];
        const lifecycleStages = stageResults.filter((stage) => stage.lifecycle === lifecycle);
        const status = applicability === "not-required"
          ? "not-required"
          : lifecycleStages.length === 0
            ? "unavailable"
            : lifecycleStages.every((stage) => stage.status === "passed")
              ? "complete"
              : "partial";
        if (status === "unavailable") {
          addUnavailable(
            scenario.id,
            `lifecycle:${lifecycle}`,
            `Required ${lifecycle} lifecycle stage was not provided`,
          );
        }
        return [
          lifecycle,
          {
            applicability,
            stageIds: lifecycleStages.map(({ id }) => id),
            status,
          },
        ];
      }),
    ) as FeedbackLoopHealthRun["scenarios"][number]["lifecycleReadiness"];
    const unavailableConditions = (Object.entries(conditions) as Array<
      [Condition, (typeof conditions)[Condition]]
    >)
      .filter(([, measurement]) => measurement.sampleCount === 0)
      .map(([condition]) => condition);
    const comparison = {
      status: unavailableConditions.length === 0 ? "complete" as const : "partial" as const,
      unavailableConditions,
    };

    for (const result of stageResults) {
      if (result.status !== "passed") {
        addUnavailable(
          scenario.id,
          result.id,
          result.reason ??
            result.runs.find(({ status }) => status === "failed")?.stderr ??
            `Stage ended with status ${result.status}`,
        );
      }
      const source = scenario.stages.find(({ id }) => id === result.id);
      if (!source?.finding || result.status !== "passed") continue;
      const provenance: FeedbackLoopHealthRun["findings"][number]["provenance"] = [];
      if (result.provenance.command) {
        provenance.push({ kind: "executed-command", ...result.provenance.command });
      }
      if (result.provenance.manual) {
        provenance.push({ kind: "human-observation", ...result.provenance.manual });
      }
      findingCandidates.push({
        baseline: scenario.baseline,
        baselineFindingId: source.finding.baselineFindingId,
        finding: {
          claimType: "interpretation",
          classification: source.finding.classification,
          id: `${scenario.id}:${result.id}`,
          measurement: {
            agentIdleMs:
              result.agentWait === "blocked"
                ? Number((result.machineDurationMs + result.manualDurationMs).toFixed(3))
                : 0,
            condition: result.condition,
            environment: result.environment,
            machineMs: result.machineDurationMs,
            manualMs: result.manualDurationMs,
            sampleCount:
              result.runs.length + (result.provenance.manual ? 1 : 0),
          },
          owner: source.finding.owner,
          provenance,
          rank: 0,
          reason: source.finding.whyItMatters,
          regressionRatchetOpportunity:
            source.finding.regressionRatchetOpportunity,
          scenarioId: scenario.id,
          signal: result.signal,
          smallestImprovement: source.finding.smallestImprovement,
          stage: result.lifecycle,
          stageId: result.id,
        },
      });
    }

    for (const condition of unavailableConditions) {
      addUnavailable(
        scenario.id,
        `condition:${condition}`,
        `No successful ${condition} sample was recorded`,
      );
    }
    if (scenario.hitlRequired) {
      for (const signal of [
        "human-observable-state",
        "hitl-setup",
        "hitl-verdict",
      ] as const) {
        if (milestones[signal].status === "passed") continue;
        addUnavailable(
          scenario.id,
          signal,
          `Required ${signal.replaceAll("-", " ")} feedback is ${milestones[signal].status}`,
        );
      }
    }
    const lifecycleIncomplete = Object.values(lifecycleReadiness).some(
      ({ status }) => status === "partial" || status === "unavailable",
    );
    const hitlIncomplete = scenario.hitlRequired && [
      milestones["human-observable-state"],
      milestones["hitl-setup"],
      milestones["hitl-verdict"],
    ].some(({ status }) => status !== "passed");
    const incomplete =
      stageResults.some(({ status }) => status !== "passed") ||
      lifecycleIncomplete ||
      hitlIncomplete ||
      comparison.status === "partial";
    scenarios.push({
      baseline: scenario.baseline,
      bottlenecks: measuredStages
        .filter(({ status }) => status === "passed")
        .map((stage) => ({ durationMs: stage.machineDurationMs + stage.manualDurationMs, latency: stage.manualDurationMs > 0 ? "manual" as const : "machine" as const, stageId: stage.id }))
        .filter(({ durationMs }) => durationMs > 0)
        .sort((left, right) => right.durationMs - left.durationMs)
        .slice(0, 3),
      conditions,
      comparison,
      description: scenario.description,
      environments,
      grounding: scenario.grounding,
      hitlRequired: scenario.hitlRequired,
      id: scenario.id,
      latency: { agentIdleMs, machineMs, manualMs, totalMs: Number((machineMs + manualMs).toFixed(3)) },
      lifecycleReadiness,
      milestones,
      regressionRatchetOpportunities: scenario.regressionRatchetOpportunities ?? [],
      stages: stageResults,
      status: incomplete ? "partial" : "complete",
    });
  }
  const baselineFindingIds = new Set(
    findingCandidates
      .filter(({ baseline }) => baseline)
      .map(({ finding }) => finding.id),
  );
  for (const candidate of findingCandidates) {
    if (candidate.baseline) {
      findings.push(candidate.finding);
      continue;
    }
    if (
      candidate.baselineFindingId &&
      baselineFindingIds.has(candidate.baselineFindingId)
    ) {
      findings.push({
        ...candidate.finding,
        baselineFindingId: candidate.baselineFindingId,
      });
      continue;
    }
    addUnavailable(
      candidate.finding.scenarioId,
      `finding:${candidate.finding.stageId}`,
      candidate.baselineFindingId
        ? `Baseline finding ${candidate.baselineFindingId} was not measured`
        : "A non-baseline finding requires a measured baseline finding link",
    );
    const scenarioResult = scenarios.find(
      ({ id }) => id === candidate.finding.scenarioId,
    );
    if (scenarioResult) scenarioResult.status = "partial";
  }
  findings
    .sort(
      (left, right) =>
        right.measurement.machineMs + right.measurement.manualMs -
          (left.measurement.machineMs + left.measurement.manualMs) ||
        left.id.localeCompare(right.id),
    )
    .forEach((finding, index) => {
      finding.rank = index + 1;
    });
  const validEvidencePaths: string[] = [];
  const unavailableEvidencePaths: FeedbackLoopHealthRun["cleanup"]["unavailableEvidencePaths"] = [];
  if (plan.evidencePaths.length === 0) {
    unavailableEvidencePaths.push({
      path: "(none)",
      reason: "No evidence paths were declared",
    });
    addUnavailable(
      "report",
      "evidence-path:missing",
      "No evidence paths were declared",
    );
  }
  for (const [index, evidencePath] of plan.evidencePaths.entries()) {
    const absolutePath = resolve(evidencePath);
    let reason: string | undefined;
    if (!isAbsolute(evidencePath)) {
      reason = "Evidence path must be an absolute artifact file path";
    } else if (!existsSync(absolutePath)) {
      reason = "Evidence path does not exist after the scenario run";
    } else if (!statSync(absolutePath).isFile()) {
      reason = "Evidence path must be a file";
    } else if (isPathInsideRepository(root, absolutePath)) {
      reason = "Evidence path must be outside the target repository";
    }
    if (reason) {
      unavailableEvidencePaths.push({ path: absolutePath, reason });
      addUnavailable("report", `evidence-path:${index}`, reason);
    } else {
      validEvidencePaths.push(absolutePath);
    }
  }
  const lifecycleCleanupComplete = scenarios.every(({ lifecycleReadiness }) => {
    const status = lifecycleReadiness.cleanup.status;
    return status === "complete" || status === "not-required";
  });
  const cleanupStatus =
    lifecycleCleanupComplete && unavailableEvidencePaths.length === 0
    ? "complete"
    : "partial";
  return {
    cleanup: {
      evidencePaths: validEvidencePaths,
      status: cleanupStatus,
      unavailableEvidencePaths,
    },
    confidenceBoundaries: [
      ...failures.map(
        ({ capability, message }) => `${capability}: ${message}`,
      ),
      ...unavailableStages.map(
        ({ reason, scenarioId, stageId }) =>
          `${scenarioId}/${stageId}: ${reason}`,
      ),
    ],
    diagnostic: "feedback-loop-health",
    failures,
    findings,
    generatedAt: new Date().toISOString(),
    repository,
    scenarios,
    schemaVersion: 1,
    status:
      failures.length === 0 &&
      cleanupStatus === "complete" &&
      scenarios.every(({ status }) => status === "complete")
        ? "complete"
        : "partial",
    unavailableStages,
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
