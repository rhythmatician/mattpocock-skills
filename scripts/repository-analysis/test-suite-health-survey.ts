import { resolve } from "node:path";

import {
  isPathInsideRepository,
  writeJsonEvidence,
} from "./evidence.ts";
import { runGit } from "./git.ts";
import {
  listRepositoryFiles,
  readRepositoryText,
  type RepositoryFileInventory,
} from "./repository-files.ts";
import { ProcessExecutionError } from "./process.ts";
import { readRepositoryState } from "./repository-state.ts";
import { discoverTestTooling } from "./tool-catalog.ts";

export type TestHealthDepth = "deep" | "quick" | "standard";

type SurveyOptions = {
  depth: TestHealthDepth;
  gitExecutable?: string;
  outputPath?: string;
  repositoryPath: string;
  signal?: AbortSignal;
};

type Location = {
  line: number;
  path: string;
};

type Failure = {
  capability: "file-inventory" | "git-history";
  message: string;
};

export type TestSuiteHealthSurvey = {
  evidence: {
    assertionlessCandidates: Array<Location & { testDefinition: number }>;
    configurationAxes: Array<
      Location & {
        constraintStatus: "unknown";
        kind:
          | "boolean"
          | "cli-flag"
          | "environment"
          | "feature-flag"
          | "mode-enum";
        name: string;
        tested: boolean;
      }
    >;
    evolutionaryMismatch: Array<{
      coChanges: number;
      sourceChanges: number;
      sourcePath: string;
      testPaths: string[];
    }>;
    failurePathCoverage: Array<{
      category:
        | "cleanup"
        | "dependency-failure"
        | "interruption"
        | "partial-progress"
        | "retry";
      locations: Location[];
    }>;
    skipMarkers: Array<
      Location & {
        marker: string;
      }
    >;
  };
  failures: Failure[];
  generatedAt: string;
  inventory: {
    configurationFiles: number;
    sourceFiles: number;
    testFiles: number;
    totalFiles: number;
  };
  provenance: {
    commitLimit: number;
    depth: TestHealthDepth;
    fileLimit: number;
    gitVersion: string;
  };
  repository: {
    dirty: boolean;
    head: string;
    root: string;
    stateId: string;
  };
  status: "complete" | "partial";
  tooling: ReturnType<typeof discoverTestTooling>;
  unmeasured: Array<{
    diagnostic:
      | "configuration-interactions"
      | "flakiness"
      | "mutation"
      | "order-dependence"
      | "runtime-concentration";
    reason: string;
  }>;
};

const DEPTHS: Record<
  TestHealthDepth,
  { commitLimit: number; fileLimit: number; timeoutMs: number }
> = {
  deep: { commitLimit: 1_000, fileLimit: 50_000, timeoutMs: 60_000 },
  quick: { commitLimit: 50, fileLimit: 10_000, timeoutMs: 5_000 },
  standard: { commitLimit: 250, fileLimit: 25_000, timeoutMs: 20_000 },
};

const TEST_PATH =
  /(^|\/)(__tests__|tests?|specs?)(\/|$)|([._-](spec|test)|_test)\.[^/]+$/i;
const SOURCE_PATH =
  /\.(c|cc|cpp|cs|ex|exs|fs|go|java|js|jsx|kt|kts|php|py|rb|rs|swift|ts|tsx)$/i;
const CONFIGURATION_PATH =
  /(^|\/)(config|configs|configuration)(\/|$)|(^|\/)\.?env(\.|$)|\.(ya?ml|toml|ini|properties)$/i;
