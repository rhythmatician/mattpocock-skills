import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { parseDocument } from "yaml";

const FRONTMATTER = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/;
const MARKDOWN_LINK = /\[[^\]]+\]\(([^)]+)\)/g;
const FENCED_BLOCK = /```[\s\S]*?```|~~~[\s\S]*?~~~/g;
const REMOTE_PREFIXES = ["http://", "https://", "mailto:", "data:"];
const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".gradle",
  ".idea",
  ".next",
  ".pytest_cache",
  ".tox",
  ".venv",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "target",
  "vendor",
]);
const INSTRUCTION_NAMES = new Set([
  "AGENTS.md",
  "CLAUDE.md",
  "CONTEXT.md",
  "CONTEXT-MAP.md",
]);

export type AgentSkillDocument = {
  body: string;
  fields: Record<string, string>;
  frontmatter: Record<string, unknown>;
  frontmatterRaw: string;
  warnings: string[];
};

const scalarAsString = (value: unknown) => {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null) return "";
  return undefined;
};

export const parseAgentSkillDocument = (text: string): AgentSkillDocument => {
  const match = FRONTMATTER.exec(text);
  if (!match) {
    return {
      body: text,
      fields: {},
      frontmatter: {},
      frontmatterRaw: "",
      warnings: ["missing-frontmatter"],
    };
  }

  const frontmatterRaw = match[1] ?? "";
  const document = parseDocument(frontmatterRaw, { prettyErrors: false });
  const warnings = document.errors.map(
    (error) => `invalid-frontmatter:${error.code ?? "parse-error"}`,
  );
  const parsed = document.errors.length === 0 ? document.toJS() : {};
  const frontmatter =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  const fields: Record<string, string> = {};

  for (const [key, value] of Object.entries(frontmatter)) {
    const scalar = scalarAsString(value);
    if (scalar === undefined) {
      warnings.push(`structured-field-preserved-raw:${key}`);
    } else {
      fields[key] = scalar;
    }
  }

  return {
    body: text.slice(match[0].length),
    fields,
    frontmatter,
    frontmatterRaw,
    warnings,
  };
};

const walkFiles = (root: string): string[] => {
  if (!existsSync(root)) return [];
  if (statSync(root).isFile()) return [resolve(root)];
  const files: string[] = [];
  const pending = [resolve(root)];
  while (pending.length > 0) {
    const directory = pending.pop();
    if (!directory) break;
    const entries = readdirSync(directory, { withFileTypes: true }).sort(
      (left, right) => right.name.localeCompare(left.name),
    );
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory() && !EXCLUDED_DIRECTORIES.has(entry.name)) {
        pending.push(path);
      } else if (entry.isFile()) {
        files.push(path);
      }
    }
  }
  return files.sort();
};

const portablePath = (path: string, root: string) =>
  relative(root, path).replaceAll("\\", "/");

const markdownTargets = (text: string) =>
  [...text.replace(FENCED_BLOCK, "").matchAll(MARKDOWN_LINK)].map(
    (match) => (match[1] ?? "").trim().replace(/^<|>$/g, "").split("#", 1)[0] ?? "",
  );

const heuristicTokens = (text: string) => {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  return Math.max(words, Math.ceil(text.length / 4));
};

export type SkillInventoryRecord = {
  assets: string[];
  bodyCharacters: number;
  bodyLines: number;
  bodyTokensHeuristic: number;
  bodyWords: number;
  contentSha256: string;
  declaredName?: string;
  description?: string;
  directReferences: string[];
  directoryName: string;
  frontmatter: Record<string, string>;
  frontmatterRaw: string;
  frontmatterWarnings: string[];
  scripts: string[];
  sidecars: string[];
  skillPath: string;
};

const filesUnder = (skillRoot: string, name: string) => {
  const folder = join(skillRoot, name);
  return walkFiles(folder).map((path) => portablePath(path, skillRoot));
};

