import { basename, resolve } from "node:path";

import { isPathInsideRepository, writeJsonEvidence } from "./evidence.ts";
import { runGit } from "./git.ts";
import {
  listRepositoryFiles,
  readRepositoryText,
} from "./repository-files.ts";
import { ProcessExecutionError } from "./process.ts";
import { readRepositoryState } from "./repository-state.ts";

export type FeedbackLoopDepth = "deep" | "quick" | "standard";

type SurveyOptions = {
  depth: FeedbackLoopDepth;
  gitExecutable?: string;
  outputPath?: string;
  repositoryPath: string;
  signal?: AbortSignal;
};

type Availability = {
  evidence: string[];
  reason?: string;
  status: "available" | "partial" | "unavailable";
};

type FeedbackRole =
  | "automated-confidence"
  | "first-signal"
  | "human-observable-state";

export type FeedbackLoopHealthSurvey = {
  commands: Array<{
    command: string;
    name: string;
    role: FeedbackRole;
    source: string;
  }>;
  diagnostic: "feedback-loop-health";
  failures: Array<{
    capability: "file-inventory" | "git";
    message: string;
  }>;
  generatedAt: string;
  repository: {
    dirty: boolean;
    head: string;
    root: string;
    stateId: string;
  };
  scenarioGrounding: {
    drive: Availability;
    isolate: Availability;
    observe: Availability;
    run: Availability;
    surface: Availability;
  };
  schemaVersion: 1;
  status: "complete" | "partial";
  unavailableStages: Array<{
    reason: string;
    stage:
      | "automated-confidence"
      | "first-signal"
      | "hitl-setup"
      | "hitl-verdict"
      | "human-observable-state";
  }>;
};

const DEPTHS: Record<FeedbackLoopDepth, { fileLimit: number; timeoutMs: number }> = {
  deep: { fileLimit: 50_000, timeoutMs: 60_000 },
  quick: { fileLimit: 10_000, timeoutMs: 5_000 },
  standard: { fileLimit: 25_000, timeoutMs: 20_000 },
};

const classifyScript = (name: string, command: string): FeedbackRole[] => {
  const value = `${name} ${command}`;
  const roles: FeedbackRole[] = [];
  if (/watch|lint|typecheck|type-check|check|test|spec/i.test(value)) {
    roles.push("first-signal");
  }
  if (/verify|ci|test|spec|build|check|lint|typecheck|type-check/i.test(value)) {
    roles.push("automated-confidence");
  }
  if (/dev|serve|start|preview|storybook|playwright|cypress/i.test(value)) {
    roles.push("human-observable-state");
  }
  return [...new Set(roles)];
};

const discoverCommands = (root: string, paths: string[]) => {
  const commands: FeedbackLoopHealthSurvey["commands"] = [];
  for (const path of paths.filter((candidate) => basename(candidate) === "package.json")) {
    const content = readRepositoryText(root, path);
    if (!content) continue;
    try {
      const manifest = JSON.parse(content) as { scripts?: Record<string, unknown> };
      for (const [name, command] of Object.entries(manifest.scripts ?? {})) {
        if (typeof command !== "string") continue;
        for (const role of classifyScript(name, command)) {
          commands.push({
            command: `npm run ${name}`,
            name,
            role,
            source: `${path}#scripts.${name}`,
          });
        }
      }
    } catch {
      // The repository's package tooling owns invalid manifest diagnostics.
    }
  }

  const fileCommands: Array<{
    command: string;
    name: string;
    pattern: RegExp;
    role: FeedbackRole;
  }> = [
    { command: "cargo test", name: "cargo-test", pattern: /(^|\/)Cargo\.toml$/, role: "automated-confidence" },
    { command: "go test ./...", name: "go-test", pattern: /(^|\/)go\.mod$/, role: "automated-confidence" },
    { command: "pytest", name: "pytest", pattern: /(^|\/)(pyproject\.toml|pytest\.ini)$/, role: "automated-confidence" },
    { command: "dotnet test", name: "dotnet-test", pattern: /\.(sln|csproj|fsproj)$/, role: "automated-confidence" },
  ];
  for (const candidate of fileCommands) {
    const source = paths.find((path) => candidate.pattern.test(path));
    if (!source) continue;
    commands.push({
      command: candidate.command,
      name: candidate.name,
      role: candidate.role,
      source,
    });
    commands.push({
      command: candidate.command,
      name: candidate.name,
      role: "first-signal",
      source,
    });
  }
  return commands.sort(
      (left, right) =>
        left.role.localeCompare(right.role) ||
        left.name.localeCompare(right.name) ||
        left.source.localeCompare(right.source),
    );
};

