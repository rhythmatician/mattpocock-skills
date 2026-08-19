import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import test from "node:test";

import { createAnalysisSession } from "../analysis.js";

test("creates a quick session without modifying the target repository", async () => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "repository-analysis-"));
  await mkdir(join(repositoryRoot, ".git"));

  const session = await createAnalysisSession({ target: repositoryRoot });

  assert.equal(session.repositoryRoot, resolve(repositoryRoot));
  assert.equal(session.depth, "quick");
  const repositoryKey = createHash("sha256").update(resolve(repositoryRoot)).digest("hex").slice(0, 16);
  const artifactDirectory = join(tmpdir(), "mattpocock-skills-analysis", repositoryKey);
  assert.equal(session.artifactDirectory, artifactDirectory);
  assert.equal(session.temporaryDirectory, join(artifactDirectory, "tmp"));
});

test("prefers the enclosing VCS root over a nested package manifest", async () => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "repository-analysis-"));
  await mkdir(join(repositoryRoot, ".git"));
  const packageDirectory = join(repositoryRoot, "packages", "child");
  await mkdir(packageDirectory, { recursive: true });
  await (await import("node:fs/promises")).writeFile(join(packageDirectory, "package.json"), "{}", "utf8");

  const session = await createAnalysisSession({ target: packageDirectory });

  assert.equal(session.repositoryRoot, resolve(repositoryRoot));
});