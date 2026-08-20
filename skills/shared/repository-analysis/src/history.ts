/**
 * History analysis helpers for repository diagnostics.
 * 
 * Supports:
 * - Generated/vendor/lock file exclusions
 * - Bulk mechanical commit detection and exclusion
 * - Large changeset handling
 * - Rename and merge tracking
 * - Configurable path and commit exclusions
 */

import { execSync } from 'child_process';

/**
 * Configuration for history analysis.
 */
export interface HistoryAnalysisConfig {
  /** Paths to exclude from analysis (glob patterns) */
  excludePaths?: string[];
  /** Commit SHAs or patterns to exclude */
  excludeCommits?: string[];
  /** Exclude merge commits */
  excludeMerges?: boolean;
  /** Exclude commits by message pattern */
  excludeByMessage?: RegExp[];
  /** Maximum size of a changeset to include (lines changed) */
  maxChangesetSize?: number;
  /** Maximum number of commits to analyze */
  maxCommits?: number;
}

/**
 * Result from analyzing repository history.
 */
export interface HistoryAnalysis {
  /** Commits analyzed */
  commits: {
    sha: string;
    message: string;
    author: string;
    date: string;
    filesChanged: string[];
    linesAdded: number;
    linesRemoved: number;
    isMerge: boolean;
    isExcluded: boolean;
    excludeReason?: string;
  }[];
  /** Summary stats */
  stats: {
    totalCommits: number;
    analyzedCommits: number;
    excludedCommits: number;
    bulkMechanicalCommits: number;
  };
}

/**
 * Analyze repository history with filtering and exclusions.
 * 
 * Usage:
 * ```typescript
 * const history = new HistoryAnalyzer(repo.rootPath);
 * const analysis = await history.analyze({
 *   maxCommits: 100,
 *   excludeByMessage: [/^chore:/, /^deps:/],
 *   excludePaths: ['*.lock', 'node_modules/**'],
 * });
 * ```
 */
export class HistoryAnalyzer {
  private readonly workdir: string;

  constructor(workdir: string) {
    this.workdir = workdir;
  }

  /**
   * Analyze repository history with filters.
   */
  async analyze(config: HistoryAnalysisConfig = {}): Promise<HistoryAnalysis> {
    const commits = this.getCommitLog(config);

    const stats = {
      totalCommits: commits.length,
      analyzedCommits: commits.filter((c) => !c.isExcluded).length,
      excludedCommits: commits.filter((c) => c.isExcluded).length,
      bulkMechanicalCommits: commits.filter((c) => this.isBulkMechanical(c.message)).length,
    };

    return {
      commits,
      stats,
    };
  }

  /**
   * Get commit log with details.
   */
  private getCommitLog(config: HistoryAnalysisConfig): HistoryAnalysis['commits'] {
    const maxCommits = config.maxCommits || 1000;

    try {
      // Use null-byte delimiters to handle multiline commit messages
      // Format: sha%n subject%n author%n date%n%n (separated by null bytes)
      const gitLog = execSync(
        `git log --format=%H%x00%s%x00%aN%x00%aI%x00 -${maxCommits} --no-merges`,
        {
          cwd: this.workdir,
          encoding: 'utf-8',
        }
      );

      const commits: HistoryAnalysis['commits'] = [];
      const records = gitLog.split('\x00').filter((r) => r.trim());

      // Process records in groups of 4 (sha, subject, author, date)
      for (let i = 0; i < records.length; i += 4) {
        if (i + 3 >= records.length) break;

        const sha = records[i].trim();
        const message = records[i + 1].trim();
        const author = records[i + 2].trim();
        const date = records[i + 3].trim();

        if (!sha) continue;

        // Get file and line statistics
        let filesChanged: string[] = [];
        let linesAdded = 0;
        let linesRemoved = 0;

        try {
          const diffStat = execSync(`git diff-tree --no-commit-id --numstat ${sha}`, {
            cwd: this.workdir,
            encoding: 'utf-8',
          });

          const stats = diffStat.split('\n').filter((l) => l.trim());
          filesChanged = stats.map((line) => line.split('\t')[2] || '').filter((f) => f);

          stats.forEach((line) => {
            const [added, removed] = line.split('\t');
            linesAdded += parseInt(added) || 0;
            linesRemoved += parseInt(removed) || 0;
          });
        } catch (e) {
          // Ignore stat errors
        }

        // Check if should exclude
        let isExcluded = false;
        let excludeReason: string | undefined;

        // Exclude by message
        if (config.excludeByMessage) {
          for (const pattern of config.excludeByMessage) {
            if (pattern.test(message)) {
              isExcluded = true;
              excludeReason = `Matched exclude pattern: ${pattern}`;
              break;
            }
          }
        }

        // Exclude large changesets
        if (config.maxChangesetSize && linesAdded + linesRemoved > config.maxChangesetSize) {
          isExcluded = true;
          excludeReason = `Changeset too large: ${linesAdded + linesRemoved} lines`;
        }

        // Exclude specific commits
        if (config.excludeCommits?.includes(sha.substring(0, 8))) {
          isExcluded = true;
          excludeReason = 'Explicitly excluded';
        }

        commits.push({
          sha,
          message,
          author,
          date,
          filesChanged,
          linesAdded,
          linesRemoved,
          isMerge: false,
          isExcluded,
          excludeReason,
        });
      }

      return commits;
    } catch (e) {
      return [];
    }
  }

