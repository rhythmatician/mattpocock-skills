/**
 * Common types and schemas for repository analysis.
 * 
 * All analysis results carry metadata about the repository state,
 * tool versions, and timing so consumers can understand and reuse findings.
 */

export interface RepositoryMetadata {
  /** Current commit SHA */
  commitSha: string;
  /** Current branch name */
  branch: string;
  /** Repository root path */
  rootPath: string;
  /** Detected ecosystem/language */
  ecosystem: EcosystemInfo;
  /** Working tree has uncommitted changes */
  hasUncommittedChanges: boolean;
  /** Active worktree (for multi-worktree repos) */
  worktreePath?: string;
}

export interface EcosystemInfo {
  /** Primary language: 'typescript', 'python', 'rust', 'go', 'javascript', etc. */
  language: string;
  /** Build system: 'npm', 'cargo', 'go build', 'python', etc. */
  buildSystem?: string;
  /** Test framework: 'jest', 'pytest', 'cargo test', 'go test', etc. */
  testFramework?: string;
  /** Package manager: 'npm', 'pip', 'cargo', 'go', etc. */
  packageManager?: string;
  /** Additional detected tools/frameworks */
  detectedTools: string[];
}

export interface AnalysisMetadata {
  /** Snapshot of repository state when analysis ran */
  repository: RepositoryMetadata;
  /** When analysis started (ISO 8601) */
  analysisStartTime: string;
  /** How long analysis took (milliseconds) */
  analysisDurationMs: number;
  /** Versions of tools used in analysis */
  toolVersions: Record<string, string>;
  /** Analysis substrate version */
  substanceVersion: string;
  /** Which budget was used: 'quick', 'standard', 'deep' */
  analysisBudget: 'quick' | 'standard' | 'deep';
}

/** Core evidence from a single analysis run */
export interface AnalysisEvidence {
  /** Human-readable name of what was analyzed */
  analyzerId: string;
  /** When this evidence was generated */
  timestamp: string;
  /** Provenance: what tool/version produced it */
  sourceTools: Record<string, string>;
  /** The actual findings (schema is tool-specific) */
  data: unknown;
  /** If analysis was partial/incomplete */
  partialReason?: string;
}

/** Result from a single analysis task (may be partial) */
export interface AnalysisResult {
  /** Normalized evidence from the analysis */
  evidence: AnalysisEvidence;
  /** Full metadata about the analysis run */
  metadata: AnalysisMetadata;
  /** Whether analysis fully completed */
  isComplete: boolean;
  /** If incomplete, why (e.g., tool not available, timeout) */
  incompletenessReason?: string;
}

/** Success envelope for partial results */
export interface PartialSuccessReport {
  /** Which analyses completed successfully */
  completed: string[];
  /** Which analyses failed and why */
  failed: Record<string, string>;
  /** Combined evidence from all completed analyses */
  evidence: AnalysisEvidence[];
  /** Overall metadata (latest timestamp, all tool versions) */
  metadata: AnalysisMetadata;
}

/** Tool health check result */
export interface ToolHealthCheck {
  /** Tool is available and usable */
  available: boolean;
  /** Detected version (if available) */
  version?: string;
  /** Health check error message (if not available) */
  error?: string;
  /** Tool-specific capabilities/features detected */
  capabilities?: string[];
}

/** Subprocess execution result */
export interface ExecutionResult {
  /** Exit code from process */
  exitCode: number;
  /** Combined stdout */
  stdout: string;
  /** Combined stderr */
  stderr: string;
  /** Total execution time in milliseconds */
  durationMs: number;
  /** Whether execution was cancelled/timed out */
  timedOut: boolean;
  /** Whether all output was captured (false if truncated) */
  completeOutput: boolean;
}

/** Cache key for reproducibility */
export interface CacheKey {
  /** Repository commit SHA */
  commitSha: string;
  /** Analysis type identifier */
  analyzerId: string;
  /** Analysis budget used */
  budget: 'quick' | 'standard' | 'deep';
  /** Tool version(s) fingerprint */
  toolFingerprint: string;
  /** Substrate version */
  substanceVersion: string;
}

