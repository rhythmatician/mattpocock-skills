import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { ProcessExecutionError, runProcess } from "./process.ts";

export type AnalysisDepth = "quick" | "standard" | "deep";

export type EvidenceProvenance = {
  analyzer: string;
  command: string;
  evidenceStrength: {
    basis: "executed-analysis" | "persisted-source";
    level: 2 | 4;
  };
  source: string;
  toolVersion: string;
};

export type EvidenceSet<T> = {
  items: T[];
  provenance: EvidenceProvenance[];
  status: "complete" | "partial" | "unavailable";
};

export type AnalyzerFailure = {
  capability:
    | "cognitive-complexity"
    | "dead-architecture"
    | "dependency-pathology"
    | "hotspots"
    | "static-analysis";
  message: string;
};

export type AnalyzerAdapterResult = {
  commands: Partial<
    Record<"complexity" | "deadcode" | "graph" | "hotspot" | "smells", unknown>
  >;
  failures: AnalyzerFailure[];
  toolVersion: string;
};

export type AnalyzerAdapter = {
  analyze(options: {
    depth: AnalysisDepth;
    repositoryPath: string;
    signal?: AbortSignal;
  }): Promise<AnalyzerAdapterResult>;
  name: string;
};

export type MaintenanceHotspot = {
  averageCognitiveComplexity: number;
  changes: number;
  path: string;
  score: number;
};

export type CognitiveComplexityFinding = {
  cognitive: number;
  cyclomatic: number;
  endLine: number;
  functionName: string;
  maxNesting: number;
  path: string;
  startLine: number;
};

export type DeadArchitectureCandidate = {
  claimType: "measured-candidate";
  confidence: number;
  endLine: number;
  kind: string;
  line: number;
  name: string;
  path: string;
  reason: string;
  visibility: string;
};

export type DependencyNode = {
  betweenness?: number;
  fanIn: number;
  fanOut: number;
  instability?: number;
  path: string;
  rank?: number;
};

export type DependencySmell = {
  components: string[];
  description: string;
  metrics: Record<string, number>;
  severity: string;
  type: string;
};

export type DependencyPathology = {
  crossCommunityEdges: number;
  cycles: string[][];
  mechanicalEdgeCount: number;
  nonMechanicalEdgeCount: number;
  nodes: DependencyNode[];
  smells: DependencySmell[];
  source: string;
};

export type StaticEvidence = {
  cognitiveComplexity: EvidenceSet<CognitiveComplexityFinding>;
  deadArchitecture: EvidenceSet<DeadArchitectureCandidate>;
  dependencyPathology: EvidenceSet<DependencyPathology>;
  failures: AnalyzerFailure[];
  hotspots: EvidenceSet<MaintenanceHotspot>;
};

const DEPTH_LIMITS: Record<
  AnalysisDepth,
  {
    maxGraphEdges: number;
    maxGraphNodes: number;
    maxOutputBytes: number;
    timeoutMs: number;
    top: number;
  }
