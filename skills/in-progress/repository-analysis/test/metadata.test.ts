import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { detectEcosystems } from "../ecosystem.js";
import { readGitMetadata } from "../git.js";
import { createNormalizedReport, createReportMetadata } from "../report.js";
import { probeTool } from "../tools.js";

test("makes a missing optional analyzer visible without throwing", async () => {
  const result = await probeTool({ command: "not-a-real-analyzer-command" });

  assert.equal(result.available, false);
  assert.equal(result.version, null);
  assert.equal(result.result.kind, "spawn-error");
});

test("returns partial Git metadata when a repository cannot supply it", async () => {
  const metadata = await readGitMetadata(".", async () => ({
    exitCode: null,
    kind: "spawn-error",
    stderr: "git unavailable",
    stdout: "",
  }));

  assert.deepEqual(metadata, { dirtyWorktree: null, repositoryCommit: null });
});

test("creates common report metadata with supplied provenance", () => {
  const metadata = createReportMetadata({
    analysisVersion: "1",
    generatedAt: "2026-08-19T00:00:00.000Z",
    git: { dirtyWorktree: true, repositoryCommit: "abc123" },
    toolVersions: { git: "2.50.0" },
  });

  assert.deepEqual(metadata, {
    analysisVersion: "1",
    dirtyWorktree: true,
    generatedAt: "2026-08-19T00:00:00.000Z",
    repositoryCommit: "abc123",
    toolVersions: { git: "2.50.0" },
  });
});

test("detects applicable ecosystems from target repository manifests", async () => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "repository-analysis-"));
  await writeFile(join(repositoryRoot, "package.json"), "{}", "utf8");
  await writeFile(join(repositoryRoot, "pyproject.toml"), "", "utf8");

  assert.deepEqual(await detectEcosystems(repositoryRoot), ["node", "python"]);
});

test("detects a .NET repository from a solution or project file", async () => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "repository-analysis-"));
  await writeFile(join(repositoryRoot, "app.csproj"), "<Project />", "utf8");

  assert.deepEqual(await detectEcosystems(repositoryRoot), ["dotnet"]);
});

test("keeps normalized evidence and partial failures in separate report fields", () => {
  const report = createNormalizedReport(
    {
      analysisVersion: "1",
      dirtyWorktree: false,
      generatedAt: "2026-08-19T00:00:00.000Z",
      repositoryCommit: "abc123",
      toolVersions: {},
    },
    [
      {
        kind: "evidence" as const,
        provenance: { adapter: "a", capability: "c", tool: "t" },
        value: { files: [] },
      },
      {
        error: { kind: "invalid-json" as const, message: "bad" },
        kind: "error" as const,
        provenance: { adapter: "a", capability: "c", tool: "t" },
      },
    ],
  );

  assert.equal(report.evidence.length, 1);
  assert.equal(report.partialFailures.length, 1);
});