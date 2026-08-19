export interface EvidenceProvenance {
  readonly adapter: string;
  readonly capability: string;
  readonly tool: string;
}

export interface Evidence<T> {
  readonly kind: "evidence";
  readonly provenance: EvidenceProvenance;
  readonly value: T;
}

export interface EvidenceError {
  readonly error: {
    readonly kind: "adapter-error" | "invalid-json" | "invalid-value";
    readonly message: string;
  };
  readonly kind: "error";
  readonly provenance: EvidenceProvenance;
}

export function parseJsonEvidence<T = unknown>(
  source: string,
  provenance: EvidenceProvenance,
  validate?: (value: unknown) => value is T,
): Evidence<T> | EvidenceError {
  try {
    const value: unknown = JSON.parse(source);
    if (value === null || typeof value !== "object") {
      return {
        error: {
          kind: "invalid-value",
          message: "Analyzer JSON must contain an object or array.",
        },
        kind: "error",
        provenance,
      };
    }
    if (validate && !validate(value)) {
      return {
        error: {
          kind: "invalid-value",
          message: "Analyzer JSON did not match the adapter schema.",
        },
        kind: "error",
        provenance,
      };
    }
    return { kind: "evidence", provenance, value: value as T };
  } catch (error) {
    return {
      error: {
        kind: "invalid-json",
        message: error instanceof Error ? error.message : "Analyzer output was not JSON.",
      },
      kind: "error",
      provenance,
    };
  }
}