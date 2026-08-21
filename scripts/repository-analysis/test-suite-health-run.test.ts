import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  normalizeToolOutput,
  runTestHealthPlan,
} from "./test-suite-health-run.ts";
import { surveyTestSuiteHealth } from "./test-suite-health-survey.ts";

const createRepository = () => {
  const repositoryPath = mkdtempSync(join(tmpdir(), "test-health-repo-"));
  execFileSync("git", ["init", "--quiet", repositoryPath]);
  execFileSync("git", [
    "-C",
    repositoryPath,
    "config",
    "user.email",
    "test@example.com",
  ]);
  execFileSync("git", ["-C", repositoryPath, "config", "user.name", "Test"]);
  writeFileSync(join(repositoryPath, "tracked.txt"), "baseline\n");
  execFileSync("git", ["-C", repositoryPath, "add", "tracked.txt"]);
  execFileSync("git", [
    "-C",
    repositoryPath,
    "commit",
    "--quiet",
    "-m",
    "initial",
  ]);
  return repositoryPath;
};

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
  const repositoryPath = createRepository();
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
            "42",
          ],
          diagnostic: "flakiness",
          executable: process.execPath,
          id: "repeat-flake",
          parser: "tap",
          repeats: 2,
          seed: { argumentIndex: 2, source: "argument" },
          timeoutMs: 1_000,
          versionArgs: ["--version"],
        },
      ],
      repositoryPath,
      schemaVersion: 2,
    },
  });

  assert.equal(report.status, "complete");
  assert.equal(report.schemaVersion, 2);
  assert.equal(report.experiments[0]?.summary.runs, 2);
  assert.equal(report.experiments[0]?.summary.failureRate, 1);
  assert.equal(report.experiments[0]?.runs[0]?.measurement?.tests?.failed, 1);
  assert.deepEqual(report.experiments[0]?.provenance.seed, {
    argumentIndex: 2,
    source: "argument",
    value: "42",
  });
  assert.match(
    report.experiments[0]?.provenance.toolVersion.value ?? "",
    /^v\d+/,
  );
  assert.deepEqual(JSON.parse(readFileSync(outputPath, "utf8")), report);
});

test("derives seed provenance from the configured argument and environment", async () => {
  const repositoryPath = createRepository();
  const outputPath = join(
    mkdtempSync(join(tmpdir(), "test-health-run-")),
    "report.json",
  );
  const report = await runTestHealthPlan({
    outputPath,
    plan: {
      experiments: [
        {
          args: ["-e", "console.log(process.argv[1])", "argument-seed"],
          diagnostic: "order",
          executable: process.execPath,
          id: "argument-seed",
          parser: "exit-code",
          repeats: 1,
          seed: { argumentIndex: 2, source: "argument" },
          timeoutMs: 1_000,
          versionArgs: ["--version"],
        },
        {
          args: ["-e", "console.log(process.env.TEST_HEALTH_SEED)"],
          diagnostic: "order",
          environment: { TEST_HEALTH_SEED: "environment-seed" },
          executable: process.execPath,
          id: "environment-seed",
          parser: "exit-code",
          repeats: 1,
          seed: {
            environmentVariable: "TEST_HEALTH_SEED",
            source: "environment",
          },
          timeoutMs: 1_000,
          versionArgs: ["--version"],
        },
      ],
      repositoryPath,
      schemaVersion: 2,
    },
  });

  assert.match(
    readFileSync(report.experiments[0]!.runs[0]!.stdoutPath!, "utf8"),
    /argument-seed/,
  );
  assert.deepEqual(report.experiments[0]!.provenance.seed, {
    argumentIndex: 2,
    source: "argument",
    value: "argument-seed",
  });
  assert.equal(
    report.experiments[0]!.capabilityGaps[0]?.capability,
    "native-reporter-metrics",
  );
  assert.match(
    readFileSync(report.experiments[1]!.runs[0]!.stdoutPath!, "utf8"),
    /environment-seed/,
  );
  assert.deepEqual(report.experiments[1]!.provenance.seed, {
    environmentVariable: "TEST_HEALTH_SEED",
    source: "environment",
    value: "environment-seed",
  });
});