const TEST_DEFINITION =
  /\b(?:it|test|specify)(?:\.(?:only|skip|todo))?\s*\(|#\[test\]|^\s*(?:async\s+)?def\s+test_|^\s*func\s+Test[A-Z]/gm;
const ASSERTION =
  /\b(?:assert(?:That|Equals|NotNull|True|False)?|expect|should|verify)\b|#\[should_panic\]|\.to(?:Be|Equal|Match|Throw|Have)|\brequire\.|\bassert(?:_eq|_ne)?!\s*\(|\bpanic!\s*\(/g;
const SKIP_MARKERS: Array<[string, RegExp]> = [
  ["skip", /\b(?:describe|context|it|test)\.(?:skip|todo)\b|#\[ignore\]|@Ignore\b/g],
  ["quarantine", /\b(?:quarantine|quarantined|flaky)\b/gi],
  ["focus-only", /\b(?:describe|context|it|test)\.(?:only|focus)\b|@Focused\b/g],
];
const CONFIGURATION_PATTERNS: Array<{
  kind: TestSuiteHealthSurvey["evidence"]["configurationAxes"][number]["kind"];
  pattern: RegExp;
}> = [
  { kind: "environment", pattern: /\bprocess\.env\.([A-Z][A-Z0-9_]*)\b/g },
  {
    kind: "environment",
    pattern: /\b(?:getenv|environ\.get)\(\s*["']([A-Z][A-Z0-9_]*)["']/g,
  },
  {
    kind: "environment",
    pattern: /\bENV\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\]/g,
  },
  {
    kind: "environment",
    pattern: /\bSystem\.getenv\(\s*["']([A-Z][A-Z0-9_]*)["']/g,
  },
  {
    kind: "environment",
    pattern:
      /\bEnvironment\.GetEnvironmentVariable\(\s*["']([A-Z][A-Z0-9_]*)["']/g,
  },
  { kind: "cli-flag", pattern: /["'](--[a-z][a-z0-9-]+)["']/gi },
  {
    kind: "feature-flag",
    pattern:
      /\b(?:isFeatureEnabled|featureEnabled)\(\s*["']([a-z][a-z0-9_.-]+)["']/gi,
  },
  {
    kind: "feature-flag",
    pattern: /\b((?:FEATURE|FLAG)_[A-Z][A-Z0-9_]*)\b/g,
  },
  {
    kind: "mode-enum",
    pattern:
      /\b(?:enum|type)\s+([A-Za-z][A-Za-z0-9]*(?:Mode|Strategy|Backend|Provider))\b/g,
  },
  {
    kind: "boolean",
    pattern:
      /\b((?:enable|disable|allow|use|is)[A-Z][A-Za-z0-9]*)\s*(?::\s*boolean|=\s*(?:true|false))/g,
  },
];
const FAILURE_PATTERNS: Record<
  TestSuiteHealthSurvey["evidence"]["failurePathCoverage"][number]["category"],
  RegExp
> = {
  cleanup: /\b(cleanup|finalize|teardown|afterEach|afterAll|dispose)\b/gi,
  "dependency-failure":
    /\b(rejects?|throws?|timeout|unavailable|connection refused|dependency fail)/gi,
  interruption: /\b(abort|cancel|interrupt|signal|SIGTERM|SIGINT)\b/g,
  "partial-progress": /\b(partial|half[- ]?written|rollback|recover|resume)\b/gi,
  retry: /\b(retr(?:y|ies|ied)|idempoten)/gi,
};

const locationsFor = (content: string, path: string, pattern: RegExp) => {
  const locations: Location[] = [];
  pattern.lastIndex = 0;
  for (const match of content.matchAll(pattern)) {
    const index = match.index ?? 0;
    locations.push({
      line: content.slice(0, index).split("\n").length,
      path,
    });
  }
  return locations;
};

const findAssertionlessCandidates = (content: string, path: string) => {
  TEST_DEFINITION.lastIndex = 0;
  const definitions = [...content.matchAll(TEST_DEFINITION)];
  return definitions.flatMap((definition, index) => {
    const start = definition.index ?? 0;
    const end = definitions[index + 1]?.index ?? content.length;
    const body = content.slice(start, end);
    ASSERTION.lastIndex = 0;
    if (ASSERTION.test(body)) return [];
    return [
      {
        line: content.slice(0, start).split("\n").length,
        path,
        testDefinition: index + 1,
      },
    ];
  });
};

const normalizedStem = (path: string) =>
  path
    .split("/")
    .at(-1)
    ?.replace(/\.[^.]+$/, "")
    .replace(/(?:[._-](?:spec|test)|_test)$/i, "")
    .replace(/^test[_-]/i, "")
    .toLowerCase();

const parseHistoryPaths = (output: string) => {
  const commits: string[][] = [];
  let current: string[] | undefined;
  for (const token of output.split("\x00")) {
    const value = token.replace(/^\r?\n/, "");
    if (value === "H") {
      if (current) commits.push(current);
      current = [];
    } else if (value && current) {
      current.push(value);
    }
  }
  if (current) commits.push(current);
  return commits;
};

const analyzeEvolution = (
  commits: string[][],
  sourcePaths: string[],
  testPaths: string[],
) => {
  const sourceSet = new Set(sourcePaths);
  const testSet = new Set(testPaths);
  const testsByStem = new Map<string, string[]>();
  for (const path of testPaths) {
    const stem = normalizedStem(path);
    if (!stem) continue;
    testsByStem.set(stem, [...(testsByStem.get(stem) ?? []), path]);
  }
  const changes = new Map<string, { coChanges: number; sourceChanges: number }>();
  for (const commit of commits) {
    const changedSources = commit.filter((path) => sourceSet.has(path));
    const changedTests = new Set(commit.filter((path) => testSet.has(path)));
    for (const sourcePath of changedSources) {
      const stem = normalizedStem(sourcePath);
      const matchingTests = stem ? (testsByStem.get(stem) ?? []) : [];
      const current = changes.get(sourcePath) ?? {
        coChanges: 0,
        sourceChanges: 0,
      };
      current.sourceChanges += 1;
      if (matchingTests.some((path) => changedTests.has(path))) {
        current.coChanges += 1;
      }
      changes.set(sourcePath, current);
    }
  }
  return [...changes.entries()]
    .map(([sourcePath, counts]) => ({
      ...counts,
      sourcePath,
      testPaths: testsByStem.get(normalizedStem(sourcePath) ?? "") ?? [],
    }))
    .filter(
      ({ coChanges, sourceChanges }) =>
        sourceChanges >= 2 && coChanges / sourceChanges < 0.25,
    )
    .sort(
      (left, right) =>
        right.sourceChanges - left.sourceChanges ||
        left.sourcePath.localeCompare(right.sourcePath),
    )
    .slice(0, 100);
};

export const surveyTestSuiteHealth = async (
  options: SurveyOptions,
): Promise<TestSuiteHealthSurvey> => {
  const limits = DEPTHS[options.depth];
  const gitExecutable = options.gitExecutable ?? "git";
  const failures: Failure[] = [];
  let root = resolve(options.repositoryPath);
  let head = "unknown";
  let gitVersion = "unavailable";
  let history: string[][] = [];
  let repositoryState = { dirty: false, stateId: "unknown" };

  try {
    const commandOptions = {
      cwd: options.repositoryPath,
      signal: options.signal,
      timeoutMs: limits.timeoutMs,
    };
    gitVersion = (
      await runGit(gitExecutable, ["--version"], commandOptions)
    ).trim();
    root = (
      await runGit(
        gitExecutable,
        ["rev-parse", "--show-toplevel"],
        commandOptions,
      )
    ).trim();
    head = (
      await runGit(gitExecutable, ["rev-parse", "HEAD"], {
        ...commandOptions,
        cwd: root,
      })
    ).trim();
    repositoryState = await readRepositoryState({
      gitExecutable,
      head,
      root,
      signal: options.signal,
      timeoutMs: limits.timeoutMs,
    });
    history = parseHistoryPaths(
      await runGit(
        gitExecutable,
        [
          "log",
          `--max-count=${limits.commitLimit}`,
          "--name-only",
          "-z",
          "--format=%x00H%x00",
        ],
        {
          ...commandOptions,
          cwd: root,
          maxOutputBytes: 16 * 1024 * 1024,
        },
      ),
    );
  } catch (error) {
    if (
      error instanceof ProcessExecutionError &&
      error.kind === "cancelled"
    ) {
      throw error;
    }
    failures.push({
      capability: "git-history",
      message: `${gitExecutable} is not available or usable: ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
  }

  let inventory: RepositoryFileInventory;
  try {
    inventory = listRepositoryFiles(root, limits.fileLimit);
  } catch (error) {
    inventory = { paths: [], truncated: false };
    failures.push({
      capability: "file-inventory",
      message: `Could not inventory repository files: ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
  }
  if (inventory.truncated) {
    failures.push({
      capability: "file-inventory",
      message: `File inventory reached the ${limits.fileLimit} file limit`,
    });
  }
  const testPaths = inventory.paths.filter((path) => TEST_PATH.test(path));
  const sourcePaths = inventory.paths.filter(
    (path) => SOURCE_PATH.test(path) && !TEST_PATH.test(path),
  );
  const testContents = testPaths
    .map((path) => ({
      content: readRepositoryText(root, path),
      path,
    }))
    .filter(
      (entry): entry is { content: string; path: string } =>
        entry.content !== undefined,
    );
  const allContents = inventory.paths
    .filter(
      (path) =>
        SOURCE_PATH.test(path) ||
        CONFIGURATION_PATH.test(path) ||
        TEST_PATH.test(path),
    )
    .map((path) => ({
      content: readRepositoryText(root, path),
      path,
    }))
    .filter(
      (entry): entry is { content: string; path: string } =>
        entry.content !== undefined,
    );

  const skipMarkers = testContents.flatMap(({ content, path }) =>
    SKIP_MARKERS.flatMap(([marker, pattern]) =>
      locationsFor(content, path, pattern).map((location) => ({
        ...location,
        marker,
      })),
    ),
  );
  const assertionlessCandidates = testContents.flatMap(({ content, path }) =>
    findAssertionlessCandidates(content, path),
  );

  const testPathSet = new Set(testPaths);
  const testedAxisNames = new Set(
    testContents.flatMap(({ content }) =>
      CONFIGURATION_PATTERNS.flatMap(({ pattern }) => {
        pattern.lastIndex = 0;
        return [...content.matchAll(pattern)].flatMap((match) =>
          match[1] ? [match[1]] : [],
        );
      }),
    ),
  );
  const configurationAxes = allContents.flatMap(({ content, path }) =>
    CONFIGURATION_PATTERNS.flatMap(({ kind, pattern }) => {
      pattern.lastIndex = 0;
      return [...content.matchAll(pattern)].flatMap((match) => {
        const name = match[1];
        if (!name) return [];
        const index = match.index ?? 0;
        return [
          {
            constraintStatus: "unknown" as const,
            kind,
            line: content.slice(0, index).split("\n").length,
            name,
            path,
            tested: testPathSet.has(path) || testedAxisNames.has(name),
          },
        ];
      });
    }),
  )
    .filter(
      (axis, index, axes) =>
        axes.findIndex(
          (candidate) =>
            candidate.name === axis.name &&
            candidate.path === axis.path &&
            candidate.line === axis.line,
        ) === index,
    )
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name) ||
        left.path.localeCompare(right.path) ||
        left.line - right.line,
    );

  const failurePathCoverage = Object.entries(FAILURE_PATTERNS).map(
    ([category, pattern]) => ({
      category:
        category as TestSuiteHealthSurvey["evidence"]["failurePathCoverage"][number]["category"],
      locations: testContents
        .flatMap(({ content, path }) => locationsFor(content, path, pattern))
        .slice(0, 200),
    }),
  );
  const tooling = discoverTestTooling(root, inventory.paths);
  const survey: TestSuiteHealthSurvey = {
    evidence: {
      assertionlessCandidates,
      configurationAxes,
      evolutionaryMismatch: analyzeEvolution(history, sourcePaths, testPaths),
      failurePathCoverage,
      skipMarkers,
    },
    failures,
    generatedAt: new Date().toISOString(),
    inventory: {
      configurationFiles: inventory.paths.filter((path) =>
        CONFIGURATION_PATH.test(path),
      ).length,
      sourceFiles: sourcePaths.length,
      testFiles: testPaths.length,
      totalFiles: inventory.paths.length,
    },
    provenance: {
      commitLimit: limits.commitLimit,
      depth: options.depth,
      fileLimit: limits.fileLimit,
      gitVersion,
    },
    repository: { ...repositoryState, head, root },
    status: failures.length === 0 ? "complete" : "partial",
    tooling,
    unmeasured: [
      {
        diagnostic: "flakiness",
        reason: "Requires repeated execution of the repository's own test runner",
      },
      {
        diagnostic: "order-dependence",
        reason: "Requires a runner-supported seeded shuffle or equivalent tool",
      },
      {
        diagnostic: "runtime-concentration",
        reason: "Requires machine-readable timing from an actual test run",
      },
      {
        diagnostic: "configuration-interactions",
        reason:
          "Discovered axes require repository evidence for valid-state constraints before combination generation",
      },
      {
        diagnostic: "mutation",
        reason:
          "Targeted mutation is an optional expensive phase selected after the cheap survey",
      },
    ],
  };

  if (options.outputPath) {
    if (isPathInsideRepository(root, options.outputPath)) {
      throw new Error(
        "Analysis output must be outside the target repository so audit evidence does not alter repository state",
      );
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
    if (!key?.startsWith("--") || !value) {
      throw new Error(
        "Usage: npm run test-suite-health:survey -- --repo <path> --depth <quick|standard|deep> --output <path>",
      );
    }
    values.set(key, value);
  }
  const repositoryPath = values.get("--repo");
  const depth = values.get("--depth");
  const outputPath = values.get("--output");
  if (
    !repositoryPath ||
    !outputPath ||
    (depth !== "quick" && depth !== "standard" && depth !== "deep")
  ) {
    throw new Error(
      "--repo, --depth <quick|standard|deep>, and --output are required",
    );
  }
  return { depth, outputPath, repositoryPath };
};

if (require.main === module) {
  const options = parseArguments(process.argv.slice(2));
  surveyTestSuiteHealth(options)
    .then((result) => {
      process.stdout.write(
        `${JSON.stringify(
          {
            failures: result.failures,
            outputPath: resolve(options.outputPath ?? ""),
            status: result.status,
            testFiles: result.inventory.testFiles,
            tools: result.tooling.tools.map(({ name }) => name),
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
