import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { parseDocument } from "yaml";

import {
  inventorySkills,
  parseAgentSkillDocument,
  validateSkillReferences,
} from "./agent-skill-tooling.ts";
import { validateJsonSchemaInstance } from "./json-schema.ts";

export type CompositionKind =
  | "conflicts-with"
  | "consumes"
  | "invokes"
  | "may-invoke"
  | "overrides"
  | "produces"
  | "reads"
  | "requires"
  | "validates"
  | "writes";

export type CompositionEdge = {
  artifact?: string;
  bounded?: boolean;
  from: string;
  intentional?: boolean;
  kind: CompositionKind;
  to: string;
};

export type EcosystemNode = {
  availability?: "conditional" | "required";
  invocation?: "model-invoked" | "user-only";
  name: string;
};

export type EcosystemManifest = {
  edges: CompositionEdge[];
  nodes?: EcosystemNode[];
  version: "1";
};

export type IntegrityFinding = {
  code:
    | "broken-reference"
    | "duplicate-name"
    | "invalid-frontmatter"
    | "invalid-composition-manifest"
    | "invalid-user-only-metadata"
    | "invalid-json"
    | "json-schema-validation"
    | "manifest-invocation-mismatch"
    | "missing-discovery-root"
    | "missing-description"
    | "missing-name"
    | "unbounded-composition-cycle"
    | "unresolved-composition-skill"
    | "unresolved-orchestrator-child"
    | "user-only-composition-violation"
    | "user-only-metadata-mismatch";
  message: string;
  paths?: string[];
  skill?: string;
};

const invocationKinds = new Set<CompositionKind>([
  "invokes",
  "may-invoke",
  "requires",
]);
const compositionKinds = new Set<CompositionKind>([
  "conflicts-with",
  "consumes",
  "invokes",
  "may-invoke",
  "overrides",
  "produces",
  "reads",
  "requires",
  "validates",
  "writes",
]);

const findCycles = (edges: CompositionEdge[]) => {
  const adjacency = new Map<string, CompositionEdge[]>();
  for (const edge of edges.filter(({ kind }) => invocationKinds.has(kind))) {
    adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), edge]);
  }
  const cycles: CompositionEdge[][] = [];
  const seenKeys = new Set<string>();

  const visit = (
    start: string,
    current: string,
    path: CompositionEdge[],
    visited: Set<string>,
  ) => {
    for (const edge of adjacency.get(current) ?? []) {
      if (edge.to === start) {
        const cycle = [...path, edge];
        const names = cycle.map(({ from }) => from);
        const rotations = names.map((_, index) =>
          [...names.slice(index), ...names.slice(0, index)].join("->"),
        );
        const key = rotations.sort()[0] ?? "";
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          cycles.push(cycle);
        }
      } else if (!visited.has(edge.to)) {
        visit(start, edge.to, [...path, edge], new Set([...visited, edge.to]));
      }
    }
  };

  for (const name of adjacency.keys()) {
    visit(name, name, [], new Set([name]));
  }
  return cycles;
};

const readManifest = (path: string, required: boolean) => {
  if (!existsSync(path)) {
    return {
      problems: required ? [`manifest does not exist: ${path}`] : [],
      value: undefined,
    };
  }
  try {
    return {
      problems: [] as string[],
      value: JSON.parse(readFileSync(path, "utf8")) as unknown,
    };
  } catch (error) {
    return {
      problems: [
        `${path}: ${error instanceof Error ? error.message : String(error)}`,
      ],
      value: undefined,
    };
  }
};