  /**
   * Detect bulk mechanical commits (generated, deps, lock files, etc).
   * 
   * Returns true if the commit appears to be mechanical/generated.
   */
  private isBulkMechanical(message: string): boolean {
    const patterns = [
      /^chore:/i,
      /^deps:/i,
      /^build:/i,
      /^ci:/i,
      /lock file/i,
      /generate/i,
      /prettier/i,
      /format/i,
      /linting/i,
      /remove?.*lock/i,
      /update.*lock/i,
      /renovate/i,
      /dependabot/i,
      /automated/i,
      /generated/i,
    ];

    return patterns.some((p) => p.test(message));
  }

  /**
   * Get hotspots in repository (files/areas that change frequently).
   * 
   * Useful for focusing analysis on high-volatility areas.
   */
  async getHotspots(config: HistoryAnalysisConfig = {}): Promise<{
    path: string;
    changeCount: number;
    lastChanged: string;
    authors: string[];
  }[]> {
    const analysis = await this.analyze(config);

    const hotspots: Record<
      string,
      {
        changeCount: number;
        lastChanged: string;
        authors: Set<string>;
      }
    > = {};

    for (const commit of analysis.commits) {
      if (commit.isExcluded) continue;

      for (const file of commit.filesChanged) {
        if (!hotspots[file]) {
          hotspots[file] = {
            changeCount: 0,
            lastChanged: commit.date,
            authors: new Set(),
          };
        }
        hotspots[file].changeCount++;
        hotspots[file].lastChanged = commit.date; // Assume chronological order
        hotspots[file].authors.add(commit.author);
      }
    }

    // Convert to sorted array
    return Object.entries(hotspots)
      .map(([path, data]) => ({
        path,
        changeCount: data.changeCount,
        lastChanged: data.lastChanged,
        authors: Array.from(data.authors),
      }))
      .sort((a, b) => b.changeCount - a.changeCount);
  }

  /**
   * Find renames and moves in history.
   * 
   * Useful for understanding how structure has evolved.
   */
  async findRenames(config: HistoryAnalysisConfig = {}): Promise<{
    oldPath: string;
    newPath: string;
    commitSha: string;
    date: string;
  }[]> {
    const maxCommits = config.maxCommits || 1000;
    const renames: {
      oldPath: string;
      newPath: string;
      commitSha: string;
      date: string;
    }[] = [];

    try {
      const gitLog = execSync(
        `git log --format=%H%n%aI --diff-filter=R -M --oneline -${maxCommits}`,
        {
          cwd: this.workdir,
          encoding: 'utf-8',
        }
      );

      const lines = gitLog.split('\n').filter((l) => l.trim());
      for (let i = 0; i < lines.length; i += 2) {
        if (i + 1 >= lines.length) break;

        const commitSha = lines[i].trim();
        const date = lines[i + 1].trim();

        try {
          const names = execSync(`git diff-tree --no-commit-id --name-status -R ${commitSha}`, {
            cwd: this.workdir,
            encoding: 'utf-8',
          });

          const renamedFiles = names.split('\n').filter((l) => l.startsWith('R'));
          for (const line of renamedFiles) {
            const parts = line.split('\t');
            if (parts.length >= 3) {
              renames.push({
                oldPath: parts[1].trim(),
                newPath: parts[2].trim(),
                commitSha,
                date,
              });
            }
          }
        } catch (e) {
          // Ignore
        }
      }
    } catch (e) {
      // Ignore
    }

    return renames;
  }
}

/**
 * Standard exclusion patterns for generated/mechanical files.
 * 
 * These are glob patterns to exclude from analysis.
 */
export const StandardExclusions = {
  generatedCode: [
    '**/*.generated.ts',
    '**/*.generated.js',
    'gen/**',
    'generated/**',
    '.generated/**',
  ],
  lockFiles: [
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    'Cargo.lock',
    'go.sum',
    'poetry.lock',
    'pipfile.lock',
  ],
  vendor: [
    'vendor/**',
    'node_modules/**',
    'venv/**',
    '.venv/**',
    'env/**',
    'virtualenv/**',
  ],
  build: [
    'dist/**',
    'build/**',
    'target/**',
    'out/**',
    '.next/**',
    '.nuxt/**',
    '.vuepress/**',
  ],
  cache: [
    '.cache/**',
    '.tsc-cache/**',
    '.pytest_cache/**',
    '__pycache__/**',
    '.gradle/**',
  ],
};

/**
 * Commit message patterns for bulk/mechanical commits to exclude.
 */
export const BulkCommitPatterns = [
  /^chore:/i,
  /^deps?:/i,
  /^build:/i,
  /^ci:/i,
  /lock file/i,
  /^generate/i,
  /prettier/i,
  /^format/i,
  /linting/i,
  /^remove?.*lock/i,
  /^update.*lock/i,
  /renovate/i,
  /dependabot/i,
  /^automated/i,
  /^generated/i,
  /^rebase/i,
  /^merge/i,
];
