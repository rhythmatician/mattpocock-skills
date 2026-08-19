import { spawn } from "node:child_process";

export interface CommandRequest {
  readonly arguments?: readonly string[];
  readonly command: string;
  readonly cwd?: string;
  readonly signal?: AbortSignal;
  readonly timeoutMilliseconds?: number;
}

export interface CommandResult {
  readonly exitCode: number | null;
  readonly kind: "cancelled" | "failure" | "spawn-error" | "success" | "timeout";
  readonly stderr: string;
  readonly stdout: string;
}

export function runCommand(request: CommandRequest): Promise<CommandResult> {
  return new Promise((resolve) => {
    let outcome: CommandResult["kind"] | undefined;
    let stderr = "";
    let stdout = "";

    const child = spawn(request.command, request.arguments ?? [], {
      cwd: request.cwd,
      shell: false,
      windowsHide: true,
    });
    const timeout = request.timeoutMilliseconds
      ? setTimeout(() => {
          outcome = "timeout";
          child.kill();
        }, request.timeoutMilliseconds)
      : undefined;
    const cancel = () => {
      outcome = "cancelled";
      child.kill();
    };

    request.signal?.addEventListener("abort", cancel, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error: Error) => {
      outcome = "spawn-error";
      stderr += error.message;
    });
    child.on("close", (exitCode) => {
      if (timeout) {
        clearTimeout(timeout);
      }
      request.signal?.removeEventListener("abort", cancel);
      resolve({
        exitCode,
        kind: outcome ?? (exitCode === 0 ? "success" : "failure"),
        stderr,
        stdout,
      });
    });
  });
}