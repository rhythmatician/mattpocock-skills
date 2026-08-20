/**
 * Shared TypeScript analysis substrate for repository-diagnostic skills.
 * 
 * This module exports the core infrastructure for analyzing repositories:
 * - Repository discovery and metadata
 * - Subprocess execution with timeouts
 * - External CLI tool discovery
 * - Common schemas and types
 * - Cache management
 * - History analysis helpers
 * 
 * Example usage:
 * 
 * ```typescript
 * import {
 *   Repository,
 *   Executor,
 *   CliDiscovery,
 *   AnalysisCache,
 *   HistoryAnalyzer,
 *   createAnalysisMetadata,
 * } from 'skills/shared/repository-analysis';
 * 
 * // Discover repository
 * const repo = await Repository.discover('/path/to/repo');
 * 
 * // Set up tools
 * const executor = new Executor(repo.rootPath);
 * const cliDiscovery = new CliDiscovery(repo.rootPath);
 * const cache = new AnalysisCache(repo.rootPath);
 * const history = new HistoryAnalyzer(repo.rootPath);
 * 
 * // Check health of external tools
 * const eslintHealth = await executor.checkHealth('eslint');
 * if (!eslintHealth.available) {
 *   console.log('eslint not available');
 *   return;
 * }
 * 
 * // Run analysis
 * const result = await executor.run('eslint', ['.'], { timeout: 30000 });
 * 
 * // Collect metadata and return evidence
 * const metadata = createAnalysisMetadata({
 *   repository: repo.metadata,
 *   toolVersions: { eslint: eslintHealth.version },
 *   analysisBudget: 'standard',
 * });
 * ```
 * 
 * This substrate provides the "lever" that skills build on.
 * Consumers interpret the normalized evidence; substrate owns only mechanics.
 */

export {
  // Repository discovery
  Repository,
} from './repository';

export type { RepositoryMetadata, EcosystemInfo } from './repository';

export {
  // Subprocess execution
  Executor,
} from './executor';

export type {
  ExecutionOptions,
  ExecutionResult,
} from './executor';

export {
  // CLI discovery
  CliDiscovery,
  KnownTools,
} from './cli-discovery';

export {
  // Common schemas and types
  createAnalysisMetadata,
  createPartialSuccess,
  isCacheKeyValid,
  SchemaValidators,
} from './schema';

export type {
  RepositoryMetadata,
  EcosystemInfo,
  AnalysisMetadata,
  AnalysisEvidence,
  AnalysisResult,
  PartialSuccessReport,
  ToolHealthCheck,
  CacheKey,
  CachedResult,
} from './schema';

export {
  // Cache management
  AnalysisCache,
  createAnalysisTempDir,
  cleanupAnalysisTempDir,
} from './cache';

export type { CacheKey, CachedResult } from './cache';

export {
  // History analysis
  HistoryAnalyzer,
  StandardExclusions,
  BulkCommitPatterns,
} from './history';

export type {
  HistoryAnalysisConfig,
  HistoryAnalysis,
} from './history';

/**
 * Version of the shared analysis substrate.
 * 
 * Used in cache keys and analysis metadata to track
 * when changes to the substrate might invalidate cached results.
 */
export const SUBSTRATE_VERSION = '0.1.0';
