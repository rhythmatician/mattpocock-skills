import { hasAnyPath, hasRootFileWithExtension } from "./markers.js";

export type Ecosystem =
  | "dotnet"
  | "go"
  | "java"
  | "node"
  | "python"
  | "ruby"
  | "rust";

const ECOSYSTEM_MARKERS: readonly [Ecosystem, readonly string[]][] = [
  ["node", ["package.json"]],
  ["python", ["pyproject.toml", "requirements.txt", "setup.py"]],
  ["java", ["pom.xml", "build.gradle", "build.gradle.kts"]],
  ["dotnet", ["global.json"]],
  ["go", ["go.mod"]],
  ["rust", ["Cargo.toml"]],
  ["ruby", ["Gemfile"]],
];

export async function detectEcosystems(
  repositoryRoot: string,
): Promise<readonly Ecosystem[]> {
  const detected: Ecosystem[] = [];
  for (const [ecosystem, markers] of ECOSYSTEM_MARKERS) {
    if (
      (await hasAnyPath(repositoryRoot, markers)) ||
      (ecosystem === "dotnet" &&
        (await hasRootFileWithExtension(repositoryRoot, [".csproj", ".fsproj", ".sln", ".vbproj"])))
    ) {
      detected.push(ecosystem);
    }
  }
  return detected;
}

