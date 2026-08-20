import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  type AnalyzerAdapter,
  surveyMaintenanceRisk,
} from "./maintenance-risk-survey.ts";
import { createOmenAdapter } from "./maintenance-risk-analyzers.ts";
import { ProcessExecutionError } from "./process.ts";

const git = (repositoryPath: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd: repositoryPath,
    encoding: "utf8",
    stdio: "pipe",
  });

const createRepository = () => {
  const repositoryPath = mkdtempSync(join(tmpdir(), "maintenance-adapters-"));
  git(repositoryPath, "init");
  git(repositoryPath, "config", "user.email", "tests@example.com");
  git(repositoryPath, "config", "user.name", "Tests");
  writeFileSync(
    join(repositoryPath, "core.ts"),
    "export function core(value: boolean) { return value ? 1 : 0; }\n",
  );
  writeFileSync(
    join(repositoryPath, "adapter.ts"),
    "export const adapter = () => core(true);\n",
  );
  git(repositoryPath, "add", ".");
  git(repositoryPath, "commit", "-m", "initial");
  return repositoryPath;
};

const completeAnalyzerAdapter: AnalyzerAdapter = {
  name: "fixture-analyzer",
  async analyze() {
    return {
      commands: {
        complexity: {
          files: [
            {
              path: "core.ts",
              functions: [
                {
                  name: "core",
                  start_line: 1,
                  end_line: 1,
                  metrics: {
                    cyclomatic: 2,
                    cognitive: 3,
                    max_nesting: 1,
                    lines: 1,
                  },
                },
              ],
            },
          ],
          summary: {
            p50_cognitive: 1,
            p90_cognitive: 2,
            p95_cognitive: 3,
          },
        },
        deadcode: {
          items: [
            {
              confidence: 0.9,
              end_line: 1,
              file: "adapter.ts",
              kind: "function",
              line: 1,
              name: "adapter",
              reason: "No references found",
              visibility: "private",
            },
          ],
          summary: { total_items: 1 },
        },
        graph: {
          cycles: [["core.ts", "adapter.ts"]],
          nodes: [
            {
              betweenness: 0.8,
              in_degree: 4,
              instability: 0.2,
              out_degree: 1,
              pagerank: 0.6,
              path: "core.ts",
            },
          ],
        },
        hotspot: {
          files: [
            {
              avg_cognitive: 3,
              commits: 8,
              hotspot_score: 0.75,
              path: "core.ts",
            },
          ],
        },
        smells: {
          smells: [
            {
              components: ["core.ts"],
              description: "Central connector",
              metrics: { fan_in: 4, fan_out: 1 },
              severity: "high",
              smell_type: "central_connector",
              suggestion: "Inspect the seam",
            },
          ],
        },
      },
      failures: [],
      toolVersion: "omen 4.0.0",
    };
  },
};

test("normalizes deterministic evidence for all maintenance-risk phases", async () => {
  const result = await surveyMaintenanceRisk({
    analyzerAdapters: [completeAnalyzerAdapter],
    depth: "quick",
    repositoryPath: createRepository(),
  });

  assert.equal(result.status, "complete");
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.diagnostic, "maintenance-risk");
  assert.deepEqual(Object.keys(result.evidence).sort(), [
    "changeAmplification",
    "cognitiveComplexity",
    "deadArchitecture",
    "dependencyPathology",
    "hotspots",
    "temporalCoupling",
  ]);
  assert.equal(result.evidence.hotspots.items[0]?.path, "core.ts");
  assert.equal(
    result.evidence.cognitiveComplexity.items[0]?.functionName,
    "core",
  );
  assert.equal(
    result.evidence.deadArchitecture.items[0]?.claimType,
    "measured-candidate",
  );
  assert.equal(
    result.evidence.dependencyPathology.items[0]?.source,
    "fixture-analyzer",
  );

  for (const phase of Object.values(result.evidence)) {
    assert.equal(phase.status, "complete");
    assert.ok(phase.provenance.length > 0);
    assert.ok(
      phase.provenance.every(
        ({ evidenceStrength }) => evidenceStrength.level >= 2,
      ),
    );
  }
});

