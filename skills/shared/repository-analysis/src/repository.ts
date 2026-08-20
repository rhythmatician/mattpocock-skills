/**
 * Repository discovery and metadata collection.
 * 
 * Find repository root, detect ecosystem (language, build system, test framework),
 * and collect git/worktree metadata needed for analysis.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

import {
  RepositoryMetadata,
  EcosystemInfo,
} from './schema';

/**
 * Repository discovery and analysis context.
 * 
 * Usage:
 * ```typescript
 * const repo = await Repository.discover('/path/to/repo');
 * console.log(repo.metadata);
 * console.log(repo.rootPath);
 * ```
 */
export class Repository {
  readonly rootPath: string;
  readonly metadata: RepositoryMetadata;

  private constructor(rootPath: string, metadata: RepositoryMetadata) {
    this.rootPath = rootPath;
    this.metadata = metadata;
  }

  /**
   * Discover repository metadata starting from a given path.
   * 
   * Walks up the directory tree to find repository root, then
   * collects ecosystem info and git metadata.
   */
  static async discover(startPath: string): Promise<Repository> {
    const rootPath = Repository.findRepositoryRoot(startPath);
    if (!rootPath) {
      throw new Error(`Could not find repository root from ${startPath}`);
    }

    const ecosystem = Repository.detectEcosystem(rootPath);
    const metadata = Repository.collectMetadata(rootPath, ecosystem);

    return new Repository(rootPath, metadata);
  }

  /**
   * Detect repository root by looking for .git, package.json, Cargo.toml, etc.
   */
  private static findRepositoryRoot(startPath: string): string | null {
    let currentPath = path.resolve(startPath);

    const maxDepth = 20; // Prevent infinite loops
    for (let i = 0; i < maxDepth; i++) {
      // Check for git
      if (fs.existsSync(path.join(currentPath, '.git'))) {
        return currentPath;
      }

      // Check for package.json (Node project root)
      if (fs.existsSync(path.join(currentPath, 'package.json'))) {
        // But keep looking up for .git if we can find it
        let checkPath = currentPath;
        let parentCheckDepth = 0;
        while (parentCheckDepth < 20) {
          const parent = path.dirname(checkPath);
          if (parent === checkPath) break; // Reached filesystem root
          if (fs.existsSync(path.join(parent, '.git'))) {
            return parent;
          }
          checkPath = parent;
          parentCheckDepth++;
        }
        return currentPath;
      }

      // Check for Cargo.toml (Rust project root)
      if (fs.existsSync(path.join(currentPath, 'Cargo.toml'))) {
        return currentPath;
      }

      // Check for go.mod (Go project root)
      if (fs.existsSync(path.join(currentPath, 'go.mod'))) {
        return currentPath;
      }

      // Check for pyproject.toml (Python project root)
      if (fs.existsSync(path.join(currentPath, 'pyproject.toml'))) {
        return currentPath;
      }

      const parent = path.dirname(currentPath);
      if (parent === currentPath) {
        // Reached filesystem root
        break;
      }
      currentPath = parent;
    }

    return null;
  }

  /**
   * Detect ecosystem (language, build system, test framework, etc).
   * 
   * Inspects package.json, Cargo.toml, go.mod, pyproject.toml,
   * and file extensions to determine ecosystem.
   */
  private static detectEcosystem(rootPath: string): EcosystemInfo {
    let language = 'unknown';
    let buildSystem: string | undefined;
    let testFramework: string | undefined;
    let packageManager: string | undefined;
    const detectedTools: string[] = [];

    // Check package.json (Node/TypeScript/JavaScript)
    const packageJsonPath = path.join(rootPath, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      language = 'javascript';
      try {
        const content = fs.readFileSync(packageJsonPath, 'utf-8');
        const packageJson = JSON.parse(content);

        // Detect if TypeScript
        if (packageJson.devDependencies?.typescript || packageJson.dependencies?.typescript) {
          language = 'typescript';
        }

        // Detect package manager
        packageManager = 'npm';
        if (fs.existsSync(path.join(rootPath, 'yarn.lock'))) {
          packageManager = 'yarn';
        }
        if (fs.existsSync(path.join(rootPath, 'pnpm-lock.yaml'))) {
          packageManager = 'pnpm';
        }

        // Detect build system
        if (packageJson.scripts?.build) {
          buildSystem = 'npm/yarn';
        }

        // Detect test framework
        const allDeps = {
          ...packageJson.dependencies,
          ...packageJson.devDependencies,
        };
        if (allDeps.jest) testFramework = 'jest';
        if (allDeps.mocha) testFramework = 'mocha';
        if (allDeps.vitest) testFramework = 'vitest';
        if (allDeps.ava) testFramework = 'ava';

        // Detect additional tools
        if (allDeps.eslint) detectedTools.push('eslint');
        if (allDeps.prettier) detectedTools.push('prettier');
        if (allDeps.typescript) detectedTools.push('typescript');
      } catch (e) {
        // Ignore parse errors
      }
    }

    // Check Cargo.toml (Rust)
    const cargoTomlPath = path.join(rootPath, 'Cargo.toml');
    if (fs.existsSync(cargoTomlPath)) {
      language = 'rust';
      buildSystem = 'cargo';
      testFramework = 'cargo test';
      packageManager = 'cargo';
      detectedTools.push('cargo');
    }

    // Check go.mod (Go)
    const goModPath = path.join(rootPath, 'go.mod');
    if (fs.existsSync(goModPath)) {
      language = 'go';
      buildSystem = 'go build';
      testFramework = 'go test';
      packageManager = 'go';
      detectedTools.push('go');
    }

    // Check pyproject.toml or setup.py (Python)
    const pyprojectPath = path.join(rootPath, 'pyproject.toml');
    const setupPyPath = path.join(rootPath, 'setup.py');
    if (fs.existsSync(pyprojectPath) || fs.existsSync(setupPyPath)) {
      language = 'python';
      packageManager = 'pip';
      buildSystem = 'setuptools';
      detectedTools.push('python');

      // Detect test framework
      try {
        const content = fs.readFileSync(pyprojectPath || setupPyPath, 'utf-8');
        if (content.includes('pytest')) testFramework = 'pytest';
        if (content.includes('unittest')) testFramework = 'unittest';
      } catch (e) {
        // Ignore
      }
    }

    return {
      language,
      buildSystem,
      testFramework,
      packageManager,
      detectedTools,
    };
  }

