import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
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

  writeFileSync(join(repositoryPath, "a.ts"), "export const a = 3; \n");
  writeFileSync(join(repositoryPath, "b.ts"), "export const b = 3; \n");
  commit(repositoryPath, "format code", "2026-01-04T00:00:00Z");

  return repositoryPath;
};

test("surveys maintenance risk through measured repository history", async () => {
  const repositoryPath = createRepository();
  const outputPath = join(
    mkdtempSync(join(tmpdir(), "maintenance-risk-evidence-")),
    "maintenance-risk.json",
  );

  const result = await surveyMaintenanceRisk({
    repositoryPath,
    depth: "quick",
    outputPath,
  });

  assert.equal(result.status, "partial");
  assert.equal(result.provenance.capability, "git-history");
  assert.equal(result.provenance.depth, "quick");
  assert.equal(result.provenance.commitLimit, 50);
  assert.match(result.provenance.toolVersion, /^git version /);
  assert.equal(result.repository.head.length, 40);
  assert.equal(result.repository.dirty, false);

  assert.deepEqual(result.evidence.temporalCoupling.items[0], {
    paths: ["a.ts", "b.ts"],
    sharedChanges: 3,
    confidence: 1,
  });
  assert.equal(
    result.evidence.changeAmplification.items[0]?.filesChanged,
    2,
  );
  assert.equal(
    result.evidence.changeAmplification.items[0]?.maxPairRecurrence,
    3,
  );
  assert.equal(
    result.evidence.changeAmplification.items[0]?.recurringPairs,
    1,
  );
  assert.deepEqual(
    result.evidence.changeAmplification.items[0]?.topLevelAreas,
    ["(root)"],
  );
  assert.equal(result.exclusions[0]?.reason, "bulk-mechanical");

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
  assert.deepEqual(result.evidence.hotspots.items, []);
});

test("writes partial evidence when the target repository does not exist", async () => {
  const repositoryPath = join(
    mkdtempSync(join(tmpdir(), "maintenance-risk-missing-")),
    "not-a-repository",
  );
  const outputPath = join(
    mkdtempSync(join(tmpdir(), "maintenance-risk-evidence-")),
    "maintenance-risk.json",
  );

  const result = await surveyMaintenanceRisk({
    repositoryPath,
    depth: "quick",
    outputPath,
  });

  assert.equal(result.status, "partial");
  assert.equal(JSON.parse(readFileSync(outputPath, "utf8")).status, "partial");
});

test("CLI writes evidence without flooding stdout", () => {
  const repositoryPath = createRepository();
  const outputPath = join(
    mkdtempSync(join(tmpdir(), "maintenance-risk-evidence-")),
    "maintenance-risk.json",
  );
  const scriptPath = join(
    process.cwd(),
    "scripts",
    "repository-analysis",
    "maintenance-risk-survey.ts",
  );

  const execution = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      scriptPath,
      "--repo",
      repositoryPath,
      "--depth",
      "quick",
      "--output",
      outputPath,
    ],
    { encoding: "utf8" },
  );
  assert.equal(execution.status, 2);
  const stdout = execution.stdout;
  const receipt = JSON.parse(stdout) as {
    outputPath: string;
    status: string;
  };

  assert.equal(receipt.status, "partial");
  assert.equal(receipt.outputPath, outputPath);
  assert.ok(stdout.length < 1_000);
  assert.equal("evidence" in receipt, false);
  assert.equal(JSON.parse(readFileSync(outputPath, "utf8")).status, "partial");
});

test("refuses to write audit evidence into the target repository", async () => {
  const repositoryPath = createRepository();

  await assert.rejects(
    surveyMaintenanceRisk({
      repositoryPath,
      depth: "quick",
      outputPath: join(repositoryPath, "maintenance-risk.json"),
    }),
    /outside the target repository/i,
  );
});

test("treats dot-dot-prefixed names as inside the target repository", async () => {
  const repositoryPath = createRepository();

  await assert.rejects(
    surveyMaintenanceRisk({
      repositoryPath,
      depth: "quick",
      outputPath: join(repositoryPath, "..evidence", "maintenance-risk.json"),
    }),
    /outside the target repository/i,
  );
});

test("resolves symlinked output parents before repository containment checks", async () => {
  const repositoryPath = createRepository();
  const evidenceDirectory = join(repositoryPath, "evidence");
  mkdirSync(evidenceDirectory);
  const outsideDirectory = mkdtempSync(
    join(tmpdir(), "maintenance-risk-link-"),
  );
  const linkedDirectory = join(outsideDirectory, "linked-evidence");
  symlinkSync(
    evidenceDirectory,
    linkedDirectory,
    process.platform === "win32" ? "junction" : "dir",
  );

  await assert.rejects(
    surveyMaintenanceRisk({
      repositoryPath,
      depth: "quick",
      outputPath: join(linkedDirectory, "maintenance-risk.json"),
    }),
    /outside the target repository/i,
  );
});