test("snapshots each machine report before the next repeat", async () => {
  const repositoryPath = process.cwd();
  const evidenceDirectory = mkdtempSync(join(tmpdir(), "test-health-run-"));
  const outputPath = join(evidenceDirectory, "report.json");
  const reportPath = join(evidenceDirectory, "native-report.json");
  const report = await runTestHealthPlan({
    outputPath,
    plan: {
      experiments: [
        {
          args: [
            "-e",
            "const fs = require('node:fs'); const previous = fs.existsSync(process.argv[1]) ? JSON.parse(fs.readFileSync(process.argv[1], 'utf8')).run : 0; fs.writeFileSync(process.argv[1], JSON.stringify({numPassedTests: 1, numTotalTests: 1, run: previous + 1}))",
            reportPath,
          ],
          diagnostic: "baseline",
          executable: process.execPath,
          id: "native-report",
          parser: "jest-json",
          repeats: 2,
          reportPath,
          timeoutMs: 1_000,
          versionArgs: ["--version"],
        },
      ],
      repositoryPath,
      schemaVersion: 2,
    },
  });

  const first = report.experiments[0]!.runs[0]!.reportArtifactPath!;
  const second = report.experiments[0]!.runs[1]!.reportArtifactPath!;
  assert.notEqual(first, second);
  assert.match(first, /native-report-1-report\.json$/);
  assert.match(second, /native-report-2-report\.json$/);
  assert.equal(existsSync(first), true);
  assert.equal(existsSync(second), true);
  assert.equal(JSON.parse(readFileSync(first, "utf8")).numPassedTests, 1);
});

test("preserves identical report bytes when each repeat rewrites the file", async () => {
  const repositoryPath = createRepository();
  const evidenceDirectory = mkdtempSync(join(tmpdir(), "test-health-run-"));
  const outputPath = join(evidenceDirectory, "report.json");
  const reportPath = join(evidenceDirectory, "identical-report.json");
  const report = await runTestHealthPlan({
    outputPath,
    plan: {
      experiments: [
        {
          args: [
            "-e",
            "require('node:fs').writeFileSync(process.argv[1], JSON.stringify({numPassedTests: 1, numTotalTests: 1}))",
            reportPath,
          ],
          diagnostic: "baseline",
          executable: process.execPath,
          id: "identical-report",
          parser: "jest-json",
          repeats: 2,
          reportPath,
          timeoutMs: 1_000,
          versionArgs: ["--version"],
        },
      ],
      repositoryPath,
      schemaVersion: 2,
    },
  });

  assert.equal(report.experiments[0]!.runs.length, 2);
  for (const run of report.experiments[0]!.runs) {
    assert.equal(run.reportSnapshotError, undefined);
    assert.equal(existsSync(run.reportArtifactPath!), true);
  }
  assert.notEqual(
    report.experiments[0]!.runs[0]!.reportArtifactPath,
    report.experiments[0]!.runs[1]!.reportArtifactPath,
  );
});

test("snapshots a machine report when the process times out", async () => {
  const repositoryPath = process.cwd();
  const evidenceDirectory = mkdtempSync(join(tmpdir(), "test-health-run-"));
  const outputPath = join(evidenceDirectory, "report.json");
  const reportPath = join(evidenceDirectory, "timeout-report.json");
  const report = await runTestHealthPlan({
    outputPath,
    plan: {
      experiments: [
        {
          args: [
            "-e",
            "require('node:fs').writeFileSync(process.argv[1], JSON.stringify({numPassedTests: 1, numTotalTests: 1, pid: process.pid})); setInterval(() => {}, 1000)",
            reportPath,
          ],
          diagnostic: "runtime",
          executable: process.execPath,
          id: "timeout-report",
          parser: "jest-json",
          repeats: 2,
          reportPath,
          timeoutMs: 500,
          versionArgs: ["--version"],
        },
      ],
      repositoryPath,
      schemaVersion: 2,
    },
  });

  for (const [index, run] of report.experiments[0]!.runs.entries()) {
    assert.equal(run.executionError?.kind, "timeout");
    assert.match(
      run.reportArtifactPath ?? "",
      new RegExp(`timeout-report-${index + 1}-report\\.json$`),
    );
    assert.equal(existsSync(run.reportArtifactPath!), true);
  }
});

test("does not attribute an unchanged report to a later failed repeat", async () => {
  const repositoryPath = createRepository();
  const evidenceDirectory = mkdtempSync(join(tmpdir(), "test-health-run-"));
  const outputPath = join(evidenceDirectory, "report.json");
  const reportPath = join(evidenceDirectory, "repeat-report.json");
  const markerPath = join(evidenceDirectory, "first-run-complete");
  const report = await runTestHealthPlan({
    outputPath,
    plan: {
      experiments: [
        {
          args: [
            "-e",
            "const fs = require('node:fs'); if (fs.existsSync(process.argv[2])) setInterval(() => {}, 1000); else { fs.writeFileSync(process.argv[1], JSON.stringify({numPassedTests: 1, numTotalTests: 1})); fs.writeFileSync(process.argv[2], 'done'); }",
            reportPath,
            markerPath,
          ],
          diagnostic: "runtime",
          executable: process.execPath,
          id: "stale-repeat-report",
          parser: "jest-json",
          repeats: 2,
          reportPath,
          timeoutMs: 500,
          versionArgs: ["--version"],
        },
      ],
      repositoryPath,
      schemaVersion: 2,
    },
  });

  assert.equal(
    existsSync(report.experiments[0]!.runs[0]!.reportArtifactPath!),
    true,
  );
  assert.equal(report.experiments[0]!.runs[1]!.executionError?.kind, "timeout");
  assert.equal(report.experiments[0]!.runs[1]!.reportArtifactPath, undefined);
  assert.match(
    report.experiments[0]!.runs[1]!.reportSnapshotError ?? "",
    /unchanged.*stale/i,
  );
});