const grounding = (
  root: string,
  paths: string[],
  commands: FeedbackLoopHealthSurvey["commands"],
): FeedbackLoopHealthSurvey["scenarioGrounding"] => {
  const candidatePaths = paths.filter((path) =>
    /(^|\/)(readme|contributing|developing)(\.[^/]+)?$|\.md$|\.ya?ml$|package\.json$/i.test(path),
  );
  const text = candidatePaths
    .slice(0, 200)
    .map((path) => ({ path, text: readRepositoryText(root, path, 128 * 1024) ?? "" }));
  const matchingPaths = (pattern: RegExp) =>
    text.filter(({ text: value }) => pattern.test(value)).map(({ path }) => path).slice(0, 20);
  const pathMatches = (pattern: RegExp) => paths.filter((path) => pattern.test(path)).slice(0, 20);
  const available = (evidence: string[], reason: string): Availability =>
    evidence.length > 0
      ? { evidence: [...new Set(evidence)].sort(), status: "available" }
      : { evidence: [], reason, status: "unavailable" };

  return {
    drive: available(
      [
        ...pathMatches(/(^|\/)(e2e|integration|tests?|specs?)(\/|$)|playwright|cypress/i),
        ...matchingPaths(/playwright|cypress|curl\s|httpie|pty|tmux|webdriver/i),
      ],
      "No programmable drive path was found",
    ),
    isolate: available(
      [
        ...matchingPaths(/profile|data[-_ ]?dir|temp(?:orary)?|sandbox|isolate|random port|PORT\b|TEST_[A-Z_]+/i),
        ...pathMatches(/docker-compose|compose\.ya?ml|devcontainer/i),
      ],
      "No documented isolation mechanism was found",
    ),
    observe: available(
      [
        ...matchingPaths(/screenshot|trace|transcript|log(?:ging)?|response body|report|artifact/i),
        ...pathMatches(/playwright|cypress|screenshots?|traces?|artifacts?/i),
      ],
      "No durable evidence surface was found",
    ),
    run: available(
      commands
        .filter(({ role }) => role === "human-observable-state")
        .map(({ source }) => source),
      "No repository-owned launch command was found",
    ),
    surface: available(
      [
        ...matchingPaths(/web UI|browser|CLI|TUI|desktop|mobile|API|localhost|user-facing/i),
        ...pathMatches(/(^|\/)(src|app|apps|cmd|cli|api)(\/|$)/i),
      ],
      "No user or reviewer surface was identifiable from repository evidence",
    ),
  };
};

