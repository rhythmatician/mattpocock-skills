import { spawn } from "node:child_process";

export type ProcessFailureKind =
  | "cancelled"
  | "output-limit"
  | "spawn"
  | "timeout";

export class ProcessExecutionError extends Error {
  constructor(
    message: string,
    readonly kind: ProcessFailureKind,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ProcessExecutionError";
  }
}

export type ProcessResult = {
  exitCode: number | null;
  stderr: string;
  stdout: string;
};

export const runProcess = async (options: {
  args: string[];
  cwd: string;
  executable: string;
  maxOutputBytes?: number;
  signal?: AbortSignal;
  timeoutMs: number;
}): Promise<ProcessResult> => {
  if (options.signal?.aborted) {
    throw new ProcessExecutionError(
      "Process execution was cancelled",
      "cancelled",
    );
  }

  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(options.executable, options.args, {
      cwd: options.cwd,
      shell: false,
      signal: options.signal,
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const maxOutputBytes = options.maxOutputBytes ?? 8 * 1024 * 1024;
    let outputBytes = 0;
    let settled = false;
    let timeout: NodeJS.Timeout | undefined;

    const fail = (error: ProcessExecutionError) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      child.kill();
      rejectPromise(error);
    };

    const collect = (chunks: Buffer[], chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > maxOutputBytes) {
        fail(
          new ProcessExecutionError(
            `Process output exceeded ${maxOutputBytes} bytes`,
            "output-limit",
          ),
        );
        return;
      }
      chunks.push(chunk);
    };

    child.stdout.on("data", (chunk: Buffer) => collect(stdout, chunk));
    child.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk));
    child.on("error", (error) => {
      fail(
        options.signal?.aborted
          ? new ProcessExecutionError(
              "Process execution was cancelled",
              "cancelled",
              { cause: error },
            )
          : new ProcessExecutionError(
              `Could not start ${options.executable}: ${error.message}`,
              "spawn",
              { cause: error },
            ),
      );
    });
    child.on("close", (exitCode) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolvePromise({
        exitCode,
        stderr: Buffer.concat(stderr).toString("utf8"),
        stdout: Buffer.concat(stdout).toString("utf8"),
      });
    });

    timeout = setTimeout(
      () =>
        fail(
          new ProcessExecutionError(
            `Process timed out after ${options.timeoutMs}ms`,
            "timeout",
          ),
        ),
      options.timeoutMs,
    );
  });
};
