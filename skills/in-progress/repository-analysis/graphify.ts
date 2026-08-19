import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { Evidence, EvidenceError, EvidenceProvenance } from "./evidence.js";

export interface GraphifyArtifact {
  readonly edges: readonly unknown[];
  readonly nodes: readonly unknown[];
}

const provenance: EvidenceProvenance = {
  adapter: "graphify-artifact",
  capability: "repository-graph-loading",
  tool: "graphify",
};

export async function loadGraphifyArtifact(
  repositoryRoot: string,
): Promise<Evidence<GraphifyArtifact> | EvidenceError> {
  try {
    const value: unknown = JSON.parse(
      await readFile(join(repositoryRoot, "graphify-out", "graph.json"), "utf8"),
    );
    if (!isGraphifyArtifact(value)) {
      return invalidArtifact("Existing graphify artifact did not contain nodes and edges arrays.");
    }
    return { kind: "evidence", provenance, value };
  } catch (error) {
    return invalidArtifact(
      error instanceof Error ? error.message : "Could not read the existing graphify artifact.",
    );
  }
}

function isGraphifyArtifact(value: unknown): value is GraphifyArtifact {
  return (
    typeof value === "object" &&
    value !== null &&
    "nodes" in value &&
    Array.isArray(value.nodes) &&
    "edges" in value &&
    Array.isArray(value.edges)
  );
}

function invalidArtifact(message: string): EvidenceError {
  return { error: { kind: "invalid-value", message }, kind: "error", provenance };
}