test("records repository identity and attributes only experiment residue", async () => {
  const repositoryPath = createRepository();
  writeFileSync(join(repositoryPath, "pre-existing.txt"), "user state\n");
  const survey = await surveyTestSuiteHealth({
    depth: "quick",
    repositoryPath,
  });
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
            "require('node:fs').writeFileSync('experiment.cache', 'created by experiment')",
          ],
          diagnostic: "baseline",
          executable: process.execPath,
          id: "creates-residue",
          parser: "exit-code",
          repeats: 1,
          timeoutMs: 1_000,
          versionArgs: ["--version"],
        },
      ],
      repositoryPath,
      schemaVersion: 2,
    },
  });

  assert.equal(report.repository.before.dirty, true);
  assert.equal(report.repository.after.dirty, true);
  assert.notEqual(
    report.repository.before.stateId,
    report.repository.after.stateId,
  );
  assert.match(report.repository.before.head, /^[0-9a-f]{40}$/);
  assert.deepEqual(report.repository.before, {
    dirty: survey.repository.dirty,
    head: survey.repository.head,
    stateId: survey.repository.stateId,
  });
  assert.deepEqual(
    report.experiments[0]!.residue.changes.map(({ path }) => path),
    ["experiment.cache"],
  );
  assert.equal(
    report.experiments[0]!.residue.cleanup,
    "preserved-unknown-state",
  );
  assert.equal(existsSync(join(repositoryPath, "pre-existing.txt")), true);
  assert.equal(existsSync(join(repositoryPath, "experiment.cache")), true);
});

test("detects newly created ignored residue without traversing ignored trees", async () => {
  const repositoryPath = createRepository();
  writeFileSync(join(repositoryPath, ".gitignore"), "ignored-cache/\n");
  execFileSync("git", ["-C", repositoryPath, "add", ".gitignore"]);
  execFileSync("git", [
    "-C",
    repositoryPath,
    "commit",
    "--quiet",
    "-m",
    "ignore cache",
  ]);
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
            "require('node:fs').mkdirSync('ignored-cache', {recursive: true}); require('node:fs').writeFileSync('ignored-cache/results.json', '{}')",
          ],
          diagnostic: "baseline",
          executable: process.execPath,
          id: "ignored-residue",
          parser: "exit-code",
          repeats: 1,
          timeoutMs: 1_000,
          versionArgs: ["--version"],
        },
      ],
      repositoryPath,
      schemaVersion: 2,
    },
  });

  assert.deepEqual(
    report.experiments[0]!.residue.changes.map(({ path }) => path),
    ["ignored-cache/"],
  );
  assert.equal(report.experiments[0]!.residue.changes[0]?.after?.status, "!!");
});

test("names normalization and tool-version capability gaps", async () => {
  const outputPath = join(
    mkdtempSync(join(tmpdir(), "test-health-run-")),
    "report.json",
  );
  const report = await runTestHealthPlan({
    outputPath,
    plan: {
      experiments: [
        {
          args: ["-e", "process.exit(0)"],
          capabilityGaps: [
            {
              capability: "mutation-native-report",
              reason: "The configured tool exposes no machine report",
            },
          ],
          diagnostic: "mutation",
          executable: process.execPath,
          id: "native-mutation",
          parser: "exit-code",
          repeats: 1,
          timeoutMs: 1_000,
        },
      ],
      repositoryPath: createRepository(),
      schemaVersion: 2,
    },
  });

  assert.deepEqual(
    report.experiments[0]!.capabilityGaps.map(({ capability }) => capability),
    [
      "mutation-native-report",
      "structured-mutation-normalization",
      "tool-version",
    ],
  );
  assert.deepEqual(report.experiments[0]!.runs[0]!.measurement, {});
});

test("rejects decorative seed provenance with no mechanical source", async () => {
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
            args: ["-e", "process.exit(0)"],
            diagnostic: "order",
            executable: process.execPath,
            id: "decorative-seed",
            parser: "exit-code",
            repeats: 1,
            seed: "42",
            timeoutMs: 1_000,
          },
        ],
        repositoryPath: process.cwd(),
        schemaVersion: 2,
      },
    } as unknown as Parameters<typeof runTestHealthPlan>[0]),
    /invalid experiment/i,
  );
});

