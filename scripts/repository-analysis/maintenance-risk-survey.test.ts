import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { surveyMaintenanceRisk } from "./maintenance-risk-survey.ts";

const git = (repositoryPath: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd: repositoryPath,
    encoding: "utf8",
    stdio: "pipe",
  });

const commit = (
  repositoryPath: string,
  message: string,
  timestamp: string,
) => {
  git(repositoryPath, "add", ".");
  execFileSync("git", ["commit", "-m", message], {
    cwd: repositoryPath,
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: timestamp,
      GIT_COMMITTER_DATE: timestamp,
    },
    stdio: "pipe",
  });
};

const createRepository = () => {
  const repositoryPath = mkdtempSync(join(tmpdir(), "maintenance-risk-"));
  git(repositoryPath, "init");
  git(repositoryPath, "config", "user.email", "tests@example.com");
  git(repositoryPath, "config", "user.name", "Tests");

  writeFileSync(join(repositoryPath, "a.ts"), "export const a = 1;\n");
  writeFileSync(join(repositoryPath, "b.ts"), "export const b = 1;\n");
  writeFileSync(join(repositoryPath, "package-lock.json"), "{}\n");
  commit(repositoryPath, "initial", "2026-01-01T00:00:00Z");

  writeFileSync(join(repositoryPath, "a.ts"), "export const a = 2;\n");
  writeFileSync(join(repositoryPath, "b.ts"), "export const b = 2;\n");
  writeFileSync(join(repositoryPath, "package-lock.json"), '{"lockfileVersion":3}\n');
  commit(repositoryPath, "change pair", "2026-01-02T00:00:00Z");

  writeFileSync(join(repositoryPath, "a.ts"), "export const a = 3;\n");
  writeFileSync(join(repositoryPath, "b.ts"), "export const b = 3;\n");
  commit(repositoryPath, "change pair again", "2026-01-03T00:00:00Z");

  return repositoryPath;
};

test("surveys maintenance risk through measured repository history", async () => {
  const repositoryPath = createRepository();
  const outputPath = join(repositoryPath, ".evidence", "maintenance-risk.json");

  const result = await surveyMaintenanceRisk({
    repositoryPath,
    depth: "quick",
    outputPath,
  });

  assert.equal(result.status, "complete");
  assert.equal(result.provenance.capability, "git-history");
  assert.equal(result.provenance.depth, "quick");
  assert.equal(result.provenance.commitLimit, 50);
  assert.match(result.provenance.toolVersion, /^git version /);
  assert.equal(result.repository.head.length, 40);
  assert.equal(result.repository.dirty, false);

  assert.deepEqual(
    result.evidence.hotspots.slice(0, 2).map(({ path, changes }) => ({
      path,
      changes,
    })),
    [
      { path: "a.ts", changes: 3 },
      { path: "b.ts", changes: 3 },
    ],
  );
  assert.equal(
    result.evidence.hotspots.find(({ path }) => path === "a.ts")?.lastChanged,
    "2026-01-03T00:00:00Z",
  );
  assert.deepEqual(result.evidence.temporalCoupling[0], {
    paths: ["a.ts", "b.ts"],
    sharedChanges: 3,
    confidence: 1,
  });
  assert.equal(
    result.evidence.hotspots.some(({ path }) => path === "package-lock.json"),
    false,
  );
  assert.equal(result.evidence.changeAmplification[0]?.filesChanged, 2);

  assert.deepEqual(JSON.parse(readFileSync(outputPath, "utf8")), result);
});

test("dirty worktree state changes evidence identity", async () => {
  const repositoryPath = createRepository();
  const clean = await surveyMaintenanceRisk({
    repositoryPath,
    depth: "quick",
  });

  writeFileSync(join(repositoryPath, "a.ts"), "export const a = 99;\n");
  const dirty = await surveyMaintenanceRisk({
    repositoryPath,
    depth: "quick",
  });

  assert.equal(clean.repository.dirty, false);
  assert.equal(dirty.repository.dirty, true);
  assert.notEqual(clean.repository.stateId, dirty.repository.stateId);
});

test("reports unavailable Git as partial evidence", async () => {
  const result = await surveyMaintenanceRisk({
    repositoryPath: createRepository(),
    depth: "quick",
    gitExecutable: "definitely-not-a-real-git",
  });

  assert.equal(result.status, "partial");
  assert.equal(result.failures[0]?.capability, "git-history");
  assert.match(result.failures[0]?.message ?? "", /not available/i);
  assert.deepEqual(result.evidence.hotspots, []);
});
