import { basename } from "node:path";

import { readRepositoryText } from "./repository-files.ts";

export type TestCapability =
  | "combinatorial"
  | "failure-injection"
  | "machine-reporting"
  | "mutation"
  | "randomized-order"
  | "test-runner"
  | "timing";

export type TestEcosystem =
  | "dotnet"
  | "go"
  | "javascript-typescript"
  | "jvm"
  | "python"
  | "ruby"
  | "rust";

export type DetectedTestTool = {
  capabilities: TestCapability[];
  ecosystem: TestEcosystem;
  evidence: string;
  name: string;
};

type CatalogEntry = Omit<DetectedTestTool, "evidence"> & {
  dependencyPattern?: RegExp;
  manifestNames?: string[];
};

const CATALOG: CatalogEntry[] = [
  {
    capabilities: ["test-runner", "machine-reporting", "timing"],
    dependencyPattern: /"[^"]+"\s*:\s*"[^"]*\bnode\b[^"]*--test\b/i,
    ecosystem: "javascript-typescript",
    name: "Node.js test runner",
  },
  {
    capabilities: ["test-runner", "machine-reporting", "timing"],
    dependencyPattern: /"(vitest|@vitest\/runner)"\s*:/,
    ecosystem: "javascript-typescript",
    name: "Vitest",
  },
  {
    capabilities: [
      "test-runner",
      "machine-reporting",
      "randomized-order",
      "timing",
    ],
    dependencyPattern: /"(jest|@jest\/core)"\s*:/,
    ecosystem: "javascript-typescript",
    name: "Jest",
  },
  {
    capabilities: ["mutation"],
    dependencyPattern: /"@stryker-mutator\/[^"]+"\s*:/,
    ecosystem: "javascript-typescript",
    name: "StrykerJS",
  },
  {
    capabilities: ["test-runner", "machine-reporting", "timing"],
    dependencyPattern: /(^|[\s"'=])pytest([\s"'=<>~!]|$)/im,
    ecosystem: "python",
    name: "pytest",
  },
  {
    capabilities: ["randomized-order"],
    dependencyPattern: /pytest-randomly/i,
    ecosystem: "python",
    name: "pytest-randomly",
  },
  {
    capabilities: ["mutation"],
    dependencyPattern: /(^|[\s"'=])(mutmut|cosmic-ray)([\s"'=<>~!]|$)/im,
    ecosystem: "python",
    name: "Python mutation tooling",
  },
  {
    capabilities: ["combinatorial"],
    dependencyPattern: /allpairspy/i,
    ecosystem: "python",
    name: "AllPairsPy",
  },
  {
    capabilities: [
      "test-runner",
      "machine-reporting",
      "randomized-order",
      "timing",
    ],
    ecosystem: "go",
    manifestNames: ["go.mod"],
    name: "go test",
  },
  {
    capabilities: ["mutation"],
    dependencyPattern: /github\.com\/zimmski\/go-mutesting|github\.com\/avito-tech\/go-mutants/i,
    ecosystem: "go",
    name: "Go mutation tooling",
  },
  {
    capabilities: ["test-runner", "timing"],
    ecosystem: "rust",
    manifestNames: ["Cargo.toml"],
    name: "cargo test",
  },
  {
    capabilities: ["mutation"],
    dependencyPattern: /cargo-mutants/i,
    ecosystem: "rust",
    name: "cargo-mutants",
  },
  {
    capabilities: ["test-runner", "machine-reporting", "timing"],
    ecosystem: "jvm",
    manifestNames: ["build.gradle", "build.gradle.kts", "pom.xml"],
    name: "JVM test runner",
  },
  {
    capabilities: ["mutation"],
    dependencyPattern: /pitest/i,
    ecosystem: "jvm",
    name: "PIT",
  },
  {
    capabilities: ["test-runner", "machine-reporting", "timing"],
    ecosystem: "dotnet",
    manifestNames: [".csproj", ".fsproj", ".sln"],
    name: "dotnet test",
  },
  {
    capabilities: ["mutation"],
    dependencyPattern: /Stryker\.NET|dotnet-stryker/i,
    ecosystem: "dotnet",
    name: "Stryker.NET",
  },
  {
    capabilities: [
      "test-runner",
      "machine-reporting",
      "randomized-order",
      "timing",
    ],
    dependencyPattern: /(^|[\s"'=])rspec([\s"'=<>~!]|$)/im,
    ecosystem: "ruby",
    name: "RSpec",
  },
  {
    capabilities: ["mutation"],
    dependencyPattern: /(^|[\s"'=])mutant([\s"'=<>~!]|$)/im,
    ecosystem: "ruby",
    name: "Mutant",
  },
];

const MANIFEST_NAMES = new Set([
  "Cargo.toml",
  "Gemfile",
  "build.gradle",
  "build.gradle.kts",
  "go.mod",
  "package.json",
  "pom.xml",
  "pyproject.toml",
  "requirements-dev.txt",
  "requirements.txt",
  "setup.cfg",
]);

const isManifest = (path: string) => {
  const name = basename(path);
  return (
    MANIFEST_NAMES.has(name) ||
    name.endsWith(".csproj") ||
    name.endsWith(".fsproj") ||
    name.endsWith(".sln")
  );
};

export const discoverTestTooling = (
  repositoryRoot: string,
  repositoryPaths: string[],
) => {
  const manifests = repositoryPaths.filter(isManifest);
  const manifestContent = manifests
    .map((path) => ({
      content: readRepositoryText(repositoryRoot, path) ?? "",
      path,
    }))
    .filter(({ content }) => content.length > 0);
  const tools: DetectedTestTool[] = [];

  for (const entry of CATALOG) {
    const evidence = manifestContent.find(({ content, path }) => {
      const name = basename(path);
      const manifestMatch = entry.manifestNames?.some((manifestName) =>
        manifestName.startsWith(".")
          ? name.endsWith(manifestName)
          : name === manifestName,
      );
      return manifestMatch || entry.dependencyPattern?.test(content);
    });
    if (evidence) {
      tools.push({
        capabilities: entry.capabilities,
        ecosystem: entry.ecosystem,
        evidence: evidence.path,
        name: entry.name,
      });
    }
  }

  const packageScripts: string[] = [];
  for (const manifest of manifestContent.filter(
    ({ path }) => basename(path) === "package.json",
  )) {
    try {
      const parsed = JSON.parse(manifest.content) as {
        scripts?: Record<string, unknown>;
      };
      for (const [name, command] of Object.entries(parsed.scripts ?? {})) {
        if (
          typeof command === "string" &&
          /(^|:)(test|spec|check)|test|vitest|jest|playwright|cypress/i.test(
            `${name} ${command}`,
          )
        ) {
          packageScripts.push(`${manifest.path}#scripts.${name}`);
        }
      }
    } catch {
      // Invalid manifests are reported by their native package tooling.
    }
  }

  return {
    capabilities: [...new Set(tools.flatMap(({ capabilities }) => capabilities))].sort(),
    ecosystems: [...new Set(tools.map(({ ecosystem }) => ecosystem))].sort(),
    manifests,
    packageScripts: packageScripts.sort(),
    tools: tools.sort(
      (left, right) =>
        left.ecosystem.localeCompare(right.ecosystem) ||
        left.name.localeCompare(right.name),
    ),
  };
};
