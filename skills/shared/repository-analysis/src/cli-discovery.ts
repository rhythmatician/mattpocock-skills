/**
 * External CLI tool discovery and version probing.
 * 
 * Find executables in PATH, Node modules, Cargo, etc.
 * Probe versions and capabilities before depending on tools.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/**
 * CLI tool discovery and probing.
 * 
 * Usage:
 * ```typescript
 * const cli = new CliDiscovery(repo.rootPath);
 * 
 * const eslint = await cli.find('eslint');
 * if (eslint) {
 *   console.log(`Found eslint at ${eslint}`);
 * }
 * 
 * const version = await cli.probeVersion('eslint');
 * console.log(`Version: ${version}`);
 * ```
 */
export class CliDiscovery {
  private readonly workdir: string;
  private cache: Map<string, string | null> = new Map();

  constructor(workdir: string) {
    this.workdir = workdir;
  }

  /**
   * Find an executable in PATH, node_modules, Cargo, etc.
   * 
   * Searches in order:
   * 1. Local node_modules/.bin (for Node projects)
   * 2. Cargo (for Rust projects)
   * 3. System PATH
   * 4. Local scripts directory
   */
  async find(name: string): Promise<string | null> {
    // Check cache first
    if (this.cache.has(name)) {
      return this.cache.get(name) || null;
    }

    // Try node_modules/.bin first (Node projects)
    const nodeModulesBin = path.join(this.workdir, 'node_modules', '.bin', name);
    if (fs.existsSync(nodeModulesBin)) {
      this.cache.set(name, nodeModulesBin);
      return nodeModulesBin;
    }

    // Try with .cmd or .ps1 extension (Windows)
    const nodeModulesBinCmd = nodeModulesBin + '.cmd';
    if (fs.existsSync(nodeModulesBinCmd)) {
      this.cache.set(name, nodeModulesBinCmd);
      return nodeModulesBinCmd;
    }

    // Try cargo (Rust)
    try {
      const result = execSync(`cargo which ${name} 2>/dev/null`, {
        cwd: this.workdir,
        encoding: 'utf-8',
        stdio: 'pipe',
      }).trim();
      if (result) {
        this.cache.set(name, result);
        return result;
      }
    } catch (e) {
      // Ignore
    }

    // Try system PATH
    try {
      const cmd = process.platform === 'win32' ? `where ${name}` : `which ${name}`;
      const result = execSync(cmd, {
        cwd: this.workdir,
        encoding: 'utf-8',
        stdio: 'pipe',
      }).trim();
      if (result) {
        this.cache.set(name, result);
        return result;
      }
    } catch (e) {
      // Ignore
    }

    // Not found
    this.cache.set(name, null);
    return null;
  }

  /**
   * Get version of an installed tool.
   * 
   * Tries common version flags: --version, -v, --semver
   */
  async probeVersion(toolName: string): Promise<string | null> {
    const executable = await this.find(toolName);
    if (!executable) {
      return null;
    }

    const versionFlags = ['--version', '-v', '--semver', 'version'];

    for (const flag of versionFlags) {
      try {
        const output = execSync(`${executable} ${flag}`, {
          cwd: this.workdir,
          encoding: 'utf-8',
          stdio: 'pipe',
          timeout: 5000,
        })
          .trim()
          .split('\n')[0];

        if (output && output.length > 0 && output.length < 100) {
          return output;
        }
      } catch (e) {
        // Try next flag
      }
    }

    return null;
  }

  /**
   * Probe for specific capabilities of a tool.
   * 
   * Returns true if the tool supports the given capability.
   * 
   * Usage:
   * ```typescript
   * if (await cli.hasCapability('eslint', '--format=json')) {
   *   // Can use JSON output
   * }
   * ```
   */
  async hasCapability(toolName: string, capability: string): Promise<boolean> {
    const executable = await this.find(toolName);
    if (!executable) {
      return false;
    }

    try {
      const output = execSync(`${executable} --help`, {
        cwd: this.workdir,
        encoding: 'utf-8',
        stdio: 'pipe',
        timeout: 5000,
      });

      return output.includes(capability);
    } catch (e) {
      return false;
    }
  }

  /**
   * Get all executable names in a specific location (e.g., node_modules/.bin).
   * 
   * Useful for discovering all available tools.
   */
  async listNodeModulesBinaries(): Promise<string[]> {
    const binDir = path.join(this.workdir, 'node_modules', '.bin');
    if (!fs.existsSync(binDir)) {
      return [];
    }

    try {
      const files = fs.readdirSync(binDir);
      return files
        .filter((f) => {
          // Exclude .cmd and .ps1 files
          if (f.endsWith('.cmd') || f.endsWith('.ps1')) {
            return false;
          }
          const stat = fs.statSync(path.join(binDir, f));
          return stat.isFile() || stat.isSymbolicLink();
        })
        .map((f) => f.split('.')[0]); // Remove extensions
    } catch (e) {
      return [];
    }
  }

  /**
   * Clear the discovery cache (in case tools are installed mid-session).
   */
  clearCache(): void {
    this.cache.clear();
  }
}

/**
 * Common analyzer tools and their version probe methods.
 */
export const KnownTools = {
  eslint: {
    name: 'eslint',
    versionFlag: '--version',
    helps: '--help',
  },
  prettier: {
    name: 'prettier',
    versionFlag: '--version',
    helps: '--help',
  },
  pytest: {
    name: 'pytest',
    versionFlag: '--version',
    helps: '--help',
  },
  cargo: {
    name: 'cargo',
    versionFlag: '--version',
    helps: '--help',
  },
  go: {
    name: 'go',
    versionFlag: 'version',
    helps: 'help',
  },
  python: {
    name: 'python',
    versionFlag: '--version',
    helps: '--help',
  },
  tsc: {
    name: 'tsc',
    versionFlag: '--version',
    helps: '--help',
  },
};
