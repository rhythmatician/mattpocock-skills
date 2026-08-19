import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { hasAnyPath } from "./markers.js";

export type AnalysisDepth = "quick" | "standard" | "deep";

export interface AnalysisSession {
  readonly artifactDirectory: string;
  readonly depth: AnalysisDepth;
  readonly repositoryRoot: string;
  readonly temporaryDirectory: string;
}

export interface CreateAnalysisSessionOptions {
  readonly depth?: AnalysisDepth;
  readonly target: string;
}

export async function createAnalysisSession(
  options: CreateAnalysisSessionOptions,
): Promise<AnalysisSession> {
  const repositoryRoot = await findRepositoryRoot(options.target);
  const repositoryKey = createHash("sha256")
    .update(repositoryRoot)
    .digest("hex")
    .slice(0, 16);
  const artifactDirectory = join(
    tmpdir(),
    "mattpocock-skills-analysis",
    repositoryKey,
  );

  return {
    artifactDirectory,
    depth: options.depth ?? "quick",
    repositoryRoot,
    temporaryDirectory: join(artifactDirectory, "tmp"),
  };
}

async function findRepositoryRoot(target: string): Promise<string> {
  const resolvedTarget = resolve(target);
  const targetStats = await stat(resolvedTarget);
  let currentDirectory = targetStats.isDirectory()
    ? resolvedTarget
    : dirname(resolvedTarget);
  let projectRoot: string | undefined;

  while (true) {
    if (await hasVcsMarker(currentDirectory)) {
      return currentDirectory;
    }
    if (!projectRoot && (await hasProjectMarker(currentDirectory))) {
      projectRoot = currentDirectory;
    }

    const parentDirectory = dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      return projectRoot ?? (targetStats.isDirectory() ? resolvedTarget : dirname(resolvedTarget));
    }
    currentDirectory = parentDirectory;
  }
}

async function hasVcsMarker(directory: string): Promise<boolean> {
  return hasAnyPath(directory, [".git", ".hg"]);
}

async function hasProjectMarker(directory: string): Promise<boolean> {
  return hasAnyPath(directory, ["package.json", "pyproject.toml", "Cargo.toml"]);
}