export const surveyFeedbackLoopHealth = async (
  options: SurveyOptions,
): Promise<FeedbackLoopHealthSurvey> => {
  const depth = DEPTHS[options.depth];
  const gitExecutable = options.gitExecutable ?? "git";
  let root = resolve(options.repositoryPath);
  let head = "unknown";
  let stateId = "unknown";
  let dirty = false;
  const failures: FeedbackLoopHealthSurvey["failures"] = [];

  try {
    root = (
      await runGit(gitExecutable, ["rev-parse", "--show-toplevel"], {
        cwd: root,
        signal: options.signal,
        timeoutMs: depth.timeoutMs,
      })
    ).trim();
    head = (
      await runGit(gitExecutable, ["rev-parse", "HEAD"], {
        cwd: root,
        signal: options.signal,
        timeoutMs: depth.timeoutMs,
      })
    ).trim();
    const state = await readRepositoryState({
      gitExecutable,
      head,
      root,
      signal: options.signal,
      timeoutMs: depth.timeoutMs,
    });
    dirty = state.dirty;
    stateId = state.stateId;
  } catch (error) {
    if (error instanceof ProcessExecutionError && error.kind === "cancelled") throw error;
    failures.push({
      capability: "git",
      message: `${gitExecutable} is not available or usable: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  let paths: string[] = [];
  try {
    const inventory = listRepositoryFiles(root, depth.fileLimit);
    paths = inventory.paths;
    if (inventory.truncated) {
      failures.push({
        capability: "file-inventory",
        message: `File inventory was bounded at ${depth.fileLimit} files`,
      });
    }
  } catch (error) {
    failures.push({
      capability: "file-inventory",
      message: error instanceof Error ? error.message : String(error),
    });
  }

  const commands = discoverCommands(root, paths);
  const scenarioGrounding = grounding(root, paths, commands);
  const unavailableStages: FeedbackLoopHealthSurvey["unavailableStages"] = [];
  if (!commands.some(({ role }) => role === "first-signal")) {
    unavailableStages.push({ stage: "first-signal", reason: "No repository-owned fast verification command was found" });
  }
  if (!commands.some(({ role }) => role === "automated-confidence")) {
    unavailableStages.push({ stage: "automated-confidence", reason: "No repository-owned confidence command was found" });
  }
  if (scenarioGrounding.run.status === "unavailable") {
    unavailableStages.push({ stage: "human-observable-state", reason: scenarioGrounding.run.reason! });
  }
  unavailableStages.push({
    stage: "hitl-setup",
    reason: "Manual setup latency requires an observed scenario run",
  });
  unavailableStages.push({
    stage: "hitl-verdict",
    reason: "A trustworthy HITL verdict requires an observed reviewer decision",
  });

  const survey: FeedbackLoopHealthSurvey = {
    commands,
    diagnostic: "feedback-loop-health",
    failures,
    generatedAt: new Date().toISOString(),
    repository: { dirty, head, root, stateId },
    scenarioGrounding,
    schemaVersion: 1,
    status:
      failures.length > 0 ||
      Object.values(scenarioGrounding).some(({ status }) => status !== "available")
        ? "partial"
        : "complete",
    unavailableStages,
  };

  if (options.outputPath) {
    if (isPathInsideRepository(root, options.outputPath)) {
      throw new Error("Analysis output must be outside the target repository so feedback evidence does not alter repository state");
    }
    writeJsonEvidence(options.outputPath, survey);
  }
  return survey;
};

const parseArguments = (args: string[]): SurveyOptions => {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || !value) throw new Error("Usage: feedback-loop-health:survey -- --repo <path> --depth <quick|standard|deep> --output <path>");
    values.set(key, value);
  }
  const repositoryPath = values.get("--repo");
  const outputPath = values.get("--output");
  const depth = values.get("--depth");
  if (!repositoryPath || !outputPath || (depth !== "quick" && depth !== "standard" && depth !== "deep")) {
    throw new Error("--repo, --depth <quick|standard|deep>, and --output are required");
  }
  return { depth, outputPath, repositoryPath };
};

if (require.main === module) {
  const options = parseArguments(process.argv.slice(2));
  surveyFeedbackLoopHealth(options)
    .then((result) => {
      process.stdout.write(`${JSON.stringify({ commandCount: result.commands.length, outputPath: resolve(options.outputPath ?? ""), status: result.status }, null, 2)}\n`);
      process.exitCode = result.status === "complete" ? 0 : 2;
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
