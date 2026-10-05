import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";

import { isPathInsideRepository, writeJsonEvidence } from "./evidence.ts";
import { runGit } from "./git.ts";
import { ProcessExecutionError, runProcess } from "./process.ts";
import {
  compareRepositoryStateChanges,
  readRepositoryIdentity,
  type RepositoryIdentity,
} from "./repository-state.ts";

type Diagnostic =
  | "baseline"
  | "configuration"
  | "failure-containment"
  | "flakiness"
  | "mutation"
  | "order"
  | "runtime";

type Parser = "exit-code" | "jest-json" | "junit-xml" | "stryker-json" | "tap";

type CapabilityGap = {
  capability: string;
  reason: string;
};

type SeedMechanism =
  | { argumentIndex: number; source: "argument" }
  | { environmentVariable: string; source: "environment" };

type Experiment = {
  args: string[];
  capabilityGaps?: CapabilityGap[];
  diagnostic: Diagnostic;
  environment?: Record<string, string>;
  executable: string;
  id: string;
  parser: Parser;
  reportPath?: string;
  repeats: number;
  seed?: SeedMechanism;
  target?: string;
  timeoutMs: number;
  versionArgs?: string[];
  workingDirectory?: string;
};

export type TestHealthPlan = {
  experiments: Experiment[];
  repositoryPath: string;
  schemaVersion: 2;
};

type TestMeasurement = {
  durationMs?: number;
  failed: number;
  passed: number;
  skipped: number;
  total: number;
};

type MutationMeasurement = {
  compileErrors: number;
  killed: number;
  noCoverage: number;
  runtimeErrors: number;
  survived: number;
  timeout: number;
  total: number;
};

type NormalizedMeasurement = {
  mutation?: MutationMeasurement;
  tests?: TestMeasurement;
};

const numberAttribute = (text: string, name: string) => {
  const match = new RegExp(`\\b${name}=["']([0-9.]+)["']`).exec(text);
  return match ? Number(match[1]) : undefined;
};

const normalizeJest = (text: string): NormalizedMeasurement => {
  const report = JSON.parse(text) as {
    numFailedTests?: number;
    numPassedTests?: number;
    numPendingTests?: number;
    numTotalTests?: number;
    startTime?: number;
    testResults?: Array<{ endTime?: number }>;
  };
  const lastEndTime = Math.max(
    0,
    ...(report.testResults ?? []).map(({ endTime }) => endTime ?? 0),
  );
  return {
    tests: {
      durationMs:
        report.startTime && lastEndTime
          ? Math.max(0, lastEndTime - report.startTime)
          : undefined,
      failed: report.numFailedTests ?? 0,
      passed: report.numPassedTests ?? 0,
      skipped: report.numPendingTests ?? 0,
      total: report.numTotalTests ?? 0,
    },
  };
};

const normalizeJunit = (text: string): NormalizedMeasurement => {
  const root = /<(?:testsuites|testsuite)\b[^>]*>/i.exec(text)?.[0];
  if (!root) throw new Error("JUnit XML has no testsuite root");
  const childSuites = [...text.matchAll(/<testsuite\b[^>]*>/gi)].map(
    (match) => match[0],
  );
  const sumAttribute = (name: string) =>
    childSuites.reduce(
      (total, suite) => total + (numberAttribute(suite, name) ?? 0),
      0,
    );
  const total = numberAttribute(root, "tests") ?? sumAttribute("tests");
  const failed =
    (numberAttribute(root, "failures") ?? sumAttribute("failures")) +
    (numberAttribute(root, "errors") ?? sumAttribute("errors"));
  const skipped = numberAttribute(root, "skipped") ?? sumAttribute("skipped");
  const durationSeconds =
    numberAttribute(root, "time") ??
    (childSuites.length > 0 ? sumAttribute("time") : undefined);
  return {
    tests: {
      durationMs:
        durationSeconds === undefined ? undefined : durationSeconds * 1_000,
      failed,
      passed: Math.max(0, total - failed - skipped),
      skipped,
      total,
    },
  };
};

