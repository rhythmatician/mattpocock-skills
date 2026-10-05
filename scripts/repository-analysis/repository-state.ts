import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  readlinkSync,
} from "node:fs";
import { join, resolve } from "node:path";

import { runGit } from "./git.ts";

export type RepositoryStateChange = {
  fingerprint: string;
  path: string;
  status: string;
};

type RepositoryStateOptions = {
  gitExecutable: string;
  head: string;
  includeIgnored?: boolean;
  root: string;
  signal?: AbortSignal;
  timeoutMs: number;
};

export type RepositoryIdentity = {
  changes: RepositoryStateChange[];
  coverageGaps: Array<{ capability: "ignored-residue-scan"; reason: string }>;
  dirty: boolean;
  head: string;
  stateId: string;
};

const IGNORED_TREE_ENTRY_LIMIT = 2_000;
const IGNORED_TREE_BYTE_LIMIT = 16 * 1024 * 1024;
const SKIPPED_IGNORED_TREES = new Set([
  ".git",
  ".venv",
  "node_modules",
  "target",
  "vendor",
]);

const fingerprintIgnoredTree = (root: string, repositoryPath: string) => {
  const treeName = repositoryPath
    .replace(/[\\/]$/, "")
    .split(/[\\/]/)
    .at(-1);
  const treeHash = createHash("sha256").update(repositoryPath);
  if (treeName && SKIPPED_IGNORED_TREES.has(treeName)) {
    return {
      fingerprint: `tree:${treeHash.update(":skipped").digest("hex")}`,
      gap: {
        capability: "ignored-residue-scan" as const,
        reason: `Ignored tree ${repositoryPath} was not traversed because dependency-scale trees are excluded`,
      },
    };
  }

  const pending = [{ absolutePath: resolve(root, repositoryPath), path: "" }];
  let bytes = 0;
  let entries = 0;
  try {
    while (pending.length > 0) {
      const directory = pending.pop()!;
      for (const entry of readdirSync(directory.absolutePath, {
        withFileTypes: true,
      }).sort((left, right) => left.name.localeCompare(right.name))) {
        entries += 1;
        if (entries > IGNORED_TREE_ENTRY_LIMIT) {
          return {
            fingerprint: `tree:${treeHash.update(":entry-limit").digest("hex")}`,
            gap: {
              capability: "ignored-residue-scan" as const,
              reason: `Ignored tree ${repositoryPath} exceeded the ${IGNORED_TREE_ENTRY_LIMIT} entry residue limit`,
            },
          };
        }
        const path = directory.path
          ? `${directory.path}/${entry.name}`
          : entry.name;
        const absolutePath = join(directory.absolutePath, entry.name);
        const status = lstatSync(absolutePath);
        treeHash.update("\x00").update(path).update("\x00");
        if (entry.isSymbolicLink()) {
          treeHash.update(`symlink:${readlinkSync(absolutePath)}`);
        } else if (entry.isDirectory()) {
          treeHash.update("directory");
          pending.push({ absolutePath, path });
        } else if (entry.isFile()) {
          bytes += status.size;
          treeHash.update(`file:${status.size}:`);
          if (bytes > IGNORED_TREE_BYTE_LIMIT) {
            return {
              fingerprint: `tree:${treeHash.update(":byte-limit").digest("hex")}`,
              gap: {
                capability: "ignored-residue-scan" as const,
                reason: `Ignored tree ${repositoryPath} exceeded the ${IGNORED_TREE_BYTE_LIMIT} byte residue limit`,
              },
            };
          }
          treeHash.update(readFileSync(absolutePath));
        } else {
          treeHash.update(`special:${status.mode}:${status.size}`);
        }
      }
    }
    return { fingerprint: `tree:${treeHash.digest("hex")}` };
  } catch (error) {
    return {
      fingerprint: `tree:${treeHash.update(":unavailable").digest("hex")}`,
      gap: {
        capability: "ignored-residue-scan" as const,
        reason: `Ignored tree ${repositoryPath} could not be fingerprinted: ${
          error instanceof Error ? error.message : String(error)
        }`,
      },
    };
  }
};

const parseStatusByPath = (status: string) => {
  const statuses = new Map<string, string>();
  const entries = status.split("\x00");
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!entry) continue;
    const code = entry.slice(0, 2);
    const path = entry.slice(3);
    statuses.set(path, code);
    if (/[RC]/.test(code)) index += 1;
  }
  return statuses;
};

