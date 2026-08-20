import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

import { ProcessExecutionError, runProcess } from "./process.ts";

export type AnalysisDepth = "quick" | "standard" | "deep";

type SurveyOptions = {
  depth: AnalysisDepth;
  gitExecutable?: string;
  outputPath?: string;
  repositoryPath: string;
  signal?: AbortSignal;
};

type Failure = {
  capability: "git-history";
  message: string;
};

type Hotspot = {
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
  paths: string[];
};

export type MaintenanceRiskSurvey = {
  evidence: {
    changeAmplification: ChangeAmplification[];
    exclusions: Array<{
      commit: string;
      reason: "bulk-mechanical" | "huge-changeset" | "merge";
    }>;
    hotspots: Hotspot[];
    temporalCoupling: TemporalCoupling[];
  };
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
  { commitLimit: number; maxFilesPerCommit: number; timeoutMs: number }
> = {
  quick: { commitLimit: 50, maxFilesPerCommit: 200, timeoutMs: 5_000 },
  standard: { commitLimit: 250, maxFilesPerCommit: 500, timeoutMs: 20_000 },
  deep: { commitLimit: 1_000, maxFilesPerCommit: 2_000, timeoutMs: 60_000 },
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

const runGit = async (
  executable: string,
  args: string[],
  options: {
    cwd: string;
    signal?: AbortSignal;
    timeoutMs: number;
  },
) => {
  const result = await runProcess({
    args,
    cwd: options.cwd,
    executable,
    maxOutputBytes: 8 * 1024 * 1024,
    signal: options.signal,
    timeoutMs: options.timeoutMs,
  });
  if (result.exitCode !== 0) {
    throw new Error(
      result.stderr.trim() ||
        `Git exited with code ${result.exitCode ?? "unknown"}`,
    );
  }
  return result.stdout;
};

const parseHistory = (output: string): HistoryCommit[] =>
  output
    .split("\x1e")
    .map((record) => record.trim())
    .filter(Boolean)
    .flatMap((record) => {
      const [header, ...fileLines] = record.split(/\r?\n/);
      if (!header) return [];
      const [commit, date, message, parents = ""] = header.split("\x1f");
      if (!commit || !date || message === undefined) return [];

      const files = fileLines.flatMap((line) => {
        const fields = line.split("\t");
        const status = fields[0];
        if (!status) return [];
        if (status.startsWith("R") && fields[2]) return [fields[2]];
        return fields[1] ? [fields[1]] : [];
      });

      return [
        {
          commit,
          date,
          files,
          message,
          parents: parents.split(" ").filter(Boolean),
        },
      ];
    });

const isExcludedPath = (path: string) =>
  EXCLUDED_PATHS.some((pattern) => pattern.test(path.replaceAll("\\", "/")));

const createEvidence = (
  commits: HistoryCommit[],
  maxFilesPerCommit: number,
): MaintenanceRiskSurvey["evidence"] => {
  const changes = new Map<string, Hotspot>();
  const sharedChanges = new Map<string, number>();
  const amplification: ChangeAmplification[] = [];
  const exclusions: MaintenanceRiskSurvey["evidence"]["exclusions"] = [];

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
    if (paths.length > maxFilesPerCommit) {
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
      paths,
    });

    for (const path of paths) {
      const current = changes.get(path);
      changes.set(path, {
        changes: (current?.changes ?? 0) + 1,
        lastChanged: current?.lastChanged ?? historyCommit.date,
        path,
      });
    }

    for (let left = 0; left < paths.length; left += 1) {
      for (let right = left + 1; right < paths.length; right += 1) {
        const leftPath = paths[left];
        const rightPath = paths[right];
        if (!leftPath || !rightPath) continue;
        const pairKey = `${leftPath}\x00${rightPath}`;
        sharedChanges.set(pairKey, (sharedChanges.get(pairKey) ?? 0) + 1);
      }
    }
  }

  const hotspots = [...changes.values()].sort(
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

  return {
    changeAmplification: amplification.sort(
      (left, right) =>
        right.filesChanged - left.filesChanged ||
        right.date.localeCompare(left.date),
    ),
    exclusions,
    hotspots,
    temporalCoupling,
  };
};

const writeEvidence = (outputPath: string, survey: MaintenanceRiskSurvey) => {
  const absolutePath = resolve(outputPath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  const temporaryPath = `${absolutePath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(survey, null, 2)}\n`);
  try {
    renameSync(temporaryPath, absolutePath);
  } catch (error) {
    try {
      unlinkSync(temporaryPath);
    } catch {
      // The original write error is more useful than cleanup failure.
    }
    throw error;
  }
};

const emptyEvidence = (): MaintenanceRiskSurvey["evidence"] => ({
  changeAmplification: [],
  exclusions: [],
  hotspots: [],
  temporalCoupling: [],
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
    const status = await runGit(
      gitExecutable,
      ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
      rootCommandOptions,
    );
    const trackedDiff = await runGit(
      gitExecutable,
      ["diff", "--binary", "HEAD"],
      rootCommandOptions,
    );
    const untrackedPaths = (
      await runGit(
        gitExecutable,
        ["ls-files", "--others", "--exclude-standard", "-z"],
        rootCommandOptions,
      )
    )
      .split("\x00")
      .filter(Boolean);
    const stateHash = createHash("sha256")
      .update(head)
      .update("\x00")
      .update(status)
      .update("\x00")
      .update(trackedDiff);
    for (const path of untrackedPaths.sort()) {
      stateHash.update("\x00").update(path).update("\x00");
      stateHash.update(readFileSync(resolve(root, path)));
    }

    const history = await runGit(
      gitExecutable,
      [
        "log",
        `--max-count=${depth.commitLimit}`,
        "--date=iso-strict",
        "--find-renames",
        "--name-status",
        "--format=%x1e%H%x1f%aI%x1f%s%x1f%P",
      ],
      rootCommandOptions,
    );
    survey = {
      evidence: createEvidence(parseHistory(history), depth.maxFilesPerCommit),
      failures: [],
      generatedAt: new Date().toISOString(),
      provenance: {
        capability: "git-history",
        commitLimit: depth.commitLimit,
        depth: options.depth,
        toolVersion,
      },
      repository: {
        dirty: status.length > 0,
        head,
        root,
        stateId: stateHash.digest("hex"),
      },
      status: "complete",
    };
  } catch (error) {
    if (
      error instanceof ProcessExecutionError &&
      error.kind === "cancelled"
    ) {
      throw error;
    }
    survey = {
      evidence: emptyEvidence(),
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
      status: "partial",
    };
  }

  if (options.outputPath) writeEvidence(options.outputPath, survey);
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
            hotspotCount: result.evidence.hotspots.length,
            outputPath: resolve(options.outputPath ?? ""),
            status: result.status,
            temporalCouplingCount: result.evidence.temporalCoupling.length,
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