const normalizeStryker = (text: string): NormalizedMeasurement => {
  const report = JSON.parse(text) as {
    files?: Record<string, { mutants?: Array<{ status?: string }> }>;
  };
  const statuses = Object.values(report.files ?? {}).flatMap(({ mutants }) =>
    (mutants ?? []).map(({ status }) => status ?? "Unknown"),
  );
  const count = (status: string) =>
    statuses.filter((candidate) => candidate === status).length;
  return {
    mutation: {
      compileErrors: count("CompileError"),
      killed: count("Killed"),
      noCoverage: count("NoCoverage"),
      runtimeErrors: count("RuntimeError"),
      survived: count("Survived"),
      timeout: count("Timeout"),
      total: statuses.length,
    },
  };
};

const normalizeTap = (text: string): NormalizedMeasurement => {
  const resultLines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^(?:not )?ok\b/.test(line));
  const skipped = resultLines.filter((line) => /#\s*SKIP\b/i.test(line)).length;
  const failed = resultLines.filter((line) => /^not ok\b/.test(line)).length;
  const passed = resultLines.length - failed - skipped;
  const durations = [...text.matchAll(/\bduration_ms:\s*([0-9.]+)/g)].map(
    (match) => Number(match[1]),
  );
  return {
    tests: {
      durationMs:
        durations.length === 0
          ? undefined
          : Math.max(...durations.filter(Number.isFinite)),
      failed,
      passed,
      skipped,
      total: resultLines.length,
    },
  };
};

export const normalizeToolOutput = (
  parser: Parser,
  text: string,
): NormalizedMeasurement => {
  if (parser === "exit-code") return {};
  if (parser === "jest-json") return normalizeJest(text);
  if (parser === "junit-xml") return normalizeJunit(text);
  if (parser === "stryker-json") return normalizeStryker(text);
  return normalizeTap(text);
};

const parsePlan = (value: unknown): TestHealthPlan => {
  if (!value || typeof value !== "object") {
    throw new Error("Plan must be a JSON object");
  }
  const plan = value as Partial<TestHealthPlan>;
  if ((value as { schemaVersion?: unknown }).schemaVersion === 1) {
    throw new Error(
      "Plan schemaVersion 1 cannot prove seed provenance; migrate to schemaVersion 2 and point each seed to its argument or environment source",
    );
  }
  if (
    plan.schemaVersion !== 2 ||
    typeof plan.repositoryPath !== "string" ||
    !Array.isArray(plan.experiments)
  ) {
    throw new Error(
      "Plan requires schemaVersion 2, repositoryPath, and experiments",
    );
  }
  const ids = new Set<string>();
  for (const experiment of plan.experiments) {
    const seed = experiment?.seed as SeedMechanism | undefined;
    const validSeed =
      seed === undefined ||
      (typeof seed === "object" &&
        seed !== null &&
        seed.source === "argument" &&
        Number.isInteger(seed.argumentIndex) &&
        seed.argumentIndex >= 0 &&
        seed.argumentIndex < (experiment?.args?.length ?? 0)) ||
      (typeof seed === "object" &&
        seed !== null &&
        seed.source === "environment" &&
        typeof seed.environmentVariable === "string" &&
        /^[A-Za-z_][A-Za-z0-9_]*$/.test(seed.environmentVariable) &&
        typeof experiment?.environment?.[seed.environmentVariable] ===
          "string");
    if (
      !experiment ||
      typeof experiment.id !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(experiment.id) ||
      ids.has(experiment.id) ||
      typeof experiment.executable !== "string" ||
      !Array.isArray(experiment.args) ||
      !experiment.args.every((arg) => typeof arg === "string") ||
      (experiment.environment !== undefined &&
        (!experiment.environment ||
          typeof experiment.environment !== "object" ||
          !Object.values(experiment.environment).every(
            (value) => typeof value === "string",
          ))) ||
      (experiment.capabilityGaps !== undefined &&
        (!Array.isArray(experiment.capabilityGaps) ||
          !experiment.capabilityGaps.every(
            (gap) =>
              gap &&
              typeof gap.capability === "string" &&
              gap.capability.length > 0 &&
              typeof gap.reason === "string" &&
              gap.reason.length > 0,
          ))) ||
      !validSeed ||
      (experiment.versionArgs !== undefined &&
        (!Array.isArray(experiment.versionArgs) ||
          experiment.versionArgs.length === 0 ||
          !experiment.versionArgs.every((arg) => typeof arg === "string"))) ||
      (experiment.reportPath !== undefined &&
        typeof experiment.reportPath !== "string") ||
      (experiment.workingDirectory !== undefined &&
        typeof experiment.workingDirectory !== "string") ||
      !Number.isInteger(experiment.repeats) ||
      experiment.repeats < 1 ||
      experiment.repeats > 100 ||
      !Number.isInteger(experiment.timeoutMs) ||
      experiment.timeoutMs < 1 ||
      experiment.timeoutMs > 600_000 ||
      ![
        "baseline",
        "configuration",
        "failure-containment",
        "flakiness",
        "mutation",
        "order",
        "runtime",
      ].includes(experiment.diagnostic) ||
      !["exit-code", "jest-json", "junit-xml", "stryker-json", "tap"].includes(
        experiment.parser,
      )
    ) {
      throw new Error(`Invalid experiment ${experiment?.id ?? "<unknown>"}`);
    }
    ids.add(experiment.id);
  }
  return plan as TestHealthPlan;
};