> = {
  quick: {
    maxGraphEdges: 50_000,
    maxGraphNodes: 20_000,
    maxOutputBytes: 8 * 1024 * 1024,
    timeoutMs: 15_000,
    top: 100,
  },
  standard: {
    maxGraphEdges: 250_000,
    maxGraphNodes: 100_000,
    maxOutputBytes: 32 * 1024 * 1024,
    timeoutMs: 60_000,
    top: 500,
  },
  deep: {
    maxGraphEdges: 1_000_000,
    maxGraphNodes: 250_000,
    maxOutputBytes: 64 * 1024 * 1024,
    timeoutMs: 180_000,
    top: 2_000,
  },
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringValue = (value: unknown, fallback = "") =>
  typeof value === "string" ? value : fallback;

const numberValue = (value: unknown, fallback = 0) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const recordArray = (value: unknown) =>
  Array.isArray(value) ? value.filter(isRecord) : [];

const DEPENDENCY_RELATIONS = new Set([
  "calls",
  "depends_on",
  "extends",
  "implements",
  "imports",
  "references",
  "uses",
]);

const graphifyPath = (repositoryPath: string) =>
  join(repositoryPath, "graphify-out", "graph.json");

const commandCapability = (
  command: keyof AnalyzerAdapterResult["commands"],
): AnalyzerFailure["capability"] => {
  switch (command) {
    case "complexity":
      return "cognitive-complexity";
    case "deadcode":
      return "dead-architecture";
    case "graph":
    case "smells":
      return "dependency-pathology";
    case "hotspot":
      return "hotspots";
  }
};

export const createOmenAdapter = (
  executable = "omen",
): AnalyzerAdapter => ({
  name: "omen",
  async analyze(options) {
    const limits = DEPTH_LIMITS[options.depth];
    let toolVersion: string;
    try {
      const version = await runProcess({
        args: ["--version"],
        cwd: options.repositoryPath,
        executable,
        maxOutputBytes: 64 * 1024,
        signal: options.signal,
        timeoutMs: 5_000,
      });
      if (version.exitCode !== 0) {
        throw new Error(
          version.stderr.trim() ||
            `${executable} --version exited with ${version.exitCode ?? "unknown"}`,
        );
      }
      toolVersion = version.stdout.trim();
    } catch (error) {
      if (
        error instanceof ProcessExecutionError &&
        error.kind === "cancelled"
      ) {
        throw error;
      }
      return {
        commands: {},
        failures: [
          {
            capability: "static-analysis",
            message: `${executable} is not available or usable: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
        toolVersion: "unavailable",
      };
    }

    const commands: Array<
      "complexity" | "deadcode" | "graph" | "hotspot" | "smells"
    > = ["complexity", "deadcode", "graph", "hotspot", "smells"];
    const results = await Promise.all(
      commands.map(async (command) => {
        try {
          const result = await runProcess({
            args: [
              "--path",
              options.repositoryPath,
              "--format",
              "json",
              "--compact",
              command,
              "--top",
              String(limits.top),
            ],
            cwd: options.repositoryPath,
            executable,
            maxOutputBytes: limits.maxOutputBytes,
            signal: options.signal,
            timeoutMs: limits.timeoutMs,
          });
          if (result.exitCode !== 0) {
            throw new Error(
              result.stderr.trim() ||
                `${command} exited with ${result.exitCode ?? "unknown"}`,
            );
          }
          return {
            command,
            output: JSON.parse(result.stdout) as unknown,
          };
        } catch (error) {
          if (
            error instanceof ProcessExecutionError &&
            error.kind === "cancelled"
          ) {
            throw error;
          }
          return {
            command,
            failure: {
              capability: commandCapability(command),
              message: `${executable} ${command} failed: ${
                error instanceof Error ? error.message : String(error)
              }`,
            } satisfies AnalyzerFailure,
          };
        }
      }),
    );

    const commandOutput: AnalyzerAdapterResult["commands"] = {};
    const failures: AnalyzerFailure[] = [];
    for (const result of results) {
      if ("failure" in result && result.failure) {
        failures.push(result.failure);
      } else {
        commandOutput[result.command] = result.output;
      }
    }
    return { commands: commandOutput, failures, toolVersion };
  },
});

const unavailable = <T>(): EvidenceSet<T> => ({
  items: [],
  provenance: [],
  status: "unavailable",
});

const provenanceFor = (
  analyzer: string,
  command: string,
  toolVersion: string,
): EvidenceProvenance => ({
  analyzer,
  command,
  evidenceStrength: { basis: "executed-analysis", level: 4 },
  source: command,
  toolVersion,
});

const normalizeHotspots = (
  output: unknown,
  provenance: EvidenceProvenance,
): EvidenceSet<MaintenanceHotspot> => {
  if (!isRecord(output)) return unavailable();
  const files = recordArray(output.files ?? output.hotspots);
  return {
    items: files
      .map((file) => ({
        averageCognitiveComplexity: numberValue(
          file.avg_cognitive ?? file.avg_complexity,
        ),
        changes: numberValue(file.commits),
        path: stringValue(file.path ?? file.file),
        score: numberValue(file.hotspot_score ?? file.score),
      }))
      .filter(({ path }) => path.length > 0)
      .sort(
        (left, right) =>
          right.score - left.score || left.path.localeCompare(right.path),
      ),
    provenance: [provenance],
    status: "complete",
  };
};

const normalizeComplexity = (
  output: unknown,
  provenance: EvidenceProvenance,
): EvidenceSet<CognitiveComplexityFinding> => {
  if (!isRecord(output) || !Array.isArray(output.files)) return unavailable();
  const findings = recordArray(output.files).flatMap((file) => {
    const path = stringValue(file.path);
    return recordArray(file.functions).map((fn) => {
      const metrics = isRecord(fn.metrics) ? fn.metrics : {};
      return {
        cognitive: numberValue(metrics.cognitive),
        cyclomatic: numberValue(metrics.cyclomatic),
        endLine: numberValue(fn.end_line),
        functionName: stringValue(fn.name),
        maxNesting: numberValue(metrics.max_nesting),
        path,
        startLine: numberValue(fn.start_line),
      };
    });
  });
  return {
    items: findings
      .filter(({ functionName, path }) => functionName && path)
      .sort(
        (left, right) =>
          right.cognitive - left.cognitive ||
          right.maxNesting - left.maxNesting ||
          left.path.localeCompare(right.path) ||
          left.startLine - right.startLine,
      ),
    provenance: [provenance],
    status: "complete",
  };
};

const normalizeDeadArchitecture = (
  output: unknown,
  provenance: EvidenceProvenance,
): EvidenceSet<DeadArchitectureCandidate> => {
  if (!isRecord(output) || !Array.isArray(output.items)) return unavailable();
  return {
    items: recordArray(output.items)
      .map((item) => ({
        claimType: "measured-candidate" as const,
        confidence: numberValue(item.confidence),
        endLine: numberValue(item.end_line),
        kind: stringValue(item.kind),
        line: numberValue(item.line),
        name: stringValue(item.name),
        path: stringValue(item.file),
        reason: stringValue(item.reason),
        visibility: stringValue(item.visibility),
      }))
      .filter(({ name, path }) => name && path)
      .sort(
        (left, right) =>
          right.confidence - left.confidence ||
          left.path.localeCompare(right.path) ||
          left.line - right.line,
      ),
    provenance: [provenance],
    status: "complete",
  };
};

const normalizeSmells = (output: unknown): DependencySmell[] => {
  if (!isRecord(output) || !Array.isArray(output.smells)) return [];
  return recordArray(output.smells).map((smell) => {
    const metrics = isRecord(smell.metrics) ? smell.metrics : {};
    return {
      components: Array.isArray(smell.components)
        ? smell.components.filter(
            (component): component is string => typeof component === "string",
          )
        : [],
      description: stringValue(smell.description),
      metrics: Object.fromEntries(
        Object.entries(metrics).filter(
          (entry): entry is [string, number] =>
            typeof entry[1] === "number" && Number.isFinite(entry[1]),
        ),
      ),
      severity: stringValue(smell.severity),
      type: stringValue(smell.smell_type),
    };
  });
};

const normalizeOmenDependency = (
  graphOutput: unknown,
  smellsOutput: unknown,
  provenance: EvidenceProvenance[],
  analyzer: string,
): EvidenceSet<DependencyPathology> => {
  const graphUsable = isRecord(graphOutput) && Array.isArray(graphOutput.nodes);
  const smellsUsable =
    isRecord(smellsOutput) && Array.isArray(smellsOutput.smells);
  if (!graphUsable && !smellsUsable) return unavailable();
  const graph = graphUsable ? graphOutput : {};
  const cycles = Array.isArray(graph.cycles)
    ? graph.cycles
        .filter(
          (cycle): cycle is string[] =>
            Array.isArray(cycle) &&
            cycle.every((path) => typeof path === "string"),
        )
        .map((cycle) => [...cycle])
    : [];
  const nodes = recordArray(graph.nodes)
    .map((node) => ({
      betweenness: numberValue(node.betweenness),
      fanIn: numberValue(node.in_degree),
      fanOut: numberValue(node.out_degree),
      instability: numberValue(node.instability),
      path: stringValue(node.path),
      rank: numberValue(node.pagerank),
    }))
    .filter(({ path }) => path.length > 0)
    .sort(
      (left, right) =>
        right.fanIn + right.fanOut - (left.fanIn + left.fanOut) ||
        left.path.localeCompare(right.path),
    );
  return {
    items: [
      {
        crossCommunityEdges: 0,
        cycles,
        nonMechanicalEdgeCount: 0,
        mechanicalEdgeCount: recordArray(graph.edges).length,
        nodes,
        smells: normalizeSmells(smellsOutput),
        source: analyzer,
      },
    ],
    provenance,
    status: graphUsable && smellsUsable ? "complete" : "partial",
  };
};

type GraphifyNode = {
  community?: string | number;
  fileType?: string;
  id: string;
  path: string;
};

type MechanicalEdge = {
  source: GraphifyNode;
  target: GraphifyNode;
};

const stronglyConnectedComponents = (
  paths: string[],
  adjacency: Map<string, Set<string>>,
  checkBudget: () => void,
) => {
  const orderedPaths = [...paths].sort();
  const reverseAdjacency = new Map<string, Set<string>>();
  for (const [source, targets] of adjacency) {
    for (const target of targets) {
      const sources = reverseAdjacency.get(target) ?? new Set<string>();
      sources.add(source);
      reverseAdjacency.set(target, sources);
    }
  }

  const finishOrder: string[] = [];
  const visited = new Set<string>();
  let traversalSteps = 0;
  for (const [index, start] of orderedPaths.entries()) {
    if (index % 1_000 === 0) checkBudget();
    if (visited.has(start)) continue;
    const stack: Array<{ expanded: boolean; path: string }> = [
      { expanded: false, path: start },
    ];
    while (stack.length > 0) {
      traversalSteps += 1;
      if (traversalSteps % 1_000 === 0) checkBudget();
      const current = stack.pop();
      if (!current) break;
      if (current.expanded) {
        finishOrder.push(current.path);
        continue;
      }
      if (visited.has(current.path)) continue;
      visited.add(current.path);
      stack.push({ expanded: true, path: current.path });
      const targets = [...(adjacency.get(current.path) ?? [])].sort().reverse();
      for (const target of targets) {
        if (!visited.has(target)) {
          stack.push({ expanded: false, path: target });
        }
      }
    }
  }

  const components: string[][] = [];
  visited.clear();
  for (const [index, start] of finishOrder.reverse().entries()) {
    if (index % 1_000 === 0) checkBudget();
    if (visited.has(start)) continue;
    const component: string[] = [];
    const stack = [start];
    visited.add(start);
    while (stack.length > 0) {
      traversalSteps += 1;
      if (traversalSteps % 1_000 === 0) checkBudget();
      const member = stack.pop();
      if (!member) break;
      component.push(member);
      const sources = [...(reverseAdjacency.get(member) ?? [])].sort().reverse();
      for (const source of sources) {
        if (!visited.has(source)) {
          visited.add(source);
          stack.push(source);
        }
      }
    }
    if (component.length > 1) components.push(component.sort());
  }
  return components.sort((left, right) =>
    left.join("\x00").localeCompare(right.join("\x00")),
  );
};

const readGraphifyEvidence = (
  repositoryPath: string,
  depth: AnalysisDepth,
  signal?: AbortSignal,
): EvidenceSet<DependencyPathology> | undefined => {
  const graphPath = graphifyPath(repositoryPath);
  if (!existsSync(graphPath)) return undefined;
  const limits = DEPTH_LIMITS[depth];
  const size = statSync(graphPath).size;
  if (size > limits.maxOutputBytes) {
    throw new Error(
      `${graphPath} is ${size} bytes, above the ${limits.maxOutputBytes}-byte ${depth} limit`,
    );
  }
  if (signal?.aborted) {
    throw new ProcessExecutionError(
      "Graphify analysis was cancelled",
      "cancelled",
    );
  }
  const deadline = Date.now() + limits.timeoutMs;
  const checkBudget = () => {
    if (signal?.aborted) {
      throw new ProcessExecutionError(
        "Graphify analysis was cancelled",
        "cancelled",
      );
    }
    if (Date.now() > deadline) {
      throw new ProcessExecutionError(
        `Graphify analysis exceeded the ${limits.timeoutMs}ms ${depth} limit`,
        "timeout",
      );
    }
  };
  const parsed = JSON.parse(readFileSync(graphPath, "utf8")) as unknown;
  if (
    !isRecord(parsed) ||
    !Array.isArray(parsed.nodes) ||
    (!Array.isArray(parsed.links) && !Array.isArray(parsed.edges))
  ) {
    throw new Error(`${graphPath} does not contain Graphify nodes and edges`);
  }

  const parsedNodes = recordArray(parsed.nodes);
  const parsedEdges = recordArray(parsed.links ?? parsed.edges);
  const graphWasTruncated =
    parsedNodes.length > limits.maxGraphNodes ||
    parsedEdges.length > limits.maxGraphEdges;
  const nodesById = new Map<string, GraphifyNode>();
  for (const [index, node] of parsedNodes
    .slice(0, limits.maxGraphNodes)
    .entries()) {
    if (index % 1_000 === 0) checkBudget();
    const id = stringValue(node.id);
    const path = stringValue(node.source_file ?? node.path, id);
    if (!id || !path) continue;
    const community =
      typeof node.community === "string" || typeof node.community === "number"
        ? node.community
        : undefined;
    nodesById.set(id, {
      community,
      fileType: stringValue(node.file_type) || undefined,
      id,
      path,
    });
  }

  const mechanicalEdges: MechanicalEdge[] = [];
  let nonMechanicalEdgeCount = 0;
  for (const [index, edge] of parsedEdges
    .slice(0, limits.maxGraphEdges)
    .entries()) {
    if (index % 1_000 === 0) checkBudget();
    const confidence = stringValue(edge.confidence);
    const relation = stringValue(edge.relation);
    const source = nodesById.get(stringValue(edge.source));
    const target = nodesById.get(stringValue(edge.target));
    const codeEndpoints =
      source?.fileType !== undefined || target?.fileType !== undefined
        ? source?.fileType === "code" && target?.fileType === "code"
        : true;
    if (
      confidence !== "EXTRACTED" ||
      !DEPENDENCY_RELATIONS.has(relation) ||
      !codeEndpoints
    ) {
      nonMechanicalEdgeCount += 1;
      continue;
    }
    if (!source || !target || source.path === target.path) continue;
    mechanicalEdges.push({ source, target });
  }
  if (mechanicalEdges.length === 0) {
    if (graphWasTruncated) {
      throw new Error(
        `${graphPath} was bounded at ${limits.maxGraphNodes} nodes and ${limits.maxGraphEdges} edges before any usable mechanical dependency edge was retained`,
      );
    }
    return undefined;
  }

  const fanIn = new Map<string, number>();
  const fanOut = new Map<string, number>();
  const adjacency = new Map<string, Set<string>>();
  let crossCommunityEdges = 0;
  for (const [index, { source, target }] of mechanicalEdges.entries()) {
    if (index % 1_000 === 0) checkBudget();
    fanOut.set(source.path, (fanOut.get(source.path) ?? 0) + 1);
    fanIn.set(target.path, (fanIn.get(target.path) ?? 0) + 1);
    const targets = adjacency.get(source.path) ?? new Set<string>();
    targets.add(target.path);
    adjacency.set(source.path, targets);
    if (
      source.community !== undefined &&
      target.community !== undefined &&
      source.community !== target.community
    ) {
      crossCommunityEdges += 1;
    }
  }
  const paths = [
    ...new Set(mechanicalEdges.flatMap(({ source, target }) => [source.path, target.path])),
  ];
  const nodes = paths
    .map((path) => ({
      fanIn: fanIn.get(path) ?? 0,
      fanOut: fanOut.get(path) ?? 0,
      path,
    }))
    .sort(
      (left, right) =>
        right.fanIn + right.fanOut - (left.fanIn + left.fanOut) ||
        left.path.localeCompare(right.path),
    );

  return {
    items: [
      {
        crossCommunityEdges,
        cycles: stronglyConnectedComponents(paths, adjacency, checkBudget),
        mechanicalEdgeCount: mechanicalEdges.length,
        nonMechanicalEdgeCount,
        nodes,
        smells: [],
        source: "graphify",
      },
    ],
    provenance: [
      {
        analyzer: "graphify",
        command: graphWasTruncated ? "read graph (bounded)" : "read graph",
        evidenceStrength: { basis: "persisted-source", level: 2 },
        source: graphPath,
        toolVersion: "persisted-artifact",
      },
    ],
    status: graphWasTruncated ? "partial" : "complete",
  };
};

export const collectStaticEvidence = async (options: {
  analyzerAdapters: AnalyzerAdapter[];
  depth: AnalysisDepth;
  repositoryPath: string;
  signal?: AbortSignal;
}): Promise<StaticEvidence> => {
  const adapterResults = await Promise.all(
    options.analyzerAdapters.map(async (adapter) => ({
      adapter,
      result: await adapter.analyze(options),
    })),
  );
  const failures = adapterResults.flatMap(({ result }) => result.failures);
  const commandSources = new Map<
    keyof AnalyzerAdapterResult["commands"],
    { analyzer: string; output: unknown; toolVersion: string }
  >();
  for (const { adapter, result } of adapterResults) {
    for (const [command, output] of Object.entries(result.commands)) {
      const commandName = command as keyof AnalyzerAdapterResult["commands"];
      if (!commandSources.has(commandName)) {
        commandSources.set(commandName, {
          analyzer: adapter.name,
          output,
          toolVersion: result.toolVersion,
        });
      }
    }
  }
  const outputFor = (command: keyof AnalyzerAdapterResult["commands"]) =>
    commandSources.get(command)?.output;
  const provenanceForCommand = (
    command: keyof AnalyzerAdapterResult["commands"],
  ) => {
    const source = commandSources.get(command);
    return source
      ? [provenanceFor(source.analyzer, command, source.toolVersion)]
      : [];
  };
  const dependencyAnalyzer =
    commandSources.get("graph")?.analyzer ??
    commandSources.get("smells")?.analyzer ??
    "unavailable";

  let dependencyPathology: EvidenceSet<DependencyPathology>;
  try {
    dependencyPathology =
      readGraphifyEvidence(
        options.repositoryPath,
        options.depth,
        options.signal,
      ) ??
      normalizeOmenDependency(
        outputFor("graph"),
        outputFor("smells"),
        [
          ...provenanceForCommand("graph"),
          ...provenanceForCommand("smells"),
        ],
        dependencyAnalyzer,
      );
  } catch (error) {
    if (
      error instanceof ProcessExecutionError &&
      error.kind === "cancelled"
    ) {
      throw error;
    }
    failures.push({
      capability: "dependency-pathology",
      message: `Graphify evidence could not be consumed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
    dependencyPathology = normalizeOmenDependency(
      outputFor("graph"),
      outputFor("smells"),
      [
        ...provenanceForCommand("graph"),
        ...provenanceForCommand("smells"),
      ],
      dependencyAnalyzer,
    );
    if (dependencyPathology.status === "complete") {
      dependencyPathology = { ...dependencyPathology, status: "partial" };
    }
  }

  const cognitiveComplexity = normalizeComplexity(
    outputFor("complexity"),
    provenanceForCommand("complexity")[0] ??
      provenanceFor("unavailable", "complexity", "unavailable"),
  );
  const deadArchitecture = normalizeDeadArchitecture(
    outputFor("deadcode"),
    provenanceForCommand("deadcode")[0] ??
      provenanceFor("unavailable", "deadcode", "unavailable"),
  );
  const hotspots = normalizeHotspots(
    outputFor("hotspot"),
    provenanceForCommand("hotspot")[0] ??
      provenanceFor("unavailable", "hotspot", "unavailable"),
  );
  const phaseSets = [
    ["cognitive-complexity", "complexity", cognitiveComplexity],
    ["dead-architecture", "deadcode", deadArchitecture],
    ["dependency-pathology", "graph or graphify", dependencyPathology],
    ["hotspots", "hotspot", hotspots],
  ] as const;
  for (const [capability, command, phase] of phaseSets) {
    if (
      phase.status === "unavailable" &&
      !failures.some(
        (failure) =>
          failure.capability === capability ||
          failure.capability === "static-analysis",
      )
    ) {
      failures.push({
        capability,
        message: `${command} returned no usable machine-readable evidence`,
      });
    }
  }

  return {
    cognitiveComplexity,
    deadArchitecture,
    dependencyPathology,
    failures,
    hotspots,
  };
};
