import {
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";

import {
  isPathInsideRepository,
  writeJsonEvidence,
} from "./evidence.ts";
import { ProcessExecutionError, runProcess } from "./process.ts";

type Diagnostic =
  | "baseline"
  | "configuration"
  | "failure-containment"
  | "flakiness"
  | "mutation"
  | "order"
  | "runtime";

type Parser = "exit-code" | "jest-json" | "junit-xml" | "stryker-json" | "tap";

type Experiment = {
  args: string[];
  diagnostic: Diagnostic;
  environment?: Record<string, string>;
  executable: string;
  id: string;
  parser: Parser;
  reportPath?: string;
  repeats: number;
  seed?: string;
  target?: string;
  timeoutMs: number;
  workingDirectory?: string;
};

export type TestHealthPlan = {
  experiments: Experiment[];
  repositoryPath: string;
  schemaVersion: 1;
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
  if (
    plan.schemaVersion !== 1 ||
    typeof plan.repositoryPath !== "string" ||
    !Array.isArray(plan.experiments)
  ) {
    throw new Error(
      "Plan requires schemaVersion 1, repositoryPath, and experiments",
    );
  }
  const ids = new Set<string>();
  for (const experiment of plan.experiments) {
    if (
      !experiment ||
      typeof experiment.id !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(experiment.id) ||
      ids.has(experiment.id) ||
      typeof experiment.executable !== "string" ||
      !Array.isArray(experiment.args) ||
      !experiment.args.every((arg) => typeof arg === "string") ||
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
      ![
        "exit-code",
        "jest-json",
        "junit-xml",
        "stryker-json",
        "tap",
      ].includes(experiment.parser)
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

export const runTestHealthPlan = async (options: {
  outputPath: string;
  plan: TestHealthPlan;
  signal?: AbortSignal;
}) => {
  const plan = parsePlan(options.plan);
  const repositoryRoot = resolve(plan.repositoryPath);
  if (isPathInsideRepository(repositoryRoot, options.outputPath)) {
    throw new Error(
      "Experiment output must be outside the target repository",
    );
  }
  const artifactDirectory = join(
    dirname(resolve(options.outputPath)),
    `${basename(options.outputPath, extname(options.outputPath))}-artifacts`,
  );
  mkdirSync(artifactDirectory, { recursive: true });
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
    if (
      experiment.reportPath &&
      isPathInsideRepository(repositoryRoot, experiment.reportPath)
    ) {
      throw new Error(
        `Experiment ${experiment.id} report path must be outside the repository`,
      );
    }
    const runs = [];
    for (let run = 1; run <= experiment.repeats; run += 1) {
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
        const parserText = experiment.reportPath
          ? readFileSync(experiment.reportPath, "utf8")
          : result.stdout;
        let measurement: NormalizedMeasurement | undefined;
        let normalizationError: string | undefined;
        try {
          measurement = normalizeToolOutput(experiment.parser, parserText);
        } catch (error) {
          partial = true;
          normalizationError =
            error instanceof Error ? error.message : String(error);
        }
        runs.push({
          durationMs,
          exitCode: result.exitCode,
          measurement,
          normalizationError,
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
        runs.push({
          durationMs: Math.round(performance.now() - started),
          executionError: { kind: error.kind, message: error.message },
          exitCode: null,
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
    experiments.push({
      diagnostic: experiment.diagnostic,
      id: experiment.id,
      provenance: {
        args: experiment.args,
        environmentKeys: Object.keys(experiment.environment ?? {}).sort(),
        executable: experiment.executable,
        parser: experiment.parser,
        repeats: experiment.repeats,
        seed: experiment.seed,
        target: experiment.target,
        timeoutMs: experiment.timeoutMs,
        workingDirectory,
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

  const report = JSON.parse(
    JSON.stringify({
      experiments,
      generatedAt: new Date().toISOString(),
      repositoryRoot,
      schemaVersion: 1,
      status: partial ? "partial" : "complete",
    }),
  ) as {
    experiments: typeof experiments;
    generatedAt: string;
    repositoryRoot: string;
    schemaVersion: 1;
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
