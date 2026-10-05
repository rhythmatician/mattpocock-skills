import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

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

export type RepositoryFileInventory = {
  paths: string[];
  truncated: boolean;
};

export const listRepositoryFiles = (
  repositoryRoot: string,
  maxFiles: number,
): RepositoryFileInventory => {
  const paths: string[] = [];
  const pending = [repositoryRoot];
  let truncated = false;

  while (pending.length > 0) {
    const directory = pending.pop();
    if (!directory) break;
    const entries = readdirSync(directory, { withFileTypes: true }).sort(
      (left, right) => left.name.localeCompare(right.name),
    );
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRECTORIES.has(entry.name)) pending.push(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (paths.length >= maxFiles) {
        truncated = true;
        break;
      }
      paths.push(relative(repositoryRoot, absolutePath).replaceAll("\\", "/"));
    }
    if (truncated) break;
  }

  return { paths: paths.sort(), truncated };
};

export const readRepositoryText = (
  repositoryRoot: string,
  path: string,
  maxBytes = 512 * 1024,
) => {
  const buffer = readFileSync(join(repositoryRoot, path));
  if (buffer.length > maxBytes || buffer.includes(0)) return undefined;
  return buffer.toString("utf8");
};
