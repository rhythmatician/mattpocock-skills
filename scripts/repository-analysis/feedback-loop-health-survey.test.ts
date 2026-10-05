import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { surveyFeedbackLoopHealth } from "./feedback-loop-health-survey.ts";

const git = (repositoryPath: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd: repositoryPath,
    encoding: "utf8",
    stdio: "pipe",
  });

const createRepository = () => {
  const repositoryPath = mkdtempSync(join(tmpdir(), "feedback-loop-survey-"));
  git(repositoryPath, "init");
  git(repositoryPath, "config", "user.email", "tests@example.com");
  git(repositoryPath, "config", "user.name", "Tests");
  mkdirSync(join(repositoryPath, "tests"));
  mkdirSync(join(repositoryPath, ".github", "workflows"), { recursive: true });
  writeFileSync(
    join(repositoryPath, "package.json"),
    JSON.stringify({
      scripts: {
        build: "tsc -b",
        dev: "vite",
        test: "vitest run",
        "test:watch": "vitest",
        verify: "npm run build && npm test",
      },
    }),
  );
  writeFileSync(
    join(repositoryPath, "README.md"),
    [
      "# Example",
      "Run `npm run dev`, then open http://localhost:5173.",
      "Use Playwright screenshots as review evidence.",
      "Set TEST_PROFILE to isolate concurrent sessions.",
      "",
    ].join("\n"),
  );
  writeFileSync(join(repositoryPath, "tests", "app.spec.ts"), "test('app', () => {});\n");
  writeFileSync(
    join(repositoryPath, ".github", "workflows", "ci.yml"),
    "steps:\n  - run: npm run verify\n",
  );
  git(repositoryPath, "add", ".");
  git(repositoryPath, "commit", "-m", "initial");
  return repositoryPath;
};

test("surveys repository-owned feedback commands without executing them", async () => {
  const repositoryPath = createRepository();
  const markerPath = join(repositoryPath, "command-ran");
  const packagePath = join(repositoryPath, "package.json");
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as {
    scripts: Record<string, string>;
  };
  packageJson.scripts.test = `${process.execPath} -e \"require('fs').writeFileSync('${markerPath.replaceAll("\\", "\\\\")}', 'ran')\"`;
  writeFileSync(packagePath, JSON.stringify(packageJson));

  const result = await surveyFeedbackLoopHealth({
    depth: "quick",
    repositoryPath,
  });

  assert.equal(result.schemaVersion, 1);
  assert.equal(result.diagnostic, "feedback-loop-health");
  assert.equal(result.repository.dirty, true);
  assert.equal(result.commands.some(({ name }) => name === "test"), true);
  assert.equal(result.commands.some(({ name }) => name === "verify"), true);
  assert.equal(result.commands.some(({ role }) => role === "first-signal"), true);
  assert.equal(result.commands.some(({ role }) => role === "automated-confidence"), true);
  assert.equal(result.scenarioGrounding.surface.status, "available");
  assert.equal(result.scenarioGrounding.run.status, "available");
  assert.equal(result.scenarioGrounding.drive.status, "available");
  assert.equal(result.scenarioGrounding.observe.status, "available");
  assert.equal(result.scenarioGrounding.isolate.status, "available");
  assert.equal(result.unavailableStages.some(({ stage }) => stage === "hitl-verdict"), true);
  assert.equal(readFileSync(packagePath, "utf8").includes("command-ran"), true);
  assert.throws(() => readFileSync(markerPath, "utf8"));
});

test("writes normalized survey evidence outside the target repository", async () => {
  const repositoryPath = createRepository();
  const outputPath = join(mkdtempSync(join(tmpdir(), "feedback-loop-evidence-")), "survey.json");
  const result = await surveyFeedbackLoopHealth({
    depth: "quick",
    outputPath,
    repositoryPath,
  });

  assert.deepEqual(JSON.parse(readFileSync(outputPath, "utf8")), result);
  await assert.rejects(
    surveyFeedbackLoopHealth({
      depth: "quick",
      outputPath: join(repositoryPath, "survey.json"),
      repositoryPath,
    }),
    /outside the target repository/i,
  );
});

test("survey CLI returns a compact receipt", () => {
  const repositoryPath = createRepository();
  const outputPath = join(mkdtempSync(join(tmpdir(), "feedback-loop-evidence-")), "survey.json");
  const scriptPath = join(process.cwd(), "scripts", "repository-analysis", "feedback-loop-health-survey.ts");
  const processResult = spawnSync(
    process.execPath,
    ["--import", "tsx", scriptPath, "--repo", repositoryPath, "--depth", "quick", "--output", outputPath],
    { encoding: "utf8" },
  );
  const stdout = processResult.stdout;
  const receipt = JSON.parse(stdout) as Record<string, unknown>;

  assert.equal(processResult.status, 0);
  assert.equal(receipt.status, "complete");
  assert.equal(receipt.outputPath, outputPath);
  assert.equal("commands" in receipt, false);
  assert.ok(stdout.length < 1_000);
});
