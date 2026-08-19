import assert from "node:assert/strict";
import test from "node:test";

import { filterHistory, readGitHistory } from "../history.js";

test("keeps history exclusions configurable and reports why records were omitted", () => {
  const result = filterHistory(
    [
      { files: ["src/order.ts"], hash: "kept", isMerge: false },
      { files: ["package-lock.json"], hash: "lock", isMerge: false },
      { files: ["src/a.ts", "src/b.ts"], hash: "large", isMerge: false },
      { files: ["src/merge.ts"], hash: "merge", isMerge: true },
      { files: ["src/new.ts"], hash: "rename", isMerge: false, isRename: true },
    ],
    { excludeMerges: true, excludeRenames: true, maxChangedFiles: 1 },
  );

  assert.deepEqual(result.included.map((record) => record.hash), ["kept"]);
  assert.deepEqual(result.excluded, [
    { hash: "lock", reason: "excluded-path" },
    { hash: "large", reason: "changed-file-limit" },
    { hash: "merge", reason: "merge" },
    { hash: "rename", reason: "rename" },
  ]);
});

test("parses Git history records and keeps rename evidence", async () => {
  const records = await readGitHistory(".", async () => ({
    exitCode: 0,
    kind: "success",
    stderr: "",
    stdout: "\u001eabc\u001fparent\u0000R100\u0000src/old.ts\u0000src/new.ts\u0000\u001edef\u001f\u0000M\u0000README.md\u0000",
  }));

  assert.deepEqual(records, [
    { files: ["src/new.ts"], hash: "abc", isMerge: false, isRename: true },
    { files: ["README.md"], hash: "def", isMerge: false, isRename: false },
  ]);
});

test("preserves tab characters in NUL-delimited Git paths", async () => {
  const records = await readGitHistory(".", async () => ({
    exitCode: 0,
    kind: "success",
    stderr: "",
    stdout: "\u001eabc\u001f\u0000M\u0000src/has\ta-tab.ts\u0000",
  }));

  assert.deepEqual(records, [
    { files: ["src/has\ta-tab.ts"], hash: "abc", isMerge: false, isRename: false },
  ]);
});