test("preserves unusual Git pathnames exactly", async () => {
  const repositoryPath = createRepository();
  const unusualPath = "caf\u00e9.ts";
  writeFileSync(join(repositoryPath, unusualPath), "export const odd = true;\n");
  commit(
    repositoryPath,
    "add unusual \u001e separator path",
    "2026-01-05T00:00:00Z",
  );

  const result = await surveyMaintenanceRisk({
    repositoryPath,
    depth: "quick",
  });

  assert.equal(
    result.evidence.changeAmplification.items.some(({ paths }) =>
      paths.includes(unusualPath),
    ),
    true,
  );
});

test("bounds temporal coupling work and reports partial evidence", async () => {
  const repositoryPath = mkdtempSync(join(tmpdir(), "maintenance-risk-wide-"));
  git(repositoryPath, "init");
  git(repositoryPath, "config", "user.email", "tests@example.com");
  git(repositoryPath, "config", "user.name", "Tests");
  for (let index = 0; index < 205; index += 1) {
    writeFileSync(join(repositoryPath, `file-${index}.ts`), `${index}\n`);
  }
  commit(repositoryPath, "wide change", "2026-01-01T00:00:00Z");

  const result = await surveyMaintenanceRisk({
    repositoryPath,
    depth: "deep",
  });

  assert.equal(result.status, "partial");
  assert.equal(result.evidence.changeAmplification.status, "partial");
  assert.equal(
    result.failures.some(
      ({ capability }) => capability === "change-amplification",
    ),
    true,
  );
  assert.equal(
    result.failures.some(
      ({ capability }) => capability === "temporal-coupling",
    ),
    true,
  );
  assert.ok(result.evidence.temporalCoupling.items.length <= 20_000);
});

test("reports partial evidence when coupling result ranking is truncated", async () => {
  const repositoryPath = mkdtempSync(join(tmpdir(), "maintenance-risk-pairs-"));
  git(repositoryPath, "init");
  git(repositoryPath, "config", "user.email", "tests@example.com");
  git(repositoryPath, "config", "user.name", "Tests");
  for (let index = 0; index < 46; index += 1) {
    writeFileSync(join(repositoryPath, `file-${index}.ts`), `${index}\n`);
  }
  commit(repositoryPath, "many pairs", "2026-01-01T00:00:00Z");

  const result = await surveyMaintenanceRisk({
    repositoryPath,
    depth: "quick",
  });

  assert.equal(result.evidence.temporalCoupling.items.length, 1_000);
  assert.equal(result.status, "partial");
  assert.equal(
    result.failures.some(
      ({ capability }) => capability === "temporal-coupling",
    ),
    true,
  );
});

test("marks all recurrence evidence bounded when the global pair limit is reached", async () => {
  const repositoryPath = mkdtempSync(join(tmpdir(), "maintenance-risk-limit-"));
  git(repositoryPath, "init");
  git(repositoryPath, "config", "user.email", "tests@example.com");
  git(repositoryPath, "config", "user.name", "Tests");
  for (let index = 0; index < 46; index += 1) {
    writeFileSync(join(repositoryPath, `file-${index}.ts`), "0\n");
  }
  commit(repositoryPath, "initial pair set", "2026-01-01T00:00:00Z");
  for (let revision = 1; revision <= 20; revision += 1) {
    for (let index = 0; index < 46; index += 1) {
      writeFileSync(join(repositoryPath, `file-${index}.ts`), `${revision}\n`);
    }
    commit(
      repositoryPath,
      `pair revision ${revision}`,
      `2026-01-${String(revision + 1).padStart(2, "0")}T00:00:00Z`,
    );
  }

  const result = await surveyMaintenanceRisk({
    repositoryPath,
    depth: "quick",
  });

  assert.equal(result.evidence.changeAmplification.status, "partial");
  assert.equal(
    result.evidence.changeAmplification.items.every(
      ({ pairRecurrenceStatus }) => pairRecurrenceStatus === "bounded",
    ),
    true,
  );
});

test("large tracked changes do not discard usable history evidence", async () => {
  const repositoryPath = createRepository();
  writeFileSync(join(repositoryPath, "a.ts"), "a".repeat(9 * 1024 * 1024));

  const result = await surveyMaintenanceRisk({
    repositoryPath,
    depth: "quick",
  });

  assert.equal(result.status, "partial");
  assert.equal(result.repository.dirty, true);
  assert.ok(result.evidence.changeAmplification.items.length > 0);
});
