import assert from "node:assert/strict";
import { mkdtemp, mkdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createAnalysisSession } from "../analysis.js";
import {
  cleanupTemporaryArtifacts,
  createCacheKey,
  readCachedJson,
  writeCachedJson,
  temporaryDirectoryFor,
} from "../artifacts.js";

test("changes cache keys when repository or tool provenance changes", () => {
  const baseline = createCacheKey({
    adapter: "dependency-graph",
    analysisVersion: "1",
    dirtyWorktree: false,
    input: { root: "/repo" },
    repositoryCommit: "one",
    toolVersion: "1.0",
  });
  const changedCommit = createCacheKey({
    adapter: "dependency-graph",
    analysisVersion: "1",
    dirtyWorktree: false,
    input: { root: "/repo" },
    repositoryCommit: "two",
    toolVersion: "1.0",
  });

  assert.notEqual(baseline, changedCommit);
});

test("keeps reusable cache outside the target and removes only temporary artifacts", async () => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "repository-analysis-"));
  await mkdir(join(repositoryRoot, ".git"));
  const session = await createAnalysisSession({ target: repositoryRoot });
  const temporaryDirectory = temporaryDirectoryFor(session, "cache-test");

  await writeCachedJson(session, "dependency-graph", { nodes: 3 });
  await mkdir(temporaryDirectory, { recursive: true });
  await cleanupTemporaryArtifacts(session, "cache-test");

  assert.deepEqual(await readCachedJson(session, "dependency-graph"), { nodes: 3 });
  await assert.rejects(stat(temporaryDirectory));
  await assert.rejects(stat(join(repositoryRoot, ".analysis-artifacts")));
});

test("cleans only the temporary artifacts owned by one cooperating diagnostic", async () => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "repository-analysis-"));
  await mkdir(join(repositoryRoot, ".git"));
  const session = await createAnalysisSession({ target: repositoryRoot });
  const firstDirectory = temporaryDirectoryFor(session, "first");
  const secondDirectory = temporaryDirectoryFor(session, "second");
  await mkdir(firstDirectory, { recursive: true });
  await mkdir(secondDirectory, { recursive: true });

  await cleanupTemporaryArtifacts(session, "first");

  await assert.rejects(stat(firstDirectory));
  await stat(secondDirectory);
});