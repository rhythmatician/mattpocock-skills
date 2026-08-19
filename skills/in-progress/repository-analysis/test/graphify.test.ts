import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadGraphifyArtifact } from "../graphify.js";

test("reuses a valid graphify artifact instead of rebuilding it", async () => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "repository-analysis-"));
  const outputDirectory = join(repositoryRoot, "graphify-out");
  await mkdir(outputDirectory);
  await writeFile(join(outputDirectory, "graph.json"), '{"nodes":[],"edges":[]}', "utf8");

  const result = await loadGraphifyArtifact(repositoryRoot);

  assert.deepEqual(result, {
    kind: "evidence",
    provenance: {
      adapter: "graphify-artifact",
      capability: "repository-graph-loading",
      tool: "graphify",
    },
    value: { edges: [], nodes: [] },
  });
});