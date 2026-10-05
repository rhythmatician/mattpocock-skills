import { runProcess } from "./process.ts";

export const runGit = async (
  executable: string,
  args: string[],
  options: {
    cwd: string;
    maxOutputBytes?: number;
    signal?: AbortSignal;
    timeoutMs: number;
  },
) => {
  const result = await runProcess({
    args,
    cwd: options.cwd,
    executable,
    maxOutputBytes: options.maxOutputBytes ?? 8 * 1024 * 1024,
    signal: options.signal,
    timeoutMs: options.timeoutMs,
  });
  if (result.exitCode !== 0) {
    throw new Error(
      result.stderr.trim() ||
        `Git exited with code ${result.exitCode ?? "unknown"}`,
    );
  }
  return result.stdout;
};