const median = (values: number[]) => {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const value = sorted[middle];
  if (value === undefined) return 0;
  if (sorted.length % 2 === 1) return value;
  return ((sorted[middle - 1] ?? value) + value) / 2;
};

const publicRepositoryIdentity = ({
  dirty,
  head,
  stateId,
}: RepositoryIdentity) => ({ dirty, head, stateId });

const resolveSeedProvenance = (experiment: Experiment) => {
  if (!experiment.seed) return undefined;
  if (experiment.seed.source === "argument") {
    return {
      ...experiment.seed,
      value: experiment.args[experiment.seed.argumentIndex]!,
    };
  }
  return {
    ...experiment.seed,
    value: experiment.environment![experiment.seed.environmentVariable]!,
  };
};

const captureToolVersion = async (options: {
  experiment: Experiment;
  signal?: AbortSignal;
  workingDirectory: string;
}) => {
  if (!options.experiment.versionArgs) {
    return {
      gap: {
        capability: "tool-version",
        reason:
          "No safe version argument array was configured for this executable",
      },
      provenance: { args: [] as string[] },
    };
  }
  try {
    const result = await runProcess({
      args: options.experiment.versionArgs,
      cwd: options.workingDirectory,
      env: options.experiment.environment
        ? { ...process.env, ...options.experiment.environment }
        : process.env,
      executable: options.experiment.executable,
      maxOutputBytes: 64 * 1024,
      signal: options.signal,
      timeoutMs: Math.min(options.experiment.timeoutMs, 10_000),
    });
    const value = (result.stdout || result.stderr).trim();
    if (result.exitCode !== 0 || value.length === 0) {
      return {
        gap: {
          capability: "tool-version",
          reason: `Configured version command exited with ${
            result.exitCode ?? "unknown"
          } or returned no version`,
        },
        provenance: { args: options.experiment.versionArgs },
      };
    }
    return {
      provenance: { args: options.experiment.versionArgs, value },
    };
  } catch (error) {
    if (error instanceof ProcessExecutionError && error.kind === "cancelled") {
      throw error;
    }
    return {
      gap: {
        capability: "tool-version",
        reason: `Configured version command was unavailable: ${
          error instanceof Error ? error.message : String(error)
        }`,
      },
      provenance: { args: options.experiment.versionArgs },
    };
  }
};

type ReportSourceState =
  | { exists: false }
  | { exists: true; fingerprint: string; writeIdentity: string }
  | { error: string; exists: "unknown" };

