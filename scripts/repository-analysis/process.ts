import { spawn, spawnSync } from "node:child_process";

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
  env?: NodeJS.ProcessEnv;
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
      detached: process.platform !== "win32",
      env: options.env,
      shell: false,
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const maxOutputBytes = options.maxOutputBytes ?? 8 * 1024 * 1024;
    let outputBytes = 0;
    let pendingError: ProcessExecutionError | undefined;
    let rootClosed = false;
    let settled = false;
    let escalation: NodeJS.Timeout | undefined;
    let terminationFallback: NodeJS.Timeout | undefined;
    let timeout: NodeJS.Timeout | undefined;

    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      if (escalation) clearTimeout(escalation);
      if (terminationFallback) clearTimeout(terminationFallback);
      options.signal?.removeEventListener("abort", cancel);
    };

    const terminateTree = () => {
      if (!child.pid) {
        child.kill();
        return;
      }
      if (process.platform === "win32") {
        const termination = spawnSync(
          "taskkill",
          ["/PID", String(child.pid), "/T", "/F"],
          {
            shell: false,
            stdio: "ignore",
            timeout: 2_000,
            windowsHide: true,
          },
        );
        if (termination.error || termination.status !== 0) child.kill();
        return;
      }

      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
      escalation = setTimeout(() => {
        try {
          process.kill(-child.pid!, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
        escalation = undefined;
        if (rootClosed && pendingError && !settled) {
          settled = true;
          cleanup();
          rejectPromise(pendingError);
        }
      }, 250);
    };

    const failAfterExit = (error: ProcessExecutionError) => {
      if (settled || pendingError) return;
      pendingError = error;
      if (timeout) clearTimeout(timeout);
      terminateTree();
      terminationFallback = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        rejectPromise(error);
      }, 2_000);
    };

    const cancel = () =>
      failAfterExit(
        new ProcessExecutionError(
          "Process execution was cancelled",
          "cancelled",
        ),
      );

    const failImmediately = (error: ProcessExecutionError) => {
      if (settled) return;
      settled = true;
      cleanup();
      rejectPromise(error);
    };

    const collect = (chunks: Buffer[], chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > maxOutputBytes) {
        failAfterExit(
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
      failImmediately(
        new ProcessExecutionError(
          `Could not start ${options.executable}: ${error.message}`,
          "spawn",
          { cause: error },
        ),
      );
    });
    child.on("close", (exitCode) => {
      if (settled) return;
      rootClosed = true;
      if (pendingError && escalation) return;
      settled = true;
      cleanup();
      if (pendingError) {
        rejectPromise(pendingError);
        return;
      }
      resolvePromise({
        exitCode,
        stderr: Buffer.concat(stderr).toString("utf8"),
        stdout: Buffer.concat(stdout).toString("utf8"),
      });
    });

    options.signal?.addEventListener("abort", cancel, { once: true });
    timeout = setTimeout(
      () =>
        failAfterExit(
          new ProcessExecutionError(
            `Process timed out after ${options.timeoutMs}ms`,
            "timeout",
          ),
        ),
      options.timeoutMs,
    );
  });
};
