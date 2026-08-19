import type { AnalysisSession } from "./analysis.js";
import type { Evidence, EvidenceError } from "./evidence.js";

export interface AnalyzerAdapter<T> {
  readonly capability: string;
  readonly name: string;
  analyze(session: AnalysisSession): Promise<T>;
}

export async function runAdapter<T>(
  adapter: AnalyzerAdapter<T>,
  session: AnalysisSession,
  tool: string,
): Promise<Evidence<T> | EvidenceError> {
  const provenance = {
    adapter: adapter.name,
    capability: adapter.capability,
    tool,
  };
  try {
    return { kind: "evidence", provenance, value: await adapter.analyze(session) };
  } catch (error) {
    return {
      error: {
        kind: "adapter-error",
        message: error instanceof Error ? error.message : "Analyzer adapter failed.",
      },
      kind: "error",
      provenance,
    };
  }
}