test("detects leaf changes within a pre-existing ignored directory", async () => {
  const repositoryPath = createRepository();
  writeFileSync(join(repositoryPath, ".gitignore"), "ignored-cache/\n");
  execFileSync("git", ["-C", repositoryPath, "add", ".gitignore"]);
  execFileSync("git", [
    "-C",
    repositoryPath,
    "commit",
    "--quiet",
    "-m",
    "ignore cache",
  ]);
  execFileSync(
    process.execPath,
    [
      "-e",
      "const fs = require('node:fs'); fs.mkdirSync('ignored-cache', {recursive: true}); fs.writeFileSync('ignored-cache/existing.json', '{\"before\":true}')",
    ],
    { cwd: repositoryPath },
  );
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
            "const fs = require('node:fs'); fs.writeFileSync('ignored-cache/existing.json', '{\"after\":true}'); fs.writeFileSync('ignored-cache/new.json', '{}')",
          ],
          diagnostic: "baseline",
          executable: process.execPath,
          id: "ignored-leaf-change",
          parser: "exit-code",
          repeats: 1,
          timeoutMs: 1_000,
          versionArgs: ["--version"],
        },
      ],
      repositoryPath,
      schemaVersion: 2,
    },
  });

  assert.deepEqual(
    report.experiments[0]!.residue.changes.map(({ path }) => path),
    ["ignored-cache/"],
  );
  assert.notEqual(
    report.experiments[0]!.residue.changes[0]?.before?.fingerprint,
    report.experiments[0]!.residue.changes[0]?.after?.fingerprint,
  );
});

test("reports partial residue evidence for an excluded dependency-scale tree", async () => {
  const repositoryPath = createRepository();
  writeFileSync(join(repositoryPath, ".gitignore"), "node_modules/\n");
  execFileSync("git", ["-C", repositoryPath, "add", ".gitignore"]);
  execFileSync("git", [
    "-C",
    repositoryPath,
    "commit",
    "--quiet",
    "-m",
    "ignore dependencies",
  ]);
  execFileSync(
    process.execPath,
    [
      "-e",
      "const fs = require('node:fs'); fs.mkdirSync('node_modules/example', {recursive: true}); fs.writeFileSync('node_modules/example/index.js', '')",
    ],
    { cwd: repositoryPath },
  );
  const report = await runTestHealthPlan({
    outputPath: join(
      mkdtempSync(join(tmpdir(), "test-health-run-")),
      "report.json",
    ),
    plan: {
      experiments: [
        {
          args: ["-e", "process.exit(0)"],
          diagnostic: "baseline",
          executable: process.execPath,
          id: "bounded-ignored-tree",
          parser: "exit-code",
          repeats: 1,
          timeoutMs: 1_000,
          versionArgs: ["--version"],
        },
      ],
      repositoryPath,
      schemaVersion: 2,
    },
  });

  assert.equal(report.status, "partial");
  assert.equal(
    report.experiments[0]!.capabilityGaps.some(
      ({ capability }) => capability === "ignored-residue-scan",
    ),
    true,
  );
});

test("rejects schema v1 plans with an explicit migration message", async () => {
  await assert.rejects(
    runTestHealthPlan({
      outputPath: join(
        mkdtempSync(join(tmpdir(), "test-health-run-")),
        "report.json",
      ),
      plan: {
        experiments: [],
        repositoryPath: process.cwd(),
        schemaVersion: 1,
      },
    } as unknown as Parameters<typeof runTestHealthPlan>[0]),
    /schemaVersion 1.*migrate.*schemaVersion 2/i,
  );
});

test("skill keeps reporter-dependent metrics and native mutation evidence honest", () => {
  const skill = readFileSync(
    join(
      process.cwd(),
      "skills",
      "engineering",
      "test-suite-health",
      "SKILL.md",
    ),
    "utf8",
  );

  assert.match(skill, /when the native machine reporter exposes them/);
  assert.match(skill, /Never infer missing fields from console prose/);
  assert.match(skill, /preserve its native report/);
  assert.match(skill, /Add parsers only for a real tool and consumer/);
});

test("refuses experiment evidence inside the target repository", async () => {
  const repositoryPath = process.cwd();

  await assert.rejects(
    runTestHealthPlan({
      outputPath: join(repositoryPath, "test-health-output.json"),
      plan: {
        experiments: [],
        repositoryPath,
        schemaVersion: 2,
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
        schemaVersion: 2,
      },
    }),
    /invalid experiment/i,
  );
});
