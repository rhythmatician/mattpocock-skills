import { resolve } from "node:path";

import {
  isPathInsideRepository,
  writeJsonEvidence,
} from "./evidence.ts";
import { runGit } from "./git.ts";
import { ProcessExecutionError } from "./process.ts";
import { readRepositoryState } from "./repository-state.ts";
import {
  type AnalyzerAdapter,
  type AnalyzerFailure,
  type AnalysisDepth,
  collectStaticEvidence,
  createOmenAdapter,
  type EvidenceProvenance,
  type EvidenceSet,
  type MaintenanceHotspot,
  type CognitiveComplexityFinding,
  type DeadArchitectureCandidate,
  type DependencyPathology,
} from "./maintenance-risk-analyzers.ts";

export type { AnalyzerAdapter, AnalysisDepth };

type SurveyOptions = {
  analyzerAdapters?: AnalyzerAdapter[];
  depth: AnalysisDepth;
  gitExecutable?: string;
  omenExecutable?: string;
  outputPath?: string;
  repositoryPath: string;
  signal?: AbortSignal;
};

type Failure = {
  capability:
    | AnalyzerFailure["capability"]
    | "change-amplification"
    | "git-history"
    | "temporal-coupling";
  message: string;
};

type Churn = {
  changes: number;
  lastChanged: string;
  path: string;
};

type TemporalCoupling = {
  confidence: number;
  paths: [string, string];
  sharedChanges: number;
};

type ChangeAmplification = {
  commit: string;
  date: string;
  filesChanged: number;
  maxPairRecurrence: number;
  pairRecurrenceStatus: "bounded" | "measured";
  paths: string[];
  recurringPairs: number;
  topLevelAreas: string[];
};

export type MaintenanceRiskSurvey = {
  diagnostic: "maintenance-risk";
  evidence: {
    changeAmplification: EvidenceSet<ChangeAmplification>;
    cognitiveComplexity: EvidenceSet<CognitiveComplexityFinding>;
    deadArchitecture: EvidenceSet<DeadArchitectureCandidate>;
    dependencyPathology: EvidenceSet<DependencyPathology>;
    hotspots: EvidenceSet<MaintenanceHotspot>;
    temporalCoupling: EvidenceSet<TemporalCoupling>;
  };
  exclusions: Array<{
    commit: string;
    reason: "bulk-mechanical" | "huge-changeset" | "merge";
  }>;
  failures: Failure[];
  generatedAt: string;
  provenance: {
    capability: "git-history";
    commitLimit: number;
    depth: AnalysisDepth;
    toolVersion: string;
  };
  repository: {
    dirty: boolean;
    head: string;
    root: string;
    stateId: string;
  };
  schemaVersion: 1;
  status: "complete" | "partial";
};

type HistoryCommit = {
  commit: string;
  date: string;
  files: string[];
  message: string;
  parents: string[];
};

const DEPTHS: Record<
  AnalysisDepth,
  {
    commitLimit: number;
    maxCouplingFilesPerCommit: number;
    maxCouplingResults: number;
    maxFilesPerCommit: number;
    maxPairObservations: number;
    timeoutMs: number;
  }
> = {
  quick: {
    commitLimit: 50,
    maxCouplingFilesPerCommit: 50,
    maxCouplingResults: 1_000,
    maxFilesPerCommit: 200,
    maxPairObservations: 20_000,
    timeoutMs: 5_000,
  },
  standard: {
    commitLimit: 250,
    maxCouplingFilesPerCommit: 100,
    maxCouplingResults: 5_000,
    maxFilesPerCommit: 500,
    maxPairObservations: 100_000,
    timeoutMs: 20_000,
  },
  deep: {
    commitLimit: 1_000,
    maxCouplingFilesPerCommit: 200,
    maxCouplingResults: 20_000,
    maxFilesPerCommit: 2_000,
    maxPairObservations: 500_000,
    timeoutMs: 60_000,
  },
};

const EXCLUDED_PATHS = [
  /(^|\/)node_modules\//,
  /(^|\/)vendor\//,
  /(^|\/)(dist|build|target)\//,
  /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|go\.sum)$/,
  /\.generated\.[^/]+$/,
];

const BULK_MECHANICAL_COMMIT =
  /^(chore(\(.+\))?:\s*)?(format|generated?|vendor|lockfile|dependencies?|dependabot|renovate)\b/i;

