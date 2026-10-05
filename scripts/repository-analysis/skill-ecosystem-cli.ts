import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

import {
  estimateSkillsAt,
  inventorySkills,
  validateSkillReferences,
} from "./agent-skill-tooling.ts";
import { writeJsonEvidence } from "./evidence.ts";
import { checkSkillEcosystemIntegrity } from "./skill-ecosystem-integrity.ts";

const argument = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const command = process.argv[2];
const target = resolve(argument("--target") ?? argument("--repo") ?? process.cwd());
const outputPath = argument("--output");

if (!command || !["integrity", "inventory", "references", "tokens"].includes(command)) {
  console.error(
    "Usage: skill-ecosystem-cli.ts <integrity|inventory|references|tokens> [--repo <path>|--target <path>] [--manifest <path>] [--output <path>]",
  );
  process.exitCode = 2;
} else if (!existsSync(target)) {
  console.error(`Target does not exist: ${target}`);
  process.exitCode = 2;
} else {
  let result: unknown;
  let valid = true;
  if (command === "integrity") {
    const manifestPath = argument("--manifest");
    const integrity = checkSkillEcosystemIntegrity({
      manifestPath: manifestPath ? resolve(manifestPath) : undefined,
      repositoryRoot: target,
    });
    result = integrity;
    valid = integrity.valid;
  } else if (command === "inventory") {
    const repositoryRoot = resolve(argument("--repo") ?? target);
    result = inventorySkills({ repositoryRoot, root: target });
  } else if (command === "references") {
    const paths = statSync(target).isFile()
      ? [target]
      : inventorySkills({ repositoryRoot: target, root: target }).skills.map(
          ({ skillPath }) => resolve(target, ...skillPath.split("/")),
        );
    const findings = paths.flatMap(validateSkillReferences);
    result = { findings, root: target, valid: findings.length === 0 };
    valid = findings.length === 0;
  } else {
    result = estimateSkillsAt(target);
  }

  if (outputPath) {
    writeJsonEvidence(outputPath, result);
    console.log(JSON.stringify({ outputPath: resolve(outputPath), valid }));
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
  if (!valid) process.exitCode = 1;
}