export const readRepositoryStateSnapshot = async (
  options: RepositoryStateOptions,
) => {
  const commandOptions = {
    cwd: options.root,
    signal: options.signal,
    timeoutMs: options.timeoutMs,
  };
  const status = await runGit(
    options.gitExecutable,
    ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    commandOptions,
  );
  const ignoredStatus = options.includeIgnored
    ? await runGit(
        options.gitExecutable,
        [
          "status",
          "--porcelain=v1",
          "-z",
          "--untracked-files=all",
          "--ignored=matching",
        ],
        commandOptions,
      )
    : "";
  const trackedPaths = (
    await runGit(
      options.gitExecutable,
      ["diff", "--name-only", "-z", "HEAD"],
      commandOptions,
    )
  )
    .split("\x00")
    .filter(Boolean);
  const untrackedPaths = (
    await runGit(
      options.gitExecutable,
      ["ls-files", "--others", "--exclude-standard", "-z"],
      commandOptions,
    )
  )
    .split("\x00")
    .filter(Boolean);
  const stateHash = createHash("sha256")
    .update(options.head)
    .update("\x00")
    .update(status);
  const statusByPath = parseStatusByPath(status);
  const ignoredStatusByPath = parseStatusByPath(ignoredStatus);
  const untrackedPathSet = new Set(untrackedPaths);
  const changes = new Map<string, RepositoryStateChange>();
  const coverageGaps: RepositoryIdentity["coverageGaps"] = [];
  const regularDirtyPaths: Array<{ ignored: boolean; path: string }> = [];
  const ignoredPaths = options.includeIgnored
    ? [...ignoredStatusByPath.entries()]
        .filter(([, statusCode]) => statusCode === "!!")
        .map(([path]) => path)
    : [];

  for (const path of [
    ...new Set([...trackedPaths, ...untrackedPaths, ...ignoredPaths]),
  ].sort()) {
    const ignored = ignoredStatusByPath.get(path) === "!!";
    if (!ignored) stateHash.update("\x00").update(path).update("\x00");
    const absolutePath = resolve(options.root, path);
    const statusCode =
      statusByPath.get(path) ??
      ignoredStatusByPath.get(path) ??
      (untrackedPathSet.has(path) ? "??" : "tracked");
    if (!existsSync(absolutePath)) {
      if (!ignored) stateHash.update("missing");
      changes.set(path, { fingerprint: "missing", path, status: statusCode });
      continue;
    }
    const fileStatus = lstatSync(absolutePath);
    if (fileStatus.isSymbolicLink()) {
      const fingerprint = `symlink:${readlinkSync(absolutePath)}`;
      if (!ignored) stateHash.update(fingerprint);
      changes.set(path, { fingerprint, path, status: statusCode });
    } else if (fileStatus.isFile()) {
      regularDirtyPaths.push({ ignored, path });
    } else if (fileStatus.isDirectory() && ignored) {
      const tree = fingerprintIgnoredTree(options.root, path);
      changes.set(path, {
        fingerprint: tree.fingerprint,
        path,
        status: statusCode,
      });
      if (tree.gap) coverageGaps.push(tree.gap);
    } else {
      const fingerprint = `special:${fileStatus.mode}:${fileStatus.size}`;
      if (!ignored) stateHash.update(fingerprint);
      changes.set(path, { fingerprint, path, status: statusCode });
    }
  }

  for (let index = 0; index < regularDirtyPaths.length; index += 100) {
    const pathEntries = regularDirtyPaths.slice(index, index + 100);
    const paths = pathEntries.map(({ path }) => path);
    const hashOutput = await runGit(
      options.gitExecutable,
      ["hash-object", "--no-filters", "--", ...paths],
      commandOptions,
    );
    const hashes = hashOutput.trim().split(/\r?\n/);
    if (pathEntries.every(({ ignored }) => !ignored)) {
      stateHash.update(hashOutput);
    } else {
      pathEntries.forEach(({ ignored }, pathIndex) => {
        if (!ignored) stateHash.update(`${hashes[pathIndex] ?? "unknown"}\n`);
      });
    }
    paths.forEach((path, pathIndex) =>
      changes.set(path, {
        fingerprint: `blob:${hashes[pathIndex] ?? "unknown"}`,
        path,
        status:
          statusByPath.get(path) ??
          ignoredStatusByPath.get(path) ??
          (untrackedPathSet.has(path) ? "??" : "tracked"),
      }),
    );
  }

  return {
    changes: [...changes.values()].sort((left, right) =>
      left.path.localeCompare(right.path),
    ),
    coverageGaps,
    dirty: status.length > 0,
    stateId: stateHash.digest("hex"),
  };
};

export const readRepositoryState = async (options: RepositoryStateOptions) => {
  const { dirty, stateId } = await readRepositoryStateSnapshot(options);
  return { dirty, stateId };
};

export const readRepositoryIdentity = async (
  options: Omit<RepositoryStateOptions, "head">,
): Promise<RepositoryIdentity> => {
  const head = (
    await runGit(options.gitExecutable, ["rev-parse", "HEAD"], {
      cwd: options.root,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    })
  ).trim();
  return {
    ...(await readRepositoryStateSnapshot({ ...options, head })),
    head,
  };
};

export const compareRepositoryStateChanges = (
  before: RepositoryIdentity,
  after: RepositoryIdentity,
) => {
  const beforeByPath = new Map(
    before.changes.map((change) => [change.path, change]),
  );
  const afterByPath = new Map(
    after.changes.map((change) => [change.path, change]),
  );
  return [...new Set([...beforeByPath.keys(), ...afterByPath.keys()])]
    .sort()
    .flatMap((path) => {
      const previous = beforeByPath.get(path);
      const current = afterByPath.get(path);
      if (JSON.stringify(previous) === JSON.stringify(current)) return [];
      return [{ after: current ?? null, before: previous ?? null, path }];
    });
};
