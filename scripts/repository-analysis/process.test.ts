import assert from "node:assert/strict";
import test from "node:test";

import { ProcessExecutionError, runProcess } from "./process.ts";

test("passes arguments without shell interpretation", async () => {
  const shellLikeArgument = "hello; echo injected";
  const result = await runProcess({
    args: ["-e", "process.stdout.write(process.argv[1])", shellLikeArgument],
    cwd: process.cwd(),
    executable: process.execPath,
    timeoutMs: 1_000,
  });

  assert.equal(result.stdout, shellLikeArgument);
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
});

test("bounds long-running commands with a timeout", async () => {
  await assert.rejects(
    runProcess({
      args: ["-e", "setTimeout(() => {}, 10_000)"],
      cwd: process.cwd(),
      executable: process.execPath,
      timeoutMs: 20,
    }),
    (error) =>
      error instanceof ProcessExecutionError && error.kind === "timeout",
  );
});

test("accepts cancellation from its caller", async () => {
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    runProcess({
      args: ["-e", "setTimeout(() => {}, 10_000)"],
      cwd: process.cwd(),
      executable: process.execPath,
      signal: controller.signal,
      timeoutMs: 1_000,
    }),
    (error) =>
      error instanceof ProcessExecutionError && error.kind === "cancelled",
  );
});