export const inventorySkills = (options: {
  repositoryRoot: string;
  root: string;
}) => {
  const repositoryRoot = resolve(options.repositoryRoot);
  const root = resolve(options.root);
  const skillPaths = walkFiles(root).filter(
    (path) => path.split(/[\\/]/).at(-1) === "SKILL.md",
  );
  const skills: SkillInventoryRecord[] = skillPaths.map((path) => {
    const text = readFileSync(path, "utf8");
    const document = parseAgentSkillDocument(text);
    const skillRoot = dirname(path);
    const words = document.body.trim()
      ? document.body.trim().split(/\s+/).length
      : 0;
    return {
      assets: filesUnder(skillRoot, "assets"),
      bodyCharacters: document.body.length,
      bodyLines: document.body.split(/\r?\n/).length -
        (document.body.endsWith("\n") ? 1 : 0),
      bodyTokensHeuristic: heuristicTokens(document.body),
      bodyWords: words,
      contentSha256: createHash("sha256").update(text).digest("hex"),
      declaredName: document.fields.name,
      description: document.fields.description,
      directReferences: markdownTargets(document.body),
      directoryName: skillRoot.split(/[\\/]/).at(-1) ?? "",
      frontmatter: document.fields,
      frontmatterRaw: document.frontmatterRaw,
      frontmatterWarnings: document.warnings,
      scripts: filesUnder(skillRoot, "scripts"),
      sidecars: filesUnder(skillRoot, "agents"),
      skillPath: portablePath(path, repositoryRoot),
    };
  });
  const names = new Map<string, string[]>();
  for (const record of skills) {
    if (!record.declaredName) continue;
    const paths = names.get(record.declaredName) ?? [];
    paths.push(record.skillPath);
    names.set(record.declaredName, paths);
  }
  const duplicateNames = Object.fromEntries(
    [...names.entries()].filter(([, paths]) => paths.length > 1),
  );

  const anchor = statSync(root).isFile() ? dirname(root) : root;
  const scopedInstructions = new Set<string>();
  let current = anchor;
  while (true) {
    for (const name of INSTRUCTION_NAMES) {
      const candidate = join(current, name);
      if (existsSync(candidate)) scopedInstructions.add(candidate);
    }
    if (current === repositoryRoot) break;
    const parent = dirname(current);
    if (parent === current || !current.startsWith(repositoryRoot)) break;
    current = parent;
  }
  for (const path of walkFiles(anchor)) {
    if (INSTRUCTION_NAMES.has(path.split(/[\\/]/).at(-1) ?? "")) {
      scopedInstructions.add(path);
    }
  }

  return {
    duplicateNames,
    repositoryInstructions: [...scopedInstructions]
      .map((path) => portablePath(path, repositoryRoot))
      .sort(),
    repositoryRoot,
    root,
    skills,
  };
};

export type SkillReferenceFinding = {
  kind: "broken" | "deeper-than-one-hop" | "external";
  source: string;
  target: string;
};

const resolveTarget = (source: string, skillRoot: string, target: string) => {
  const decoded = decodeURIComponent(target);
  const relativeTarget = resolve(dirname(source), decoded);
  if (existsSync(relativeTarget) || dirname(source) === skillRoot) {
    return relativeTarget;
  }
  return resolve(skillRoot, decoded);
};

export const validateSkillReferences = (
  skillPath: string,
): SkillReferenceFinding[] => {
  const absoluteSkillPath = resolve(skillPath);
  const skillRoot = dirname(absoluteSkillPath);
  const findings: SkillReferenceFinding[] = [];
  const directFiles: string[] = [];

  for (const target of markdownTargets(readFileSync(absoluteSkillPath, "utf8"))) {
    if (!target || REMOTE_PREFIXES.some((prefix) => target.startsWith(prefix))) {
      continue;
    }
    const resolved = resolveTarget(absoluteSkillPath, skillRoot, target);
    const relativeTarget = relative(skillRoot, resolved);
    if (
      relativeTarget === ".." ||
      relativeTarget.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
    ) {
      findings.push({ kind: "external", source: absoluteSkillPath, target });
    } else if (!existsSync(resolved)) {
      findings.push({ kind: "broken", source: absoluteSkillPath, target });
    } else if (statSync(resolved).isFile()) {
      directFiles.push(resolved);
    }
  }

  for (const directFile of directFiles) {
    if (!/\.(?:md|markdown)$/i.test(directFile)) continue;
    for (const target of markdownTargets(readFileSync(directFile, "utf8"))) {
      if (
        !target ||
        REMOTE_PREFIXES.some((prefix) => target.startsWith(prefix))
      ) {
        continue;
      }
      findings.push({
        kind: "deeper-than-one-hop",
        source: directFile,
        target,
      });
    }
  }

  return findings;
};

export type SkillTokenEstimate = {
  bodyCharacters: number;
  bodyLines: number;
  bodyTokens: number;
  catalogTokens: number;
  frontmatterWarnings: string[];
  method: string;
  skill: string;
};

export const estimateSkillTokens = (
  document: AgentSkillDocument,
  skillPath: string,
): SkillTokenEstimate => {
  const catalog = ["name", "description"]
    .filter((key) => key in document.fields)
    .map((key) => `${key}: ${document.fields[key]}`)
    .join("\n");
  const renderedCatalog = catalog ? `${catalog}\n` : "";
  return {
    bodyCharacters: document.body.length,
    bodyLines:
      document.body.split(/\r?\n/).length -
      (document.body.endsWith("\n") ? 1 : 0),
    bodyTokens: heuristicTokens(document.body),
    catalogTokens: heuristicTokens(renderedCatalog),
    frontmatterWarnings: document.warnings,
    method: "HEURISTIC max(words, ceil(characters / 4))",
    skill: resolve(skillPath),
  };
};

export const estimateSkillsAt = (target: string) => {
  const paths = walkFiles(target).filter(
    (path) => path.split(/[\\/]/).at(-1) === "SKILL.md",
  );
  const skills = paths.map((path) =>
    estimateSkillTokens(
      parseAgentSkillDocument(readFileSync(path, "utf8")),
      path,
    ),
  );
  return {
    skills,
    target: resolve(target),
    totalBodyTokens: skills.reduce((sum, item) => sum + item.bodyTokens, 0),
    totalCatalogTokens: skills.reduce(
      (sum, item) => sum + item.catalogTokens,
      0,
    ),
  };
};
