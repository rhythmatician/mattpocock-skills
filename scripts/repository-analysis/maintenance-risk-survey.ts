import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

export type AnalysisDepth = "quick" | "standard" | "deep";

type ProcessResult = {
  exitCode: number | null;
  stderr: string;
  stdout: string;
};

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

const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

const runProcess = async (
  executable: string,
  args: string[],
  options: {
    cwd: string;
    signal?: AbortSignal;
    timeoutMs: number;
  },
): Promise<ProcessResult> =>
  new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      shell: false,
      signal: options.signal,
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;

    const finish = (result: ProcessResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolvePromise(result);
    };

    const collect = (chunks: Buffer[], chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_OUTPUT_BYTES) {
        child.kill();
        rejectPromise(
          new Error(
            `Git output exceeded ${MAX_OUTPUT_BYTES} bytes; use a shallower depth`,
          ),
        );
        return;
      }
      chunks.push(chunk);
    };

    child.stdout.on("data", (chunk: Buffer) => collect(stdout, chunk));
    child.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk));
    child.on("error", (error) => {
      clearTimeout(timeout);
      if (settled) return;
      settled = true;
      rejectPromise(error);
    });
    child.on("close", (exitCode) =>
      finish({
        exitCode,
        stderr: Buffer.concat(stderr).toString("utf8"),
        stdout: Buffer.concat(stdout).toString("utf8"),
      }),
    );

    const timeout = setTimeout(() => {
      child.kill();
      rejectPromise(
        new Error(`Git command timed out after ${options.timeoutMs}ms`),
      );
    }, options.timeoutMs);
  });

const runGit = async (
  executable: string,
  args: string[],
  options: {
    cwd: string;
    signal?: AbortSignal;
    timeoutMs: number;
  },
) => {
  const result = await runProcess(executable, args, options);
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

  for (const historyCommit of commits) {
    if (historyCommit.parents.length > 1) continue;

    const paths = [
      ...new Set(historyCommit.files.filter((path) => !isExcludedPath(path))),
    ].sort();
    if (paths.length === 0 || paths.length > maxFilesPerCommit) continue;

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
    const survey: MaintenanceRiskSurvey = {
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

    if (options.outputPath) writeEvidence(options.outputPath, survey);
    return survey;
  } catch (error) {
    return {
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
};

const parseArguments = (args: string[]): SurveyOptions => {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || !value) {
      throw new Error(
        "Usage: npm run maintenance-risk:survey -- --repo <path> --depth <quick|standard|deep> [--output <path>]",
      );
    }
    values.set(key, value);
  }

  const repositoryPath = values.get("--repo");
  const depth = values.get("--depth");
  if (
    !repositoryPath ||
    (depth !== "quick" && depth !== "standard" && depth !== "deep")
  ) {
    throw new Error(
      "Both --repo and --depth <quick|standard|deep> are required",
    );
  }

  return {
    depth,
    outputPath: values.get("--output"),
    repositoryPath,
  };
};

if (require.main === module) {
  surveyMaintenanceRisk(parseArguments(process.argv.slice(2)))
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      process.exitCode = result.status === "complete" ? 0 : 2;
    })
    .catch((error) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    });
}
