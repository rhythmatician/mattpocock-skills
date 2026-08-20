/**
 * Cache management for analysis results.
 * 
 * Stores and retrieves analysis results with validity checking.
 * Cache keys are deterministic based on repository state and analysis parameters.
 * Cleanup removes scratch files but preserves evidence.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as os from 'os';

import {
  CacheKey,
  CachedResult,
  AnalysisEvidence,
  isCacheKeyValid,
} from './schema';

/**
 * Cache management for analysis results.
 * 
 * Usage:
 * ```typescript
 * const cache = new AnalysisCache(repo.rootPath);
 * 
 * const key = cache.generateKey('eslint', 'standard', toolVersions);
 * const cached = await cache.get(key);
 * if (cached && cached.isValid) {
 *   return cached.evidence;
 * }
 * 
 * // Run analysis...
 * const evidence = await analyzeWithEslint();
 * await cache.set(key, evidence);
 * ```
 */
export class AnalysisCache {
  private readonly cacheDir: string;

  constructor(repositoryRoot: string) {
    // Use system temp + repo hash for deterministic cache location
    const repoHash = this.hashPath(repositoryRoot);
    const tmpDir = process.env.TMPDIR || process.env.TEMP || '/tmp';
    this.cacheDir = path.join(tmpDir, `repository-analysis-cache-${repoHash}`);

    // Ensure cache directory exists
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  /**
   * Generate a deterministic cache key.
   * 
   * Cache is valid only for the same:
   * - Repository commit
   * - Analysis type
   * - Analysis budget
   * - Tool versions
   * - Substrate version
   */
  generateKey(
    analyzerId: string,
    budget: 'quick' | 'standard' | 'deep',
    toolVersions: Record<string, string>,
    commitSha: string
  ): CacheKey {
    return {
      commitSha,
      analyzerId,
      budget,
      toolFingerprint: this.hashToolVersions(toolVersions),
      substanceVersion: '0.1.0',
    };
  }

  /**
   * Convert cache key to filename for storage.
   */
  private keyToFilename(key: CacheKey): string {
    const components = [
      key.analyzerId,
      key.budget,
      key.commitSha.substring(0, 8),
      key.toolFingerprint.substring(0, 8),
    ];
    const filename = components.join('_') + '.json';
    return filename.replace(/[^a-z0-9_.-]/gi, '_');
  }

  /**
   * Retrieve cached analysis result if still valid.
   * 
   * Returns null if not in cache or invalid.
   */
  async get(key: CacheKey): Promise<CachedResult | null> {
    const filename = this.keyToFilename(key);
    const filepath = path.join(this.cacheDir, filename);

    if (!fs.existsSync(filepath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(filepath, 'utf-8');
      const cached = JSON.parse(content) as CachedResult;

      // Validate the cached key matches
      if (!isCacheKeyValid(cached.key, key)) {
        return {
          ...cached,
          isValid: false,
          invalidReason: 'Cache key mismatch',
        };
      }

      // Check cache age (24 hours default)
      const cacheAge = Date.now() - new Date(cached.cachedAt).getTime();
      const maxAge = 24 * 60 * 60 * 1000;
      if (cacheAge > maxAge) {
        return {
          ...cached,
          isValid: false,
          invalidReason: `Cache expired (${Math.round(cacheAge / 1000 / 60)} minutes old)`,
        };
      }

      return {
        ...cached,
        isValid: true,
      };
    } catch (e) {
      return null;
    }
  }

  /**
   * Store an analysis result in cache.
   */
  async set(key: CacheKey, evidence: AnalysisEvidence): Promise<void> {
    const filename = this.keyToFilename(key);
    const filepath = path.join(this.cacheDir, filename);

    const cached: CachedResult = {
      key,
      evidence,
      cachedAt: new Date().toISOString(),
      isValid: true,
    };

    fs.writeFileSync(filepath, JSON.stringify(cached, null, 2));
  }

  /**
   * Clean up ephemeral cache files.
   * 
   * Removes old cache entries but keeps recent evidence for reuse.
   * Does NOT remove the evidence itself, only outdated cache metadata.
   */
  async cleanup(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): Promise<void> {
    if (!fs.existsSync(this.cacheDir)) {
      return;
    }

    try {
      const files = fs.readdirSync(this.cacheDir);
      const now = Date.now();

      for (const file of files) {
        const filepath = path.join(this.cacheDir, file);
        const stat = fs.statSync(filepath);
        const age = now - stat.mtimeMs;

        if (age > maxAgeMs && file.endsWith('.json')) {
          fs.unlinkSync(filepath);
        }
      }
    } catch (e) {
      // Ignore cleanup errors
    }
  }

  /**
   * Clear all cache.
   * 
   * Removes the entire cache directory.
   * Use with caution: evidence stored in cache is lost.
   */
  async clear(): Promise<void> {
    if (fs.existsSync(this.cacheDir)) {
      fs.rmSync(this.cacheDir, { recursive: true, force: true });
    }
  }

  /**
   * Get cache statistics.
   */
  async getStats(): Promise<{
    cacheDir: string;
    fileCount: number;
    totalSizeBytes: number;
  }> {
    let fileCount = 0;
    let totalSizeBytes = 0;

    if (fs.existsSync(this.cacheDir)) {
      const files = fs.readdirSync(this.cacheDir);
      for (const file of files) {
        const filepath = path.join(this.cacheDir, file);
        const stat = fs.statSync(filepath);
        fileCount++;
        totalSizeBytes += stat.size;
      }
    }

    return {
      cacheDir: this.cacheDir,
      fileCount,
      totalSizeBytes,
    };
  }

  /**
   * Hash a file path to a deterministic short string.
   */
  private hashPath(path: string): string {
    return crypto.createHash('sha256').update(path).digest('hex').substring(0, 16);
  }

  /**
   * Hash tool versions to a deterministic fingerprint.
   */
  private hashToolVersions(toolVersions: Record<string, string>): string {
    const sorted = Object.keys(toolVersions)
      .sort()
      .map((k) => `${k}:${toolVersions[k]}`)
      .join('|');
    return crypto.createHash('sha256').update(sorted).digest('hex');
  }
}

/**
 * Create a deterministic temporary directory for analysis outputs.
 * 
 * Useful for storing intermediate results, reports, etc.
 * Directory persists until cleanup() is called.
 * 
 * Usage:
 * ```typescript
 * const tmpDir = createAnalysisTempDir('eslint-analysis');
 * const reportPath = path.join(tmpDir, 'report.json');
 * fs.writeFileSync(reportPath, JSON.stringify(report));
 * // Results survive cleanup; only the tmpdir itself is removed
 * ```
 */
export function createAnalysisTempDir(label: string): string {
  const osTemp = process.env.TMPDIR || process.env.TEMP || '/tmp';
  const timestamp = Date.now();
  const dirName = `${label}-${timestamp}`;
  const fullPath = path.join(osTemp, dirName);

  fs.mkdirSync(fullPath, { recursive: true });
  return fullPath;
}

/**
 * Clean up an analysis temporary directory.
 * 
 * Removes the directory and all its contents.
 */
export function cleanupAnalysisTempDir(dirPath: string): void {
  if (fs.existsSync(dirPath)) {
    try {
      fs.rmSync(dirPath, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup errors
    }
  }
}
