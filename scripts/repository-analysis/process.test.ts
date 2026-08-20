import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

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

test("timeout terminates descendant processes", async () => {
  const sentinelPath = join(
    mkdtempSync(join(tmpdir(), "process-tree-")),
    "grandchild-finished",
  );
  const grandchildCode = `setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(
    sentinelPath,
  )}, "finished"), 1000)`;
  const parentCode = `
    require("node:child_process").spawn(
      process.execPath,
      ["-e", ${JSON.stringify(grandchildCode)}],
      { stdio: "ignore" }
    );
    setTimeout(() => {}, 10000);
  `;

  await assert.rejects(
    runProcess({
      args: ["-e", parentCode],
      cwd: process.cwd(),
      executable: process.execPath,
      timeoutMs: 50,
    }),
    (error) =>
      error instanceof ProcessExecutionError && error.kind === "timeout",
  );
  await delay(1_200);

  assert.equal(existsSync(sentinelPath), false);
});

test(
  "timeout escalates termination for descendants that ignore SIGTERM",
  { skip: process.platform === "win32" },
  async () => {
    const sentinelPath = join(
      mkdtempSync(join(tmpdir(), "process-tree-escalation-")),
      "grandchild-finished",
    );
    const grandchildCode = `
      process.on("SIGTERM", () => {});
      setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(
        sentinelPath,
      )}, "finished"), 1000);
    `;
    const parentCode = `
      require("node:child_process").spawn(
        process.execPath,
        ["-e", ${JSON.stringify(grandchildCode)}],
        { stdio: "ignore" }
      );
      setTimeout(() => {}, 10000);
    `;

    await assert.rejects(
      runProcess({
        args: ["-e", parentCode],
        cwd: process.cwd(),
        executable: process.execPath,
        timeoutMs: 100,
      }),
      (error) =>
        error instanceof ProcessExecutionError && error.kind === "timeout",
    );
    await delay(1_200);

    assert.equal(existsSync(sentinelPath), false);
  },
);