const normalizeManifest = (value: unknown) => {
  const problems: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      manifest: { edges: [], nodes: [], version: "1" as const },
      problems: ["manifest must be an object"],
    };
  }
  const candidate = value as {
    edges?: unknown;
    nodes?: unknown;
    version?: unknown;
  };
  if (candidate.version !== "1") problems.push("version must equal 1");
  if (!Array.isArray(candidate.edges)) {
    problems.push("edges must be an array");
  }
  const edges: CompositionEdge[] = [];
  const nodes: EcosystemNode[] = [];
  if (candidate.nodes !== undefined && !Array.isArray(candidate.nodes)) {
    problems.push("nodes must be an array when present");
  }
  for (const [index, rawNode] of (Array.isArray(candidate.nodes)
    ? candidate.nodes
    : []
  ).entries()) {
    if (!rawNode || typeof rawNode !== "object" || Array.isArray(rawNode)) {
      problems.push(`nodes[${index}] must be an object`);
      continue;
    }
    const node = rawNode as Record<string, unknown>;
    if (
      typeof node.name !== "string" ||
      (node.availability !== undefined &&
        node.availability !== "conditional" &&
        node.availability !== "required") ||
      (node.invocation !== undefined &&
        node.invocation !== "model-invoked" &&
        node.invocation !== "user-only")
    ) {
      problems.push(`nodes[${index}] has an invalid name, availability, or invocation`);
      continue;
    }
    nodes.push({
      availability: node.availability as EcosystemNode["availability"],
      invocation: node.invocation as EcosystemNode["invocation"],
      name: node.name,
    });
  }
  if (new Set(nodes.map(({ name }) => name)).size !== nodes.length) {
    problems.push("nodes must have unique names");
  }
  for (const [index, rawEdge] of (Array.isArray(candidate.edges)
    ? candidate.edges
    : []
  ).entries()) {
    if (!rawEdge || typeof rawEdge !== "object" || Array.isArray(rawEdge)) {
      problems.push(`edges[${index}] must be an object`);
      continue;
    }
    const edge = rawEdge as Record<string, unknown>;
    if (
      typeof edge.from !== "string" ||
      typeof edge.to !== "string" ||
      typeof edge.kind !== "string" ||
      !compositionKinds.has(edge.kind as CompositionKind) ||
      (edge.bounded !== undefined && typeof edge.bounded !== "boolean") ||
      (edge.intentional !== undefined && typeof edge.intentional !== "boolean") ||
      (edge.artifact !== undefined && typeof edge.artifact !== "string")
    ) {
      problems.push(`edges[${index}] has an invalid endpoint, kind, or bound`);
      continue;
    }
    edges.push({
      artifact: edge.artifact as string | undefined,
      bounded: edge.bounded as boolean | undefined,
      from: edge.from,
      intentional: edge.intentional as boolean | undefined,
      kind: edge.kind as CompositionKind,
      to: edge.to,
    });
  }
  return { manifest: { edges, nodes, version: "1" as const }, problems };
};

const discoveryRoots = (repositoryRoot: string) => {
  const pluginPath = join(repositoryRoot, ".claude-plugin", "plugin.json");
  if (existsSync(pluginPath)) {
    try {
      const plugin = JSON.parse(readFileSync(pluginPath, "utf8")) as {
        skills?: unknown;
      };
      if (
        Array.isArray(plugin.skills) &&
        plugin.skills.every((entry) => typeof entry === "string")
      ) {
        return plugin.skills.map((entry) => resolve(repositoryRoot, entry));
      }
    } catch {
      // JSON readability is reported below with the other schemas.
    }
  }
  const skillsRoot = join(repositoryRoot, "skills");
  return [existsSync(skillsRoot) ? skillsRoot : repositoryRoot];
};

const inventoryDiscoveryScope = (repositoryRoot: string) => {
  const roots = discoveryRoots(repositoryRoot);
  const missingDiscoveryRoots = roots.filter((root) => !existsSync(root));
  const inventories = roots.filter(existsSync).map((root) =>
    inventorySkills({ repositoryRoot, root }),
  );
  const skills = inventories.flatMap(({ skills }) => skills);
  const names = new Map<string, string[]>();
  for (const record of skills) {
    if (!record.declaredName) continue;
    names.set(record.declaredName, [
      ...(names.get(record.declaredName) ?? []),
      record.skillPath,
    ]);
  }
  return {
    duplicateNames: Object.fromEntries(
      [...names.entries()].filter(([, paths]) => paths.length > 1),
    ),
    repositoryInstructions: [
      ...new Set(
        inventories.flatMap(({ repositoryInstructions }) =>
          repositoryInstructions,
        ),
      ),
    ].sort(),
    repositoryRoot,
    root: repositoryRoot,
    missingDiscoveryRoots,
    skills: skills.sort((left, right) =>
      left.skillPath.localeCompare(right.skillPath),
    ),
  };
};

const readSidecarInvocationMetadata = (path: string) => {
  if (!existsSync(path)) {
    return { allowImplicitInvocation: undefined, problems: [] as string[] };
  }
  const document = parseDocument(readFileSync(path, "utf8"), {
    prettyErrors: false,
  });
  if (document.errors.length > 0) {
    return {
      allowImplicitInvocation: undefined,
      problems: document.errors.map(
        (error) => `${path}: ${error.code ?? "invalid YAML"}`,
      ),
    };
  }
  const parsed = document.toJS() as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      allowImplicitInvocation: undefined,
      problems: [`${path}: sidecar must be a YAML mapping`],
    };
  }
  const policy = (parsed as Record<string, unknown>).policy;
  if (policy === undefined) {
    return { allowImplicitInvocation: undefined, problems: [] as string[] };
  }
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    return {
      allowImplicitInvocation: undefined,
      problems: [`${path}: policy must be a YAML mapping`],
    };
  }
  const value = (policy as Record<string, unknown>).allow_implicit_invocation;
  if (value === undefined) {
    return { allowImplicitInvocation: undefined, problems: [] as string[] };
  }
  if (typeof value !== "boolean") {
    return {
      allowImplicitInvocation: undefined,
      problems: [
        `${path}: policy.allow_implicit_invocation must be a boolean`,
      ],
    };
  }
  return { allowImplicitInvocation: value, problems: [] as string[] };
};