/** Cached analysis result */
export interface CachedResult {
  /** Cache key used to store this */
  key: CacheKey;
  /** Cached evidence */
  evidence: AnalysisEvidence;
  /** When cached */
  cachedAt: string;
  /** Whether cache is still valid */
  isValid: boolean;
  /** If invalid, why */
  invalidReason?: string;
}

/**
 * Create standard metadata for an analysis run.
 * 
 * Usage:
 * ```typescript
 * const metadata = createAnalysisMetadata({
 *   repository: repo,
 *   toolVersions: { eslint: '8.40.0' },
 *   analysisBudget: 'standard'
 * });
 * ```
 */
export function createAnalysisMetadata(params: {
  repository: RepositoryMetadata;
  toolVersions: Record<string, string>;
  analysisBudget: 'quick' | 'standard' | 'deep';
}): AnalysisMetadata {
  const startTime = new Date().toISOString();
  return {
    repository: params.repository,
    analysisStartTime: startTime,
    analysisDurationMs: 0,
    toolVersions: params.toolVersions,
    substanceVersion: '0.1.0',
    analysisBudget: params.analysisBudget,
  };
}

/**
 * Create a partial success envelope from multiple analysis results.
 * 
 * Usage:
 * ```typescript
 * const partial = createPartialSuccess([
 *   { analyzerId: 'eslint', result: eslintResult },
 *   { analyzerId: 'prettier', result: prettierResult },
 * ], metadata);
 * ```
 */
export function createPartialSuccess(
  results: Array<{
    analyzerId: string;
    result: AnalysisResult;
  }>,
  metadata: AnalysisMetadata
): PartialSuccessReport {
  const completed: string[] = [];
  const failed: Record<string, string> = {};
  const evidence: AnalysisEvidence[] = [];

  for (const { analyzerId, result } of results) {
    if (result.isComplete) {
      completed.push(analyzerId);
      evidence.push(result.evidence);
    } else {
      failed[analyzerId] = result.incompletenessReason || 'Unknown error';
    }
  }

  return {
    completed,
    failed,
    evidence,
    metadata,
  };
}

/**
 * Validate that a cache key matches current state.
 */
export function isCacheKeyValid(
  cached: CacheKey,
  current: CacheKey
): boolean {
  return (
    cached.commitSha === current.commitSha &&
    cached.analyzerId === current.analyzerId &&
    cached.budget === current.budget &&
    cached.toolFingerprint === current.toolFingerprint &&
    cached.substanceVersion === current.substanceVersion
  );
}

/**
 * JSON schema validators for analysis output.
 * 
 * Soft validation: missing/extra fields are OK, but known fields
 * must have correct types.
 */
export const SchemaValidators = {
  /**
   * Validate analysis evidence has required shape.
   * Returns validation errors, or empty array if valid.
   */
  validateEvidence(data: unknown): string[] {
    const errors: string[] = [];
    
    if (typeof data !== 'object' || data === null) {
      errors.push('Evidence must be an object');
      return errors;
    }

    const obj = data as Record<string, unknown>;
    
    if (typeof obj.analyzerId !== 'string') {
      errors.push('evidence.analyzerId must be a string');
    }
    if (typeof obj.timestamp !== 'string') {
      errors.push('evidence.timestamp must be a string');
    }
    if (typeof obj.sourceTools !== 'object' || obj.sourceTools === null) {
      errors.push('evidence.sourceTools must be an object');
    }

    return errors;
  },

  /**
   * Validate metadata has required shape.
   */
  validateMetadata(data: unknown): string[] {
    const errors: string[] = [];
    
    if (typeof data !== 'object' || data === null) {
      errors.push('Metadata must be an object');
      return errors;
    }

    const obj = data as Record<string, unknown>;
    
    if (typeof obj.analysisStartTime !== 'string') {
      errors.push('metadata.analysisStartTime must be a string');
    }
    if (typeof obj.analysisBudget !== 'string') {
      errors.push('metadata.analysisBudget must be a string');
    }
    if (!['quick', 'standard', 'deep'].includes(obj.analysisBudget as string)) {
      errors.push(`metadata.analysisBudget must be one of: quick, standard, deep`);
    }

    return errors;
  },
};
