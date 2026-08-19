import assert from "node:assert/strict";
import test from "node:test";

import { parseJsonEvidence } from "../evidence.js";

test("preserves an adapter's JSON value and provenance", () => {
  const result = parseJsonEvidence('{"files":["src/index.ts"]}', {
    adapter: "dependency-graph",
    capability: "dependency-graph-loading",
    tool: "external-cli",
  });

  assert.deepEqual(result, {
    kind: "evidence",
    provenance: {
      adapter: "dependency-graph",
      capability: "dependency-graph-loading",
      tool: "external-cli",
    },
    value: { files: ["src/index.ts"] },
  });
});

test("returns structured partial failure for invalid analyzer JSON", () => {
  const result = parseJsonEvidence("not JSON", {
    adapter: "dependency-graph",
    capability: "dependency-graph-loading",
    tool: "external-cli",
  });

  assert.equal(result.kind, "error");
  assert.equal(result.error.kind, "invalid-json");
});

test("uses an adapter validator before accepting object-shaped JSON", () => {
  const result = parseJsonEvidence(
    '{"wrong":true}',
    { adapter: "dependency-graph", capability: "dependency-graph-loading", tool: "external-cli" },
    (value): value is { files: string[] } =>
      typeof value === "object" && value !== null && "files" in value,
  );

  assert.equal(result.kind, "error");
  assert.equal(result.error.kind, "invalid-value");
});