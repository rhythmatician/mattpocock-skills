import type { CommandExecutor } from "./git.js";
import { runCommand } from "./runner.js";

export interface HistoryRecord {
  readonly files: readonly string[];
  readonly hash: string;
  readonly isMerge: boolean;
  readonly isRename?: boolean;
}

export interface HistoryFilterOptions {
  readonly excludeMerges?: boolean;
  readonly excludeRenames?: boolean;
  readonly excludedCommitHashes?: readonly string[];
  readonly excludedPathPatterns?: readonly RegExp[];
  readonly maxChangedFiles?: number;
}

export interface HistoryFilterResult {
  readonly excluded: readonly { readonly hash: string; readonly reason: string }[];
  readonly included: readonly HistoryRecord[];
}

const COMMON_EXCLUDED_PATHS = [
  /(^|\/)node_modules(\/|$)/,
  /(^|\/)(vendor|dist|build)(\/|$)/,
  /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock)$/,
];

export function filterHistory(
  records: readonly HistoryRecord[],
  options: HistoryFilterOptions = {},
): HistoryFilterResult {
  const excluded: { hash: string; reason: string }[] = [];
  const included: HistoryRecord[] = [];

  for (const record of records) {
    const reason = exclusionReason(record, options);
    if (reason) {
      excluded.push({ hash: record.hash, reason });
    } else {
      included.push(record);
    }
  }
  return { excluded, included };
}

function exclusionReason(
  record: HistoryRecord,
  options: HistoryFilterOptions,
): string | undefined {
  if (options.excludedCommitHashes?.includes(record.hash)) {
    return "excluded-commit";
  }
  if (options.excludeMerges && record.isMerge) {
    return "merge";
  }
  if (options.excludeRenames && record.isRename) {
    return "rename";
  }
  if (
    options.maxChangedFiles !== undefined &&
    record.files.length > options.maxChangedFiles
  ) {
    return "changed-file-limit";
  }
  const patterns = [...COMMON_EXCLUDED_PATHS, ...(options.excludedPathPatterns ?? [])];
  if (record.files.length > 0 && record.files.every((file) => patterns.some((pattern) => pattern.test(file)))) {
    return "excluded-path";
  }
  return undefined;
}

export async function readGitHistory(
  repositoryRoot: string,
  execute: CommandExecutor = runCommand,
): Promise<readonly HistoryRecord[] | null> {
  const result = await execute({
    arguments: ["log", "-z", "--format=%x1e%H%x1f%P%x00", "--name-status"],
    command: "git",
    cwd: repositoryRoot,
  });
  return result.kind === "success" ? parseGitHistory(result.stdout) : null;
}

function parseGitHistory(source: string): HistoryRecord[] {
  return source
    .split("\u001e")
    .filter((record) => record.length > 0)
    .map((record) => {
      const [header, ...tokens] = record.split("\u0000");
      const [hash, parents] = header.split("\u001f");
      const files: string[] = [];
      let isRename = false;

      for (let index = 0; index < tokens.length; index += 1) {
        const status = tokens[index];
        if (!status) {
          continue;
        }
        if (status.startsWith("R") || status.startsWith("C")) {
          isRename ||= status.startsWith("R");
          index += 2;
          files.push(tokens[index]);
        } else {
          index += 1;
          files.push(tokens[index]);
        }
      }

      return {
        files,
        hash,
        isMerge: (parents ?? "").trim().split(/\s+/).filter(Boolean).length > 1,
        isRename,
      };
    });
}