const parseHistory = (output: string): HistoryCommit[] =>
  (() => {
    const commits: HistoryCommit[] = [];
    const tokens = output.split("\x00");
    let index = 0;

    while (index < tokens.length) {
      const marker = tokens[index]?.replace(/^\r?\n/, "");
      index += 1;
      if (marker !== "H") continue;

      const commit = tokens[index];
      const date = tokens[index + 1];
      const message = tokens[index + 2];
      const parents = tokens[index + 3] ?? "";
      index += 4;
      if (!commit || !date || message === undefined) continue;

      const files: string[] = [];
      while (index < tokens.length) {
        const status = tokens[index]?.replace(/^\r?\n/, "");
        if (status === "H") break;
        index += 1;
        if (!status) continue;
        if (status.startsWith("R") || status.startsWith("C")) {
          const newPath = tokens[index + 1];
          index += 2;
          if (newPath) files.push(newPath);
          continue;
        }
        const path = tokens[index];
        index += 1;
        if (path) files.push(path);
      }

      commits.push({
        commit,
        date,
        files,
        message,
        parents: parents.split(" ").filter(Boolean),
      });
    }

    return commits;
  })();

const isExcludedPath = (path: string) =>
  EXCLUDED_PATHS.some((pattern) => pattern.test(path.replaceAll("\\", "/")));

const topLevelArea = (path: string) => {
  const normalized = path.replaceAll("\\", "/");
  const separator = normalized.indexOf("/");
  return separator === -1 ? "(root)" : normalized.slice(0, separator);
};

const createEvidence = (
  commits: HistoryCommit[],
  limits: Pick<
    (typeof DEPTHS)[AnalysisDepth],
    | "maxCouplingFilesPerCommit"
    | "maxCouplingResults"
    | "maxFilesPerCommit"
    | "maxPairObservations"
  >,
): {
  amplificationLimited: boolean;
  couplingLimited: boolean;
  evidence: {
    changeAmplification: ChangeAmplification[];
    churn: Churn[];
    exclusions: MaintenanceRiskSurvey["exclusions"];
    temporalCoupling: TemporalCoupling[];
  };
} => {
  const changes = new Map<string, Churn>();
  const sharedChanges = new Map<string, number>();
  const amplification: ChangeAmplification[] = [];
  const exclusions: MaintenanceRiskSurvey["exclusions"] = [];
  let couplingLimited = false;
  let pairObservationLimitReached = false;
  let pairObservations = 0;

  for (const historyCommit of commits) {
    if (historyCommit.parents.length > 1) {
      exclusions.push({ commit: historyCommit.commit, reason: "merge" });
      continue;
    }
    if (BULK_MECHANICAL_COMMIT.test(historyCommit.message)) {
      exclusions.push({
        commit: historyCommit.commit,
        reason: "bulk-mechanical",
      });
      continue;
    }

    const paths = [
      ...new Set(historyCommit.files.filter((path) => !isExcludedPath(path))),
    ].sort();
    if (paths.length === 0) continue;
    if (paths.length > limits.maxFilesPerCommit) {
      exclusions.push({
        commit: historyCommit.commit,
        reason: "huge-changeset",
      });
      continue;
    }

    amplification.push({
      commit: historyCommit.commit,
      date: historyCommit.date,
      filesChanged: paths.length,
      maxPairRecurrence: 0,
      pairRecurrenceStatus:
        paths.length > limits.maxCouplingFilesPerCommit
          ? "bounded"
          : "measured",
      paths,
      recurringPairs: 0,
      topLevelAreas: [...new Set(paths.map(topLevelArea))].sort(),
    });

    for (const path of paths) {
      const current = changes.get(path);
      changes.set(path, {
        changes: (current?.changes ?? 0) + 1,
        lastChanged: current?.lastChanged ?? historyCommit.date,
        path,
      });
    }

    if (paths.length > limits.maxCouplingFilesPerCommit) {
      couplingLimited = true;
      continue;
    }

    let pairLimitReached = false;
    for (let left = 0; left < paths.length; left += 1) {
      for (let right = left + 1; right < paths.length; right += 1) {
        if (pairObservations >= limits.maxPairObservations) {
          couplingLimited = true;
          pairObservationLimitReached = true;
          pairLimitReached = true;
          break;
        }
        const leftPath = paths[left];
        const rightPath = paths[right];
        if (!leftPath || !rightPath) continue;
        const pairKey = `${leftPath}\x00${rightPath}`;
        sharedChanges.set(pairKey, (sharedChanges.get(pairKey) ?? 0) + 1);
        pairObservations += 1;
      }
      if (pairLimitReached) break;
    }
  }

  const churn = [...changes.values()].sort(
    (left, right) =>
      right.changes - left.changes || left.path.localeCompare(right.path),
  );
  const temporalCoupling = [...sharedChanges.entries()]
    .map(([pairKey, count]): TemporalCoupling | undefined => {
      const [leftPath, rightPath] = pairKey.split("\x00");
      if (!leftPath || !rightPath) return undefined;
      const smallerChangeCount = Math.min(
        changes.get(leftPath)?.changes ?? 0,
        changes.get(rightPath)?.changes ?? 0,
      );
      return {
        confidence:
          smallerChangeCount === 0
            ? 0
            : Number((count / smallerChangeCount).toFixed(4)),
        paths: [leftPath, rightPath],
        sharedChanges: count,
      };
    })
    .filter((coupling): coupling is TemporalCoupling => coupling !== undefined)
    .sort(
      (left, right) =>
        right.sharedChanges - left.sharedChanges ||
        right.confidence - left.confidence ||
        left.paths.join("\x00").localeCompare(right.paths.join("\x00")),
    );
  if (temporalCoupling.length > limits.maxCouplingResults) {
    couplingLimited = true;
  }
  if (pairObservationLimitReached) {
    for (const change of amplification) {
      change.pairRecurrenceStatus = "bounded";
    }
  }
  for (const change of amplification) {
    if (change.pairRecurrenceStatus === "bounded") continue;
    for (let left = 0; left < change.paths.length; left += 1) {
      for (let right = left + 1; right < change.paths.length; right += 1) {
        const leftPath = change.paths[left];
        const rightPath = change.paths[right];
        if (!leftPath || !rightPath) continue;
        const recurrence =
          sharedChanges.get(`${leftPath}\x00${rightPath}`) ?? 0;
        if (recurrence > 1) change.recurringPairs += 1;
        change.maxPairRecurrence = Math.max(
          change.maxPairRecurrence,
          recurrence,
        );
      }
    }
  }

  return {
    amplificationLimited: amplification.some(
      ({ pairRecurrenceStatus }) => pairRecurrenceStatus === "bounded",
    ),
    couplingLimited,
    evidence: {
      changeAmplification: amplification.sort(
        (left, right) =>
          right.filesChanged - left.filesChanged ||
          right.date.localeCompare(left.date),
      ),
      churn,
      exclusions,
      temporalCoupling: temporalCoupling.slice(0, limits.maxCouplingResults),
    },
  };
};