const readReportSourceState = (reportPath?: string): ReportSourceState => {
  if (!reportPath || !existsSync(reportPath)) return { exists: false };
  try {
    const status = lstatSync(reportPath, { bigint: true });
    const writeIdentity = [status.size, status.mtimeNs].join(":");
    if (!status.isFile()) {
      return {
        exists: true,
        fingerprint: `special:${status.mode}:${status.size}`,
        writeIdentity,
      };
    }
    return {
      exists: true,
      fingerprint: `blob:${createHash("sha256")
        .update(readFileSync(reportPath))
        .digest("hex")}`,
      writeIdentity,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      exists: "unknown",
    };
  }
};

const snapshotMachineReport = (options: {
  artifactDirectory: string;
  before: ReportSourceState;
  experimentId: string;
  reportPath?: string;
  run: number;
}) => {
  if (!options.reportPath) return {};
  const after = readReportSourceState(options.reportPath);
  if (options.before.exists === "unknown") {
    return {
      reportSnapshotError: `Configured report path could not be fingerprinted before this run: ${options.before.error}`,
    };
  }
  if (after.exists === "unknown") {
    return {
      reportSnapshotError: `Configured report path could not be fingerprinted after this run: ${after.error}`,
    };
  }
  if (!after.exists) {
    return {
      reportSnapshotError: "Configured report path was not created by this run",
    };
  }
  if (
    options.before.exists &&
    options.before.fingerprint === after.fingerprint &&
    options.before.writeIdentity === after.writeIdentity
  ) {
    return {
      reportSnapshotError:
        "Configured report path was unchanged from before this run; stale evidence was not attributed",
    };
  }
  const reportExtension = extname(options.reportPath) || ".txt";
  const reportArtifactPath = join(
    options.artifactDirectory,
    `${options.experimentId}-${options.run}-report${reportExtension}`,
  );
  try {
    copyFileSync(options.reportPath, reportArtifactPath);
    return {
      parserText: readFileSync(reportArtifactPath, "utf8"),
      reportArtifactPath,
    };
  } catch (error) {
    return {
      reportSnapshotError:
        error instanceof Error ? error.message : String(error),
    };
  }
};

