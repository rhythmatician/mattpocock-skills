import { createHash } from "node:crypto";
import { existsSync, lstatSync, readlinkSync } from "node:fs";
import { resolve } from "node:path";

import { runGit } from "./git.ts";

export const readRepositoryState = async (options: {
  gitExecutable: string;
  head: string;
  root: string;
  signal?: AbortSignal;
  timeoutMs: number;
}) => {
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
  const regularDirtyPaths: string[] = [];

  for (const path of [...new Set([...trackedPaths, ...untrackedPaths])].sort()) {
    stateHash.update("\x00").update(path).update("\x00");
    const absolutePath = resolve(options.root, path);
    if (!existsSync(absolutePath)) {
      stateHash.update("missing");
      continue;
    }
    const fileStatus = lstatSync(absolutePath);
    if (fileStatus.isSymbolicLink()) {
      stateHash.update("symlink:").update(readlinkSync(absolutePath));
    } else if (fileStatus.isFile()) {
      regularDirtyPaths.push(path);
    } else {
      stateHash.update(`special:${fileStatus.mode}:${fileStatus.size}`);
    }
  }

  for (let index = 0; index < regularDirtyPaths.length; index += 100) {
    const paths = regularDirtyPaths.slice(index, index + 100);
    stateHash.update(
      await runGit(
        options.gitExecutable,
        ["hash-object", "--no-filters", "--", ...paths],
        commandOptions,
      ),
    );
  }

  return {
    dirty: status.length > 0,
    stateId: stateHash.digest("hex"),
  };
};
