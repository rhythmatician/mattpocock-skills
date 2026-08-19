import type { GitMetadata } from "./git.js";
import type { Evidence, EvidenceError } from "./evidence.js";

export interface ReportMetadata {
  readonly analysisVersion: string;
  readonly dirtyWorktree: boolean | null;
  readonly generatedAt: string;
  readonly repositoryCommit: string | null;
  readonly toolVersions: Readonly<Record<string, string>>;
}

export interface CreateReportMetadataOptions {
  readonly analysisVersion: string;
  readonly generatedAt?: string;
  readonly git: GitMetadata;
  readonly toolVersions: Readonly<Record<string, string>>;
}

export function createReportMetadata(
  options: CreateReportMetadataOptions,
): ReportMetadata {
  return {
    analysisVersion: options.analysisVersion,
    dirtyWorktree: options.git.dirtyWorktree,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    repositoryCommit: options.git.repositoryCommit,
    toolVersions: options.toolVersions,
  };
}

export interface NormalizedReport {
  readonly evidence: readonly Evidence<unknown>[];
  readonly metadata: ReportMetadata;
  readonly partialFailures: readonly EvidenceError[];
}

export function createNormalizedReport(
  metadata: ReportMetadata,
  items: readonly (Evidence<unknown> | EvidenceError)[],
): NormalizedReport {
  return {
    evidence: items.filter(
      (item): item is Evidence<unknown> => item.kind === "evidence",
    ),
    metadata,
    partialFailures: items.filter(
      (item): item is EvidenceError => item.kind === "error",
    ),
  };
}