export const runTestHealthPlan = async (options: {
  outputPath: string;
  plan: TestHealthPlan;
  signal?: AbortSignal;
}) => {
  const plan = parsePlan(options.plan);
  const gitExecutable = "git";
  const repositoryTimeoutMs = 10_000;
  const requestedRepositoryPath = resolve(plan.repositoryPath);
  const gitVersion = (
    await runGit(gitExecutable, ["--version"], {
      cwd: requestedRepositoryPath,
      signal: options.signal,
      timeoutMs: repositoryTimeoutMs,
    })
  ).trim();
  const repositoryRoot = (
    await runGit(gitExecutable, ["rev-parse", "--show-toplevel"], {
      cwd: requestedRepositoryPath,
      signal: options.signal,
      timeoutMs: repositoryTimeoutMs,
    })
  ).trim();
  if (isPathInsideRepository(repositoryRoot, options.outputPath)) {
    throw new Error("Experiment output must be outside the target repository");
  }
  const artifactDirectory = join(
    dirname(resolve(options.outputPath)),
    `${basename(options.outputPath, extname(options.outputPath))}-artifacts`,
  );
  mkdirSync(artifactDirectory, { recursive: true });
  const repositoryBefore = await readRepositoryIdentity({
    gitExecutable,
    includeIgnored: true,
    root: repositoryRoot,
    signal: options.signal,
    timeoutMs: repositoryTimeoutMs,
  });
  const experiments = [];
  let partial = false;

  for (const experiment of plan.experiments) {
    const workingDirectory = resolve(
      repositoryRoot,
      experiment.workingDirectory ?? ".",
    );
    if (!isPathInsideRepository(repositoryRoot, workingDirectory)) {
      throw new Error(
        `Experiment ${experiment.id} working directory must be inside the repository`,
      );
    }
    const reportPath = experiment.reportPath
      ? resolve(experiment.reportPath)
      : undefined;
    if (reportPath && isPathInsideRepository(repositoryRoot, reportPath)) {
      throw new Error(
        `Experiment ${experiment.id} report path must be outside the repository`,
      );
    }
    const experimentRepositoryBefore = await readRepositoryIdentity({
      gitExecutable,
      includeIgnored: true,
      root: repositoryRoot,
      signal: options.signal,
      timeoutMs: repositoryTimeoutMs,
    });
    const capabilityGaps = [...(experiment.capabilityGaps ?? [])];
    for (const gap of experimentRepositoryBefore.coverageGaps) {
      if (
        !capabilityGaps.some(
          (candidate) =>
            candidate.capability === gap.capability &&
            candidate.reason === gap.reason,
        )
      ) {
        capabilityGaps.push(gap);
      }
      partial = true;
    }
    if (
      experiment.diagnostic === "mutation" &&
      experiment.parser !== "stryker-json"
    ) {
      capabilityGaps.push({
        capability: "structured-mutation-normalization",
        reason: `${experiment.parser} preserves native or exit-code evidence without structured mutant counts`,
      });
    } else if (experiment.parser === "exit-code") {
      capabilityGaps.push({
        capability: "native-reporter-metrics",
        reason:
          "The exit-code parser preserves process evidence without structured test, retry, quarantine, fixture, or detailed timing metrics",
      });
    }
    const toolVersion = await captureToolVersion({
      experiment,
      signal: options.signal,
      workingDirectory,
    });
    if (toolVersion.gap) capabilityGaps.push(toolVersion.gap);
    const runs = [];
    for (let run = 1; run <= experiment.repeats; run += 1) {
      const reportSourceBefore = readReportSourceState(reportPath);
      const startedAt = new Date().toISOString();
      const started = performance.now();
      try {
        const result = await runProcess({
          args: experiment.args,
          cwd: workingDirectory,
          env: experiment.environment
            ? { ...process.env, ...experiment.environment }
            : process.env,
          executable: experiment.executable,
          signal: options.signal,
          timeoutMs: experiment.timeoutMs,
        });
        const durationMs = Math.round(performance.now() - started);
        const stdoutPath = join(
          artifactDirectory,
          `${experiment.id}-${run}-stdout.txt`,
        );
        const stderrPath = join(
          artifactDirectory,
          `${experiment.id}-${run}-stderr.txt`,
        );
        writeFileSync(stdoutPath, result.stdout);
        writeFileSync(stderrPath, result.stderr);
        const reportSnapshot = snapshotMachineReport({
          artifactDirectory,
          before: reportSourceBefore,
          experimentId: experiment.id,
          reportPath,
          run,
        });
        const parserText = reportSnapshot.parserText ?? result.stdout;
        let measurement: NormalizedMeasurement | undefined;
        let normalizationError = reportSnapshot.reportSnapshotError;
        try {
          if (!normalizationError) {
            measurement = normalizeToolOutput(experiment.parser, parserText);
          }
        } catch (error) {
          normalizationError =
            error instanceof Error ? error.message : String(error);
        }
        if (normalizationError) partial = true;
        runs.push({
          durationMs,
          exitCode: result.exitCode,
          measurement,
          normalizationError,
          reportArtifactPath: reportSnapshot.reportArtifactPath,
          reportSnapshotError: reportSnapshot.reportSnapshotError,
          run,
          startedAt,
          stderrPath,
          stdoutPath,
        });
      } catch (error) {
        if (
          error instanceof ProcessExecutionError &&
          error.kind === "cancelled"
        ) {
          throw error;
        }
        if (!(error instanceof ProcessExecutionError)) throw error;
        partial = true;
        const reportSnapshot = snapshotMachineReport({
          artifactDirectory,
          before: reportSourceBefore,
          experimentId: experiment.id,
          reportPath,
          run,
        });
        runs.push({
          durationMs: Math.round(performance.now() - started),
          executionError: { kind: error.kind, message: error.message },
          exitCode: null,
          reportArtifactPath: reportSnapshot.reportArtifactPath,
          reportSnapshotError: reportSnapshot.reportSnapshotError,
          run,
          startedAt,
        });
        if (error.kind === "spawn") break;
      }
    }
    const failedRuns = runs.filter(
      ({ executionError, exitCode, measurement }) =>
        executionError ||
        exitCode !== 0 ||
        (measurement?.tests?.failed ?? 0) > 0,
    ).length;
    const experimentRepositoryAfter = await readRepositoryIdentity({
      gitExecutable,
      includeIgnored: true,
      root: repositoryRoot,
      signal: options.signal,
      timeoutMs: repositoryTimeoutMs,
    });
    for (const gap of experimentRepositoryAfter.coverageGaps) {
      if (
        !capabilityGaps.some(
          (candidate) =>
            candidate.capability === gap.capability &&
            candidate.reason === gap.reason,
        )
      ) {
        capabilityGaps.push(gap);
      }
      partial = true;
    }
    const residueChanges = compareRepositoryStateChanges(
      experimentRepositoryBefore,
      experimentRepositoryAfter,
    );
    const headChanged =
      experimentRepositoryBefore.head !== experimentRepositoryAfter.head;
    experiments.push({
      capabilityGaps,
      diagnostic: experiment.diagnostic,
      id: experiment.id,
      provenance: {
        args: experiment.args,
        environmentKeys: Object.keys(experiment.environment ?? {}).sort(),
        executable: experiment.executable,
        parser: experiment.parser,
        reportPath,
        repeats: experiment.repeats,
        seed: resolveSeedProvenance(experiment),
        target: experiment.target,
        timeoutMs: experiment.timeoutMs,
        toolVersion: toolVersion.provenance,
        workingDirectory,
      },
      residue: {
        after: publicRepositoryIdentity(experimentRepositoryAfter),
        before: publicRepositoryIdentity(experimentRepositoryBefore),
        changes: residueChanges,
        cleanup:
          residueChanges.length > 0 || headChanged
            ? "preserved-unknown-state"
            : "not-needed",
        detected: residueChanges.length > 0 || headChanged,
        headChanged,
      },
      runs,
      summary: {
        failedRuns,
        failureRate: runs.length === 0 ? 0 : failedRuns / runs.length,
        medianDurationMs: median(runs.map(({ durationMs }) => durationMs)),
        runs: runs.length,
      },
    });
  }

  const repositoryAfter = await readRepositoryIdentity({
    gitExecutable,
    includeIgnored: true,
    root: repositoryRoot,
    signal: options.signal,
    timeoutMs: repositoryTimeoutMs,
  });

  const report = JSON.parse(
    JSON.stringify({
      experiments,
      generatedAt: new Date().toISOString(),
      provenance: { gitVersion },
      repository: {
        after: publicRepositoryIdentity(repositoryAfter),
        before: publicRepositoryIdentity(repositoryBefore),
        root: repositoryRoot,
      },
      repositoryRoot,
      schemaVersion: 2,
      status: partial ? "partial" : "complete",
    }),
  ) as {
    experiments: typeof experiments;
    generatedAt: string;
    provenance: { gitVersion: string };
    repository: {
      after: ReturnType<typeof publicRepositoryIdentity>;
      before: ReturnType<typeof publicRepositoryIdentity>;
      root: string;
    };
    repositoryRoot: string;
    schemaVersion: 2;
    status: "complete" | "partial";
  };
  writeJsonEvidence(options.outputPath, report);
  return report;
};

const parseArguments = (args: string[]) => {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || !value) {
      throw new Error(
        "Usage: npm run test-suite-health:run -- --plan <path> --output <path>",
      );
    }
    values.set(key, value);
  }
  const planPath = values.get("--plan");
  const outputPath = values.get("--output");
  if (!planPath || !outputPath) {
    throw new Error("--plan and --output are required");
  }
  return { outputPath, planPath };
};

if (require.main === module) {
  const options = parseArguments(process.argv.slice(2));
  const plan = parsePlan(JSON.parse(readFileSync(options.planPath, "utf8")));
  runTestHealthPlan({ outputPath: options.outputPath, plan })
    .then((result) => {
      process.stdout.write(
        `${JSON.stringify(
          {
            experiments: result.experiments.length,
            outputPath: resolve(options.outputPath),
            status: result.status,
          },
          null,
          2,
        )}\n`,
      );
      process.exitCode = result.status === "complete" ? 0 : 2;
    })
    .catch((error) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    });
}
