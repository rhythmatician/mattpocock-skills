import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { AnalysisSession } from "./analysis.js";

export interface CacheKeyInput {
  readonly adapter: string;
  readonly analysisVersion: string;
  readonly dirtyWorktree: boolean | null;
  readonly input: unknown;
  readonly repositoryCommit: string | null;
  readonly toolVersion: string | null;
}

export function createCacheKey(input: CacheKeyInput): string {
  return createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex");
}

export async function readCachedJson<T>(
  session: AnalysisSession,
  key: string,
): Promise<T | null> {
  try {
    const source = await readFile(cachePath(session, key), "utf8");
    return JSON.parse(source) as T;
  } catch (error) {
    if (isMissingFile(error)) {
      return null;
    }
    throw error;
  }
}

export async function writeCachedJson(
  session: AnalysisSession,
  key: string,
  value: unknown,
): Promise<void> {
  const path = cachePath(session, key);
  await mkdir(join(session.artifactDirectory, "cache"), { recursive: true });
  await writeFile(path, `${JSON.stringify(value)}\n`, "utf8");
}

export async function cleanupTemporaryArtifacts(
  session: AnalysisSession,
  owner: string,
): Promise<void> {
  await rm(temporaryDirectoryFor(session, owner), { force: true, recursive: true });
}

export function temporaryDirectoryFor(
  session: AnalysisSession,
  owner: string,
): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(owner)) {
    throw new Error("Temporary artifact owners may contain only letters, numbers, hyphens, and underscores.");
  }
  return join(session.temporaryDirectory, owner);
}

function cachePath(session: AnalysisSession, key: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(key)) {
    throw new Error("Artifact keys may contain only letters, numbers, hyphens, and underscores.");
  }
  return join(session.artifactDirectory, "cache", `${key}.json`);
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}