  /**
   * Collect git and worktree metadata.
   */
  private static collectMetadata(
    rootPath: string,
    ecosystem: EcosystemInfo
  ): RepositoryMetadata {
    let commitSha = 'unknown';
    let branch = 'unknown';
    let hasUncommittedChanges = false;
    let worktreePath: string | undefined;

    try {
      // Get current commit SHA
      commitSha = execSync('git rev-parse HEAD', {
        cwd: rootPath,
        encoding: 'utf-8',
      }).trim();
    } catch (e) {
      // Not a git repo or git not available
    }

    try {
      // Get current branch
      branch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: rootPath,
        encoding: 'utf-8',
      }).trim();
    } catch (e) {
      // Ignore
    }

    try {
      // Check for uncommitted changes
      const status = execSync('git status --porcelain', {
        cwd: rootPath,
        encoding: 'utf-8',
      });
      hasUncommittedChanges = status.trim().length > 0;
    } catch (e) {
      // Ignore
    }

    try {
      // Detect worktree (git worktree list)
      const worktreeInfo = execSync('git rev-parse --git-common-dir', {
        cwd: rootPath,
        encoding: 'utf-8',
      }).trim();
      if (worktreeInfo && !worktreeInfo.endsWith('.git')) {
        worktreePath = path.dirname(worktreeInfo);
      }
    } catch (e) {
      // Ignore
    }

    return {
      commitSha,
      branch,
      rootPath,
      ecosystem,
      hasUncommittedChanges,
      worktreePath,
    };
  }

  /**
   * Get the merge base with another branch (for change analysis).
   * 
   * Useful for understanding what changed relative to a baseline.
   */
  async getMergeBase(otherBranch: string = 'origin/main'): Promise<string | null> {
    try {
      const mergeBase = execSync(`git merge-base HEAD ${otherBranch}`, {
        cwd: this.rootPath,
        encoding: 'utf-8',
      }).trim();
      return mergeBase;
    } catch (e) {
      return null;
    }
  }

  /**
   * List files changed relative to a branch or commit.
   * 
   * Usage:
   * ```typescript
   * const changed = await repo.getChangedFiles('main');
   * ```
   */
  async getChangedFiles(baseRef: string = 'HEAD~1'): Promise<string[]> {
    try {
      const files = execSync(
        `git diff --name-only ${baseRef}...HEAD`,
        {
          cwd: this.rootPath,
          encoding: 'utf-8',
        }
      );
      return files
        .split('\n')
        .map((f) => f.trim())
        .filter((f) => f.length > 0);
    } catch (e) {
      return [];
    }
  }

  /**
   * Standard exclusions for analysis (generated, vendor, lock files).
   * 
   * Returns glob patterns to exclude from analysis.
   */
  getStandardExclusions(): string[] {
    const exclusions = [
      'node_modules/**',
      '.git/**',
      'dist/**',
      'build/**',
      'target/**',
      '__pycache__/**',
      '*.pyc',
      '.cache/**',
      '.venv/**',
      'venv/**',
      '.egg-info/**',
      'coverage/**',
      '.next/**',
      '.nuxt/**',
      'out/**',
      '.output/**',
    ];

    // Add package manager lock files
    if (this.metadata.ecosystem.packageManager === 'npm') {
      exclusions.push('package-lock.json', 'npm-shrinkwrap.json');
    }
    if (this.metadata.ecosystem.packageManager === 'yarn') {
      exclusions.push('yarn.lock');
    }
    if (this.metadata.ecosystem.packageManager === 'pnpm') {
      exclusions.push('pnpm-lock.yaml');
    }

    return exclusions;
  }
}
