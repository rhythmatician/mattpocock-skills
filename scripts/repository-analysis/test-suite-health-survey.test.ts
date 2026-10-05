import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { surveyTestSuiteHealth } from "./test-suite-health-survey.ts";

const git = (repositoryPath: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd: repositoryPath,
    encoding: "utf8",
    stdio: "pipe",
  });

const commit = (repositoryPath: string, message: string) => {
  git(repositoryPath, "add", ".");
  git(repositoryPath, "commit", "-m", message);
};

const sourceContent = (backend: string) =>
  [
    "enum PaymentBackend { Fake, Real }",
    "const enableRetries: boolean = true;",
    'const dryRunFlag = "--dry-run";',
    'const fastCheckout = isFeatureEnabled("fast-checkout");',
    `export const backend = process.env.PAYMENT_BACKEND ?? "${backend}";`,
    "",
  ].join("\n");

const createRepository = () => {
  const repositoryPath = mkdtempSync(join(tmpdir(), "test-health-"));
  git(repositoryPath, "init");
  git(repositoryPath, "config", "user.email", "tests@example.com");
  git(repositoryPath, "config", "user.name", "Tests");
  mkdirSync(join(repositoryPath, "src"));
  mkdirSync(join(repositoryPath, "tests"));
  writeFileSync(
    join(repositoryPath, "package.json"),
    JSON.stringify({
      scripts: { check: "node --test", test: "vitest run" },
      devDependencies: { "@stryker-mutator/core": "1.0.0", vitest: "1.0.0" },
    }),
  );
  writeFileSync(
    join(repositoryPath, "src", "checkout.ts"),
    sourceContent("fake"),
  );
  writeFileSync(
    join(repositoryPath, "tests", "checkout.test.ts"),
    [
      'import { test } from "vitest";',
      'describe("checkout", () => {',
      'test.skip("dependency timeout", () => {',
      '  throw new Error("timeout");',
      "});",
      'test("successful checkout", () => {',
      "  expect(1).toBe(1);",
      "});",
      "});",
      "",
    ].join("\n"),
  );
  commit(repositoryPath, "initial");
  for (const backend of ["stub", "sandbox", "local", "memory"]) {
    writeFileSync(
      join(repositoryPath, "src", "checkout.ts"),
      sourceContent(backend),
    );
    commit(repositoryPath, `change source to ${backend}`);
  }
  return repositoryPath;
};

test("surveys cheap test-suite evidence without running tests", async () => {
  const repositoryPath = createRepository();
  const result = await surveyTestSuiteHealth({
    depth: "quick",
    repositoryPath,
  });

  assert.equal(result.status, "complete");
  assert.equal(result.inventory.testFiles, 1);
  assert.equal(result.inventory.sourceFiles, 1);
  assert.deepEqual(result.tooling.ecosystems, ["javascript-typescript"]);
  assert.deepEqual(
    result.tooling.tools.map(({ name }) => name),
    ["Node.js test runner", "StrykerJS", "Vitest"],
  );
  assert.equal(result.evidence.skipMarkers[0]?.marker, "skip");
  assert.equal(result.evidence.assertionlessCandidates.length, 1);
  assert.equal(result.evidence.assertionlessCandidates[0]?.testDefinition, 1);
  assert.deepEqual(
    result.evidence.configurationAxes.map(({ kind, name }) => ({ kind, name })),
    [
      { kind: "cli-flag", name: "--dry-run" },
      { kind: "boolean", name: "enableRetries" },
      { kind: "feature-flag", name: "fast-checkout" },
      { kind: "environment", name: "PAYMENT_BACKEND" },
      { kind: "mode-enum", name: "PaymentBackend" },
    ],
  );
  assert.equal(
    result.evidence.failurePathCoverage.find(
      ({ category }) => category === "dependency-failure",
    )?.locations.length,
    3,
  );
  assert.deepEqual(result.evidence.evolutionaryMismatch[0], {
    coChanges: 1,
    sourceChanges: 5,
    sourcePath: "src/checkout.ts",
    testPaths: ["tests/checkout.test.ts"],
  });
  assert.equal(
    result.unmeasured.some(({ diagnostic }) => diagnostic === "mutation"),
    true,
  );
});

test("writes normalized evidence outside the target repository", async () => {
  const repositoryPath = createRepository();
  const outputPath = join(
    mkdtempSync(join(tmpdir(), "test-health-evidence-")),
    "survey.json",
  );
  const result = await surveyTestSuiteHealth({
    depth: "quick",
    outputPath,
    repositoryPath,
  });

  assert.deepEqual(JSON.parse(readFileSync(outputPath, "utf8")), result);
  await assert.rejects(
    surveyTestSuiteHealth({
      depth: "quick",
      outputPath: join(repositoryPath, "survey.json"),
      repositoryPath,
    }),
    /outside the target repository/i,
  );
});

test("CLI returns a compact receipt", () => {
  const repositoryPath = createRepository();
  const outputPath = join(
    mkdtempSync(join(tmpdir(), "test-health-evidence-")),
    "survey.json",
  );
  const scriptPath = join(
    process.cwd(),
    "scripts",
    "repository-analysis",
    "test-suite-health-survey.ts",
  );
  const stdout = execFileSync(
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
  const receipt = JSON.parse(stdout) as {
    outputPath: string;
    status: string;
  };

  assert.equal(receipt.status, "complete");
  assert.equal(receipt.outputPath, outputPath);
  assert.equal("evidence" in receipt, false);
  assert.ok(stdout.length < 1_000);
});

test("reports unavailable Git while retaining static evidence", async () => {
  const result = await surveyTestSuiteHealth({
    depth: "quick",
    gitExecutable: "not-a-real-git",
    repositoryPath: createRepository(),
  });

  assert.equal(result.status, "partial");
  assert.equal(result.failures[0]?.capability, "git-history");
  assert.equal(result.inventory.testFiles, 1);
  assert.deepEqual(result.evidence.evolutionaryMismatch, []);
});

test("cancellation stops the survey", async () => {
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    surveyTestSuiteHealth({
      depth: "quick",
      repositoryPath: createRepository(),
      signal: controller.signal,
    }),
    (error) =>
      error instanceof Error && /cancelled/i.test(error.message),
  );
});

test("dirty content changes repository state identity", async () => {
  const repositoryPath = createRepository();
  const sourcePath = join(repositoryPath, "src", "checkout.ts");
  writeFileSync(sourcePath, sourceContent("first-dirty-state"));
  const first = await surveyTestSuiteHealth({
    depth: "quick",
    repositoryPath,
  });
  writeFileSync(sourcePath, sourceContent("second-dirty-state"));
  const second = await surveyTestSuiteHealth({
    depth: "quick",
    repositoryPath,
  });

  assert.equal(first.repository.dirty, true);
  assert.equal(second.repository.dirty, true);
  assert.notEqual(first.repository.stateId, second.repository.stateId);
});
