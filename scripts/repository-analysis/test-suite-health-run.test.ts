import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  normalizeToolOutput,
  runTestHealthPlan,
} from "./test-suite-health-run.ts";

test("normalizes Jest and Stryker reports", () => {
  assert.deepEqual(
    normalizeToolOutput(
      "jest-json",
      JSON.stringify({
        numFailedTests: 1,
        numPassedTests: 2,
        numPendingTests: 1,
        numTotalTests: 4,
      }),
    ).tests,
    {
      durationMs: undefined,
      failed: 1,
      passed: 2,
      skipped: 1,
      total: 4,
    },
  );
  assert.deepEqual(
    normalizeToolOutput(
      "stryker-json",
      JSON.stringify({
        files: {
          "source.ts": {
            mutants: [
              { status: "Killed" },
              { status: "Survived" },
              { status: "NoCoverage" },
            ],
          },
        },
      }),
    ).mutation,
    {
      compileErrors: 0,
      killed: 1,
      noCoverage: 1,
      runtimeErrors: 0,
      survived: 1,
      timeout: 0,
      total: 3,
    },
  );
});

test("aggregates JUnit child suites when the wrapper has no counts", () => {
  assert.deepEqual(
    normalizeToolOutput(
      "junit-xml",
      [
        "<testsuites>",
        '  <testsuite tests="2" failures="1" skipped="0" time="0.5"></testsuite>',
        '  <testsuite tests="3" errors="1" skipped="1" time="1.5"></testsuite>',
        "</testsuites>",
      ].join("\n"),
    ).tests,
    {
      durationMs: 2_000,
      failed: 2,
      passed: 2,
      skipped: 1,
      total: 5,
    },
  );
});

test("runs repeated experiments and writes normalized evidence", async () => {
  const repositoryPath = process.cwd();
  const outputPath = join(
    mkdtempSync(join(tmpdir(), "test-health-run-")),
    "report.json",
  );
  const report = await runTestHealthPlan({
    outputPath,
    plan: {
      experiments: [
        {
          args: [
            "-e",
            'console.log("TAP version 13\\nnot ok 1 - flaky\\n1..1")',
          ],
          diagnostic: "flakiness",
          executable: process.execPath,
          id: "repeat-flake",
          parser: "tap",
          repeats: 2,
          seed: "42",
          timeoutMs: 1_000,
        },
      ],
      repositoryPath,
      schemaVersion: 1,
    },
  });

  assert.equal(report.status, "complete");
  assert.equal(report.experiments[0]?.summary.runs, 2);
  assert.equal(report.experiments[0]?.summary.failureRate, 1);
  assert.equal(
    report.experiments[0]?.runs[0]?.measurement?.tests?.failed,
    1,
  );
  assert.deepEqual(JSON.parse(readFileSync(outputPath, "utf8")), report);
});

test("refuses experiment evidence inside the target repository", async () => {
  const repositoryPath = process.cwd();

  await assert.rejects(
    runTestHealthPlan({
      outputPath: join(repositoryPath, "test-health-output.json"),
      plan: {
        experiments: [],
        repositoryPath,
        schemaVersion: 1,
      },
    }),
    /outside the target repository/i,
  );
});

test("rejects experiment IDs that are unsafe as artifact names", async () => {
  const repositoryPath = process.cwd();
  const outputPath = join(
    mkdtempSync(join(tmpdir(), "test-health-run-")),
    "report.json",
  );

  await assert.rejects(
    runTestHealthPlan({
      outputPath,
      plan: {
        experiments: [
          {
            args: [],
            diagnostic: "baseline",
            executable: process.execPath,
            id: "../escape",
            parser: "exit-code",
            repeats: 1,
            timeoutMs: 1_000,
          },
        ],
        repositoryPath,
        schemaVersion: 1,
      },
    }),
    /invalid experiment/i,
  );
});
