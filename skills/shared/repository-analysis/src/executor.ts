/**
 * Subprocess execution with timeout, cancellation, and observability.
 * 
 * Handles running external commands with:
 * - Timeout enforcement
 * - Output capture (stdout/stderr)
 * - Cancellation support
 * - Health checks before expensive work
 * - Partial success reporting
 */

import { spawn, exec } from 'child_process';
import { Writable } from 'stream';
import { ExecutionResult, ToolHealthCheck } from './schema';

/**
 * Options for executing a command.
 */
export interface ExecutionOptions {
  /** Working directory for execution (defaults to current directory) */
  cwd?: string;
  /** Timeout in milliseconds (0 = no timeout) */
  timeout?: number;
  /** Maximum output bytes to capture (0 = unlimited) */
  maxOutputBytes?: number;
  /** Environment variables to pass */
  env?: Record<string, string>;
  /** Shell to use (for command strings) */
  shell?: string;
}

/**
 * Subprocess executor with observability and timeouts.
 * 
 * Usage:
 * ```typescript
 * const executor = new Executor(repo);
 * 
 * // Health check a tool first
 * const health = await executor.checkHealth('eslint');
 * if (!health.available) {
 *   console.log('eslint not available:', health.error);
 *   return;
 * }
 * 
 * // Run a command
 * const result = await executor.run('eslint', ['.'], {
 *   timeout: 30000,
 *   cwd: repo.rootPath,
 * });
 * 
 * console.log(`Exit code: ${result.exitCode}`);
 * console.log(`Output (${result.durationMs}ms):`, result.stdout);
 * ```
 */
export class Executor {
  private readonly workdir: string;

  constructor(workdir: string) {
    this.workdir = workdir;
  }

  /**
   * Check if a tool is available and usable.
   * 
   * This is a cheap health check that runs before expensive work.
   * Returns availability, version, and any detected capabilities.
   * 
   * Usage:
   * ```typescript
   * const health = await executor.checkHealth('eslint');
   * if (health.available) {
   *   console.log(`Using eslint ${health.version}`);
   *   if (health.capabilities?.includes('--format=json')) {
   *     // Can use JSON output
   *   }
   * }
   * ```
   */
  async checkHealth(tool: string): Promise<ToolHealthCheck> {
    try {
      // Try to get version first (most tools support --version or -V)
      const versionResult = await this.runCommand(`${tool} --version`, {
        timeout: 5000,
        maxOutputBytes: 1000,
      });

      if (versionResult.exitCode === 0) {
        const version = versionResult.stdout.trim().split('\n')[0];
        return {
          available: true,
          version,
          capabilities: [],
        };
      }

      // Some tools use -v
      const altResult = await this.runCommand(`${tool} -v`, {
        timeout: 5000,
        maxOutputBytes: 1000,
      });

      if (altResult.exitCode === 0) {
        const version = altResult.stdout.trim().split('\n')[0];
        return {
          available: true,
          version,
          capabilities: [],
        };
      }

      return {
        available: false,
        error: `Could not determine version of ${tool}`,
      };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      return {
        available: false,
        error: `${tool} not available: ${error}`,
      };
    }
  }

  /**
   * Run an executable with arguments.
   * 
   * Usage:
   * ```typescript
   * const result = await executor.run('eslint', ['.', '--format=json'], {
   *   timeout: 30000,
   * });
   * if (result.exitCode === 0) {
   *   const findings = JSON.parse(result.stdout);
   * }
   * ```
   */
  async run(
    executable: string,
    args: string[] = [],
    options: ExecutionOptions = {}
  ): Promise<ExecutionResult> {
    const command = [executable, ...args].join(' ');
    return this.runCommand(command, options);
  }

  /**
   * Run a shell command (for complex commands with pipes, etc).
   * 
   * Usage:
   * ```typescript
   * const result = await executor.runCommand('find . -name "*.ts" | head -100');
   * ```
   */
  async runCommand(
    command: string,
    options: ExecutionOptions = {}
  ): Promise<ExecutionResult> {
    const cwd = options.cwd || this.workdir;
    const timeout = options.timeout || 0;
    const maxOutputBytes = options.maxOutputBytes || 10 * 1024 * 1024; // 10MB default

    const startTime = Date.now();
    let timedOut = false;

    return new Promise((resolve) => {
      let timeoutHandle: NodeJS.Timeout | null = null;
      let stdoutChunks: Buffer[] = [];
      let stderrChunks: Buffer[] = [];
      let stdoutSize = 0;
      let stderrSize = 0;
      let outputTruncated = false;

      try {
        const child = spawn('sh', ['-c', command], {
          cwd,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, ...options.env },
        });

        // Handle stdout
        child.stdout!.on('data', (chunk: Buffer) => {
          stdoutSize += chunk.length;
          if (stdoutSize <= maxOutputBytes) {
            stdoutChunks.push(chunk);
          } else if (!outputTruncated) {
            outputTruncated = true;
            stdoutChunks.push(Buffer.from('\n[OUTPUT TRUNCATED]'));
          }
        });

        // Handle stderr
        child.stderr!.on('data', (chunk: Buffer) => {
          stderrSize += chunk.length;
          if (stderrSize <= maxOutputBytes) {
            stderrChunks.push(chunk);
          } else if (!outputTruncated) {
            outputTruncated = true;
            stderrChunks.push(Buffer.from('\n[OUTPUT TRUNCATED]'));
          }
        });

        // Set timeout
        if (timeout > 0) {
          timeoutHandle = setTimeout(() => {
            timedOut = true;
            child.kill('SIGTERM');
          }, timeout);
        }

        // Handle process exit
        child.on('error', (error) => {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          const durationMs = Date.now() - startTime;

          resolve({
            exitCode: -1,
            stdout: Buffer.concat(stdoutChunks).toString(),
            stderr: `${Buffer.concat(stderrChunks).toString()}\nError: ${error.message}`,
            durationMs,
            timedOut,
            completeOutput: !outputTruncated,
          });
        });

        child.on('close', (exitCode) => {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          const durationMs = Date.now() - startTime;

          resolve({
            exitCode: exitCode || 0,
            stdout: Buffer.concat(stdoutChunks).toString(),
            stderr: Buffer.concat(stderrChunks).toString(),
            durationMs,
            timedOut,
            completeOutput: !outputTruncated,
          });
        });
      } catch (error) {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        const durationMs = Date.now() - startTime;

        resolve({
          exitCode: -1,
          stdout: '',
          stderr: error instanceof Error ? error.message : String(error),
          durationMs,
          timedOut,
          completeOutput: true,
        });
      }
    });
  }

  /**
   * Run multiple commands in sequence, returning partial success.
   * 
   * Continues even if some commands fail, collecting all results.
   * 
   * Usage:
   * ```typescript
   * const results = await executor.runMany([
   *   { name: 'eslint', command: 'eslint . --format=json' },
   *   { name: 'prettier', command: 'prettier --check .' },
   * ], { timeout: 60000 });
   * ```
   */
  async runMany(
    commands: Array<{
      name: string;
      command: string;
    }>,
    options: ExecutionOptions = {}
  ): Promise<Array<{
    name: string;
    result: ExecutionResult;
  }>> {
    const results = [];

    for (const { name, command } of commands) {
      const result = await this.runCommand(command, options);
      results.push({ name, result });
    }

    return results;
  }
}