const unavailableEvidence = <T>(): EvidenceSet<T> => ({
  items: [],
  provenance: [],
  status: "unavailable",
});

const gitProvenance = (
  command: string,
  toolVersion: string,
): EvidenceProvenance => ({
  analyzer: "git",
  command,
  evidenceStrength: { basis: "executed-analysis", level: 4 },
  source: command,
  toolVersion,
});

export const surveyMaintenanceRisk = async (
  options: SurveyOptions,
): Promise<MaintenanceRiskSurvey> => {
  const depth = DEPTHS[options.depth];
  const gitExecutable = options.gitExecutable ?? "git";
  const commandOptions = {
    cwd: options.repositoryPath,
    signal: options.signal,
    timeoutMs: depth.timeoutMs,
  };
  let survey: MaintenanceRiskSurvey;

  try {
    const toolVersion = (
      await runGit(gitExecutable, ["--version"], commandOptions)
    ).trim();
    const root = (
      await runGit(
        gitExecutable,
        ["rev-parse", "--show-toplevel"],
        commandOptions,
      )
    ).trim();
    const rootCommandOptions = { ...commandOptions, cwd: root };
    const head = (
      await runGit(gitExecutable, ["rev-parse", "HEAD"], rootCommandOptions)
    ).trim();
    const repositoryState = await readRepositoryState({
      gitExecutable,
      head,
      root,
      signal: options.signal,
      timeoutMs: depth.timeoutMs,
    });

    const history = await runGit(
      gitExecutable,
      [
        "log",
        `--max-count=${depth.commitLimit}`,
        "--date=iso-strict",
        "--find-renames",
        "--name-status",
        "-z",
        "--format=%x00H%x00%H%x00%aI%x00%s%x00%P%x00",
      ],
      rootCommandOptions,
    );
    const analysis = createEvidence(parseHistory(history), depth);
    const failures: Failure[] = [];
    if (analysis.couplingLimited) {
      failures.push({
        capability: "temporal-coupling",
        message: "Temporal coupling was bounded by the selected depth",
      });
    }
    if (analysis.amplificationLimited) {
      failures.push({
        capability: "change-amplification",
        message:
          "Recurring co-change measurements were bounded for some change-amplification observations",
      });
    }
    const historyProvenance = gitProvenance("git log --name-status", toolVersion);
    survey = {
      diagnostic: "maintenance-risk",
      evidence: {
        changeAmplification: {
          items: analysis.evidence.changeAmplification,
          provenance: [historyProvenance],
          status: analysis.amplificationLimited ? "partial" : "complete",
        },
        cognitiveComplexity: unavailableEvidence(),
        deadArchitecture: unavailableEvidence(),
        dependencyPathology: unavailableEvidence(),
        hotspots: unavailableEvidence(),
        temporalCoupling: {
          items: analysis.evidence.temporalCoupling,
          provenance: [historyProvenance],
          status:
            analysis.couplingLimited || analysis.amplificationLimited
              ? "partial"
              : "complete",
        },
      },
      exclusions: analysis.evidence.exclusions,
      failures,
      generatedAt: new Date().toISOString(),
      provenance: {
        capability: "git-history",
        commitLimit: depth.commitLimit,
        depth: options.depth,
        toolVersion,
      },
      repository: {
        dirty: repositoryState.dirty,
        head,
        root,
        stateId: repositoryState.stateId,
      },
      schemaVersion: 1,
      status:
        analysis.couplingLimited || analysis.amplificationLimited
          ? "partial"
          : "complete",
    };
  } catch (error) {
    if (
      error instanceof ProcessExecutionError &&
      error.kind === "cancelled"
    ) {
      throw error;
    }
    survey = {
      diagnostic: "maintenance-risk",
      evidence: {
        changeAmplification: unavailableEvidence(),
        cognitiveComplexity: unavailableEvidence(),
        deadArchitecture: unavailableEvidence(),
        dependencyPathology: unavailableEvidence(),
        hotspots: unavailableEvidence(),
        temporalCoupling: unavailableEvidence(),
      },
      exclusions: [],
      failures: [
        {
          capability: "git-history",
          message: `${gitExecutable} is not available or usable: ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
      ],
      generatedAt: new Date().toISOString(),
      provenance: {
        capability: "git-history",
        commitLimit: depth.commitLimit,
        depth: options.depth,
        toolVersion: "unavailable",
      },
      repository: {
        dirty: false,
        head: "unknown",
        root: resolve(options.repositoryPath),
        stateId: "unknown",
      },
      schemaVersion: 1,
      status: "partial",
    };
  }

  const staticEvidence = await collectStaticEvidence({
    analyzerAdapters:
      options.analyzerAdapters ??
      [createOmenAdapter(options.omenExecutable ?? "omen")],
    depth: options.depth,
    repositoryPath: survey.repository.root,
    signal: options.signal,
  });
  survey.evidence.cognitiveComplexity = staticEvidence.cognitiveComplexity;
  survey.evidence.deadArchitecture = staticEvidence.deadArchitecture;
  survey.evidence.dependencyPathology = staticEvidence.dependencyPathology;
  survey.evidence.hotspots = staticEvidence.hotspots;
  survey.failures.push(...staticEvidence.failures);
  if (
    Object.values(survey.evidence).some(
      ({ status }) => status !== "complete",
    )
  ) {
    survey.status = "partial";
  }

  if (options.outputPath) {
    if (isPathInsideRepository(survey.repository.root, options.outputPath)) {
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
        "Usage: npm run maintenance-risk:survey -- --repo <path> --depth <quick|standard|deep> --output <path>",
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

  return {
    depth,
    outputPath,
    repositoryPath,
  };
};

if (require.main === module) {
  const options = parseArguments(process.argv.slice(2));
  surveyMaintenanceRisk(options)
    .then((result) => {
      process.stdout.write(
        `${JSON.stringify(
          {
            failures: result.failures,
            hotspotCount: result.evidence.hotspots.items.length,
            outputPath: resolve(options.outputPath ?? ""),
            status: result.status,
            temporalCouplingCount:
              result.evidence.temporalCoupling.items.length,
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