test("reuses mechanically extracted Graphify edges for dependency pathology", async () => {
  const repositoryPath = createRepository();
  const graphDirectory = join(repositoryPath, "graphify-out");
  mkdirSync(graphDirectory);
  writeFileSync(
    join(graphDirectory, "graph.json"),
    JSON.stringify({
      links: [
        {
          confidence: "EXTRACTED",
          relation: "imports",
          source: "core",
          target: "adapter",
        },
        {
          confidence: "EXTRACTED",
          relation: "imports",
          source: "adapter",
          target: "core",
        },
        {
          confidence: "INFERRED",
          relation: "conceptually_related_to",
          source: "guess",
          target: "core",
        },
        {
          confidence: "EXTRACTED",
          relation: "cites",
          source: "docs",
          target: "core",
        },
      ],
      nodes: [
        { id: "core", source_file: "core.ts", community: 1 },
        { id: "adapter", source_file: "adapter.ts", community: 2 },
        { id: "guess", source_file: "guess.ts", community: 2 },
        {
          id: "docs",
          source_file: "README.md",
          file_type: "document",
          community: 2,
        },
      ],
    }),
  );

  const result = await surveyMaintenanceRisk({
    analyzerAdapters: [completeAnalyzerAdapter],
    depth: "quick",
    repositoryPath,
  });

  const dependency = result.evidence.dependencyPathology;
  assert.equal(dependency.items[0]?.source, "graphify");
  assert.deepEqual(dependency.items[0]?.cycles, [
    ["adapter.ts", "core.ts"],
  ]);
  assert.equal(dependency.items[0]?.mechanicalEdgeCount, 2);
  assert.equal(dependency.items[0]?.nonMechanicalEdgeCount, 2);
  assert.equal(dependency.items[0]?.crossCommunityEdges, 2);
  assert.match(dependency.provenance[0]?.source ?? "", /graphify-out/);
});

test("marks analyzer-backed phases unavailable without fabricating findings", async () => {
  const unavailableAdapter: AnalyzerAdapter = {
    name: "omen",
    async analyze() {
      return {
        commands: {},
        failures: [
          {
            capability: "static-analysis",
            message: "omen is not installed",
          },
        ],
        toolVersion: "unavailable",
      };
    },
  };

  const result = await surveyMaintenanceRisk({
    analyzerAdapters: [unavailableAdapter],
    depth: "quick",
    repositoryPath: createRepository(),
  });

  assert.equal(result.status, "partial");
  assert.deepEqual(result.evidence.hotspots.items, []);
  assert.equal(result.evidence.hotspots.status, "unavailable");
  assert.equal(result.evidence.cognitiveComplexity.status, "unavailable");
  assert.equal(result.evidence.deadArchitecture.status, "unavailable");
  assert.equal(result.evidence.dependencyPathology.status, "unavailable");
  assert.match(result.failures.at(-1)?.message ?? "", /not installed/);
});

test("marks dependency evidence partial without claiming failed commands", async () => {
  const incompleteAdapter: AnalyzerAdapter = {
    name: "partial-analyzer",
    async analyze(options) {
      const complete = await completeAnalyzerAdapter.analyze(options);
      delete complete.commands.smells;
      complete.failures.push({
        capability: "dependency-pathology",
        message: "smells failed",
      });
      return complete;
    },
  };

  const result = await surveyMaintenanceRisk({
    analyzerAdapters: [incompleteAdapter],
    depth: "quick",
    repositoryPath: createRepository(),
  });

  const dependency = result.evidence.dependencyPathology;
  assert.equal(dependency.status, "partial");
  assert.deepEqual(
    dependency.provenance.map(({ command }) => command),
    ["graph"],
  );
  assert.equal(result.status, "partial");
});

test("falls back to analyzer dependency evidence when Graphify is empty", async () => {
  const repositoryPath = createRepository();
  const graphDirectory = join(repositoryPath, "graphify-out");
  mkdirSync(graphDirectory);
  writeFileSync(
    join(graphDirectory, "graph.json"),
    '{"nodes":[],"links":[]}',
  );

  const result = await surveyMaintenanceRisk({
    analyzerAdapters: [completeAnalyzerAdapter],
    depth: "quick",
    repositoryPath,
  });

  assert.equal(
    result.evidence.dependencyPathology.items[0]?.source,
    "fixture-analyzer",
  );
  assert.equal(result.evidence.dependencyPathology.status, "complete");
});