const orchestratorChildren = (body: string) => {
  const names = new Set<string>();
  for (const line of body.split(/\r?\n/)) {
    if (!/Skill tool/i.test(line) || /when .*available|if .*available/i.test(line)) {
      continue;
    }
    for (const match of line.matchAll(/["`]([a-z0-9][a-z0-9-]+)["`]/gi)) {
      if (match[1]) names.add(match[1]);
    }
  }
  return [...names];
};

export const checkSkillEcosystemIntegrity = (options: {
  manifest?: EcosystemManifest;
  manifestPath?: string;
  repositoryRoot: string;
}) => {
  const repositoryRoot = resolve(options.repositoryRoot);
  const inventory = inventoryDiscoveryScope(repositoryRoot);
  const findings: IntegrityFinding[] = [];
  const userOnlySkills = new Set<string>();
  const names = new Set(
    inventory.skills.flatMap(({ declaredName }) =>
      declaredName ? [declaredName] : [],
    ),
  );

  for (const path of inventory.missingDiscoveryRoots) {
    findings.push({
      code: "missing-discovery-root",
      message: `Plugin discovery root does not exist: ${path}`,
      paths: [path],
    });
  }

  for (const [name, paths] of Object.entries(inventory.duplicateNames)) {
    findings.push({
      code: "duplicate-name",
      message: `Skill name ${name} is declared in more than one discovery path.`,
      paths,
      skill: name,
    });
  }

  for (const record of inventory.skills) {
    const skillPath = join(repositoryRoot, ...record.skillPath.split("/"));
    const document = parseAgentSkillDocument(readFileSync(skillPath, "utf8"));
    if (!document.fields.name) {
      findings.push({
        code: "missing-name",
        message: "SKILL.md has no scalar name field.",
        paths: [record.skillPath],
      });
    }
    if (!document.fields.description) {
      findings.push({
        code: "missing-description",
        message: "SKILL.md has no scalar description field.",
        paths: [record.skillPath],
        skill: document.fields.name,
      });
    }
    if (
      document.warnings.some(
        (warning) =>
          warning === "missing-frontmatter" ||
          warning.startsWith("invalid-frontmatter:"),
      )
    ) {
      findings.push({
        code: "invalid-frontmatter",
        message: document.warnings.join(", "),
        paths: [record.skillPath],
        skill: document.fields.name,
      });
    }

    const invocationKey = "disable-model-invocation";
    const invocationValue = document.frontmatter[invocationKey];
    const invocationKeyPresent = new RegExp(`^${invocationKey}\\s*:`, "m").test(
      document.frontmatterRaw,
    );
    if (
      invocationKeyPresent &&
      (document.warnings.some((warning) =>
        warning.startsWith("invalid-frontmatter:"),
      ) ||
        typeof invocationValue !== "boolean")
    ) {
      findings.push({
        code: "invalid-user-only-metadata",
        message: `${record.skillPath}: ${invocationKey} must be a boolean`,
        paths: [record.skillPath],
        skill: document.fields.name,
      });
    }
    const userOnly = invocationValue === true;
    if (userOnly && document.fields.name) {
      userOnlySkills.add(document.fields.name);
    }
    const sidecarPath = join(dirname(skillPath), "agents", "openai.yaml");
    const sidecarMetadata = readSidecarInvocationMetadata(sidecarPath);
    for (const problem of sidecarMetadata.problems) {
      findings.push({
        code: "invalid-user-only-metadata",
        message: problem,
        paths: [sidecarPath],
        skill: document.fields.name,
      });
    }
    const codexUserOnly = sidecarMetadata.allowImplicitInvocation === false;
    if (userOnly !== codexUserOnly) {
      findings.push({
        code: "user-only-metadata-mismatch",
        message:
          "Claude Code and Codex user-only invocation metadata must agree.",
        paths: [record.skillPath],
        skill: document.fields.name,
      });
    }

    for (const reference of validateSkillReferences(skillPath).filter(
      ({ kind }) => kind === "broken",
    )) {
      findings.push({
        code: "broken-reference",
        message: `${reference.kind} reference: ${reference.target}`,
        paths: [record.skillPath],
        skill: document.fields.name,
      });
    }

    for (const child of orchestratorChildren(document.body)) {
      if (!names.has(child)) {
        findings.push({
          code: "unresolved-orchestrator-child",
          message: `${document.fields.name ?? record.directoryName} invokes unknown skill ${child}.`,
          paths: [record.skillPath],
          skill: document.fields.name,
        });
      }
    }

    for (const asset of record.assets.filter((path) => path.endsWith(".json"))) {
      const assetPath = join(dirname(skillPath), ...asset.split("/"));
      try {
        JSON.parse(readFileSync(assetPath, "utf8"));
      } catch (error) {
        findings.push({
          code: "invalid-json",
          message: error instanceof Error ? error.message : String(error),
          paths: [assetPath],
          skill: document.fields.name,
        });
      }
    }

    const jsonAssets = record.assets.filter((path) => path.endsWith(".json"));
    for (const schemaAsset of jsonAssets.filter((path) =>
      path.endsWith(".schema.json"),
    )) {
      const schemaName = schemaAsset
        .split("/")
        .at(-1)
        ?.replace(/\.schema\.json$/, "");
      if (!schemaName) continue;
      const schemaPath = join(dirname(skillPath), ...schemaAsset.split("/"));
      let schema: unknown;
      try {
        schema = JSON.parse(readFileSync(schemaPath, "utf8")) as unknown;
      } catch {
        continue;
      }
      for (const instanceAsset of jsonAssets.filter((path) => {
        if (path.endsWith(".schema.json")) return false;
        const name = path.split("/").at(-1) ?? "";
        return name === `${schemaName}.json` || name.startsWith(`${schemaName}.`);
      })) {
        const instancePath = join(
          dirname(skillPath),
          ...instanceAsset.split("/"),
        );
        let instance: unknown;
        try {
          instance = JSON.parse(readFileSync(instancePath, "utf8")) as unknown;
        } catch {
          continue;
        }
        const errors = validateJsonSchemaInstance(schema, instance);
        if (errors.length > 0) {
          findings.push({
            code: "json-schema-validation",
            message: `${instanceAsset} violates ${schemaAsset}: ${errors.join("; ")}`,
            paths: [instancePath, schemaPath],
            skill: document.fields.name,
          });
        }
      }
    }
  }

  const loadedManifest =
    options.manifest !== undefined
      ? { problems: [] as string[], value: options.manifest as unknown }
      : readManifest(
          options.manifestPath ??
            join(repositoryRoot, ".agents", "skill-ecosystem.json"),
          options.manifestPath !== undefined,
        );
  const normalizedManifest = normalizeManifest(
    loadedManifest.value ?? {
      edges: [],
      version: "1",
    },
  );
  const manifest = normalizedManifest.manifest;
  const manifestProblems = [
    ...loadedManifest.problems,
    ...normalizedManifest.problems,
  ];
  if (manifestProblems.length > 0) {
    findings.push({
      code: "invalid-composition-manifest",
      message: manifestProblems.join("; "),
    });
  }
  const declaredNodes = new Map(
    manifest.nodes.map((node) => [node.name, node] as const),
  );
  for (const node of manifest.nodes) {
    if (node.availability !== "conditional" && !names.has(node.name)) {
      findings.push({
        code: "unresolved-composition-skill",
        message: `Required manifest node is not discovered: ${node.name}.`,
        skill: node.name,
      });
    }
    if (names.has(node.name) && node.invocation) {
      const actual = userOnlySkills.has(node.name)
        ? "user-only"
        : "model-invoked";
      if (actual !== node.invocation) {
        findings.push({
          code: "manifest-invocation-mismatch",
          message: `${node.name} is ${actual}, but the manifest declares ${node.invocation}.`,
          skill: node.name,
        });
      }
    }
  }
  for (const edge of manifest.edges) {
    for (const endpoint of [edge.from, edge.to]) {
      if (!names.has(endpoint) && !declaredNodes.has(endpoint)) {
        findings.push({
          code: "unresolved-composition-skill",
          message: `${edge.kind} edge refers to unknown skill ${endpoint}.`,
          skill: endpoint,
        });
      }
    }
    if (
      (edge.kind === "invokes" || edge.kind === "may-invoke") &&
      (userOnlySkills.has(edge.to) ||
        declaredNodes.get(edge.to)?.invocation === "user-only")
    ) {
      findings.push({
        code: "user-only-composition-violation",
        message: `${edge.from} cannot autonomously ${edge.kind} user-only skill ${edge.to}.`,
        skill: edge.to,
      });
    }
  }
  const cycles = findCycles(manifest.edges);
  for (const cycle of cycles.filter(
    (candidate) => !candidate.every(({ bounded }) => bounded === true),
  )) {
    findings.push({
      code: "unbounded-composition-cycle",
      message: `${cycle.map(({ from }) => from).join(" -> ")} -> ${cycle[0]?.from ?? ""}`,
      paths: [],
    });
  }

  return {
    composition: { cycles, edges: manifest.edges, nodes: manifest.nodes },
    findings,
    inventory,
    valid: findings.length === 0,
    version: "1",
  };
};
