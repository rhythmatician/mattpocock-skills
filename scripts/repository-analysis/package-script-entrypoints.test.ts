import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";

type PackageJson = {
  scripts?: Record<string, string>;
};

const packageJson = JSON.parse(
  readFileSync("package.json", "utf8"),
) as PackageJson;

const localPathPattern = /(?:^|\s)((?:scripts|node_modules)\/[^\s&|]+)/g;

const pathExists = (path: string): boolean => {
  if (!path.includes("*")) {
    return existsSync(resolve(path));
  }

  const directory = resolve(dirname(path));
  const suffix = path.slice(path.lastIndexOf("*") + 1);
  return (
    existsSync(directory) &&
    readdirSync(directory).some((entry) => entry.endsWith(suffix))
  );
};

test("package scripts reference existing local files", () => {
  const missingPaths: string[] = [];

  for (const [scriptName, command] of Object.entries(packageJson.scripts ?? {})) {
    for (const match of command.matchAll(localPathPattern)) {
      const path = match[1];
      if (path !== undefined && !pathExists(path)) {
        missingPaths.push(`${scriptName}: ${path}`);
      }
    }
  }

  assert.deepEqual(missingPaths, []);
});
