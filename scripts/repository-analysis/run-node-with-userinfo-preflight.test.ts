import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import test from "node:test";

type SpawnResult = {
  error?: Error;
  signal: NodeJS.Signals | null;
  status: number | null;
};

type PreflightRunner = {
  runWithUserInfoPreflight(options?: {
    args?: string[];
    getUserInfo?: () => unknown;
    runNode?: (
      executable: string,
      args: string[],
      options: { stdio: "inherit" },
    ) => SpawnResult;
    writeError?: (message: string) => void;
  }): number;
};

const require = createRequire(__filename);
const runner = require(
  "./run-node-with-userinfo-preflight.cjs",
) as PreflightRunner;

test("reports an actionable diagnostic when os.userInfo fails", () => {
  const messages: string[] = [];
  let childStarted = false;

  const exitCode = runner.runWithUserInfoPreflight({
    args: ["child.js"],
    getUserInfo: () => {
      throw new Error("uv_os_get_passwd returned ENOENT");
    },
    runNode: () => {
      childStarted = true;
      return { signal: null, status: 0 };
    },
    writeError: (message) => messages.push(message),
  });

  assert.equal(exitCode, 1);
  assert.equal(childStarted, false);
  assert.match(messages[0] ?? "", /os\.userInfo\(\) failed/);
  assert.match(messages[0] ?? "", /username and home directory/);
  assert.match(messages[0] ?? "", /uv_os_get_passwd returned ENOENT/);
});

test("passes arguments to Node and returns the child exit code", () => {
  let receivedArgs: string[] = [];

  const exitCode = runner.runWithUserInfoPreflight({
    args: ["--import", "tsx", "child.ts"],
    getUserInfo: () => ({ username: "test-user" }),
    runNode: (executable, args, options) => {
      assert.equal(executable, process.execPath);
      assert.deepEqual(options, { stdio: "inherit" });
      receivedArgs = args;
      return { signal: null, status: 23 };
    },
  });

  assert.deepEqual(receivedArgs, ["--import", "tsx", "child.ts"]);
  assert.equal(exitCode, 23);
});

test("the command-line wrapper propagates the child exit code", () => {
  const result = spawnSync(
    process.execPath,
    [
      "scripts/repository-analysis/run-node-with-userinfo-preflight.cjs",
      "-e",
      "process.exit(17)",
    ],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 17, result.stderr);
});
