import assert from "node:assert/strict";
import test from "node:test";

import { runCommand } from "../runner.js";

test("captures successful command output without a shell", async () => {
  const result = await runCommand({
    command: process.execPath,
    arguments: ["-e", "process.stdout.write('evidence')"],
  });

  assert.deepEqual(result, {
    exitCode: 0,
    kind: "success",
    stderr: "",
    stdout: "evidence",
  });
});

test("reports a command timeout as partial evidence", async () => {
  const result = await runCommand({
    command: process.execPath,
    arguments: ["-e", "setTimeout(() => {}, 1000)"],
    timeoutMilliseconds: 25,
  });

  assert.equal(result.kind, "timeout");
  assert.equal(result.exitCode, null);
});