test("propagates cancellation from the Omen adapter", async () => {
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    createOmenAdapter(process.execPath).analyze({
      depth: "quick",
      repositoryPath: createRepository(),
      signal: controller.signal,
    }),
    (error) =>
      error instanceof ProcessExecutionError && error.kind === "cancelled",
  );
});

test("analyzes large Graphify cycles without recursive traversal", async () => {
  const repositoryPath = createRepository();
  const graphDirectory = join(repositoryPath, "graphify-out");
  mkdirSync(graphDirectory);
  const nodeCount = 12_000;
  const nodes = Array.from({ length: nodeCount }, (_, index) => ({
    id: `node-${index}`,
    source_file: `src/file-${index}.ts`,
  }));
  const links = Array.from({ length: nodeCount }, (_, index) => ({
    confidence: "EXTRACTED",
    relation: "imports",
    source: `node-${index}`,
    target: `node-${(index + 1) % nodeCount}`,
  }));
  writeFileSync(
    join(graphDirectory, "graph.json"),
    JSON.stringify({ links, nodes }),
  );

  const result = await surveyMaintenanceRisk({
    analyzerAdapters: [completeAnalyzerAdapter],
    depth: "quick",
    repositoryPath,
  });

  assert.equal(
    result.evidence.dependencyPathology.items[0]?.cycles[0]?.length,
    nodeCount,
  );
});

test("bounds Graphify evidence by analysis depth", async () => {
  const repositoryPath = createRepository();
  const graphDirectory = join(repositoryPath, "graphify-out");
  mkdirSync(graphDirectory);
  const nodeCount = 20_001;
  const nodes = Array.from({ length: nodeCount }, (_, index) => ({
    id: `node-${index}`,
    source_file: `src/file-${index}.ts`,
  }));
  const links = Array.from({ length: nodeCount - 1 }, (_, index) => ({
    confidence: "EXTRACTED",
    relation: "imports",
    source: `node-${index}`,
    target: `node-${index + 1}`,
  }));
  writeFileSync(
    join(graphDirectory, "graph.json"),
    JSON.stringify({ links, nodes }),
  );

  const result = await surveyMaintenanceRisk({
    analyzerAdapters: [completeAnalyzerAdapter],
    depth: "quick",
    repositoryPath,
  });

  const dependency = result.evidence.dependencyPathology;
  assert.equal(dependency.status, "partial");
  assert.equal(dependency.provenance[0]?.command, "read graph (bounded)");
  assert.equal(dependency.items[0]?.nodes.length, 20_000);
  assert.equal(result.status, "partial");
});

test("records bounded Graphify failure before analyzer fallback", async () => {
  const repositoryPath = createRepository();
  const graphDirectory = join(repositoryPath, "graphify-out");
  mkdirSync(graphDirectory);
  const nodes = Array.from({ length: 20_001 }, (_, index) => ({
    id: `node-${index}`,
    source_file: `src/file-${index}.ts`,
  }));
  writeFileSync(
    join(graphDirectory, "graph.json"),
    JSON.stringify({
      links: [
        {
          confidence: "EXTRACTED",
          relation: "imports",
          source: "node-20000",
          target: "node-0",
        },
      ],
      nodes,
    }),
  );

  const result = await surveyMaintenanceRisk({
    analyzerAdapters: [completeAnalyzerAdapter],
    depth: "quick",
    repositoryPath,
  });

  assert.equal(
    result.evidence.dependencyPathology.items[0]?.source,
    "fixture-analyzer",
  );
  assert.ok(
    result.failures.some(
      ({ capability, message }) =>
        capability === "dependency-pathology" &&
        message.includes("was bounded") &&
        message.includes("before any usable mechanical dependency edge"),
    ),
  );
  assert.equal(result.status, "partial");
});
