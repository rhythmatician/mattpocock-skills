import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  estimateSkillTokens,
  inventorySkills,
  parseAgentSkillDocument,
  validateSkillReferences,
} from "./agent-skill-tooling.ts";
import {
  checkSkillEcosystemIntegrity,
  type EcosystemManifest,
} from "./skill-ecosystem-integrity.ts";

const write = (path: string, content: string) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

const skill = (name: string, body = "# Demo\n", extraFrontmatter = "") => `---
name: ${name}
description: ${name} does one job.
${extraFrontmatter}---

${body}`;

test("preserves raw structured frontmatter and extracts folded portable fields", () => {
  const parsed = parseAgentSkillDocument(`---
name: demo
description: >
  A folded
  description.
metadata:
  owner: tests
---

# Demo
`);

  assert.equal(parsed.fields.description, "A folded description.\n");
  assert.match(parsed.frontmatterRaw, /metadata:\n  owner: tests/);
  assert.deepEqual(parsed.warnings, ["structured-field-preserved-raw:metadata"]);
});

test("inventory keeps duplicate identities separate and records governing instructions", () => {
  const repositoryRoot = mkdtempSync(join(tmpdir(), "skill-inventory-"));
  write(join(repositoryRoot, "AGENTS.md"), "# Governing instructions\n");
  write(
    join(repositoryRoot, "skills", "first", "SKILL.md"),
    skill("duplicate"),
  );
  write(
    join(repositoryRoot, "skills", "second", "SKILL.md"),
    skill("duplicate"),
  );

  const inventory = inventorySkills({
    repositoryRoot,
    root: join(repositoryRoot, "skills"),
  });

  assert.equal(inventory.skills[0]?.skillPath, "skills/first/SKILL.md");
  assert.deepEqual(inventory.duplicateNames, {
    duplicate: ["skills/first/SKILL.md", "skills/second/SKILL.md"],
  });
  assert.deepEqual(inventory.repositoryInstructions, ["AGENTS.md"]);
});

test("token estimates use extracted folded descriptions", () => {
  const parsed = parseAgentSkillDocument(`---
name: demo
description: >
  A folded
  description.
---

# Demo
`);
  const estimate = estimateSkillTokens(parsed, "SKILL.md");
  const catalog = "name: demo\ndescription: A folded description.\n";
  const expected = Math.max(
    catalog.trim().split(/\s+/).length,
    Math.ceil(catalog.length / 4),
  );

  assert.equal(estimate.catalogTokens, expected);
});

test("reference validation catches broken, external, and deep links", () => {
  const packageRoot = mkdtempSync(join(tmpdir(), "skill-references-"));
  write(
    join(packageRoot, "SKILL.md"),
    skill(
      "demo",
      "Read [one](references/one.md), [missing](assets/missing.json), and [outside](../outside.md).\n",
    ),
  );
  write(
    join(packageRoot, "references", "one.md"),
    "Read [two](two.md).\n",
  );
  write(join(packageRoot, "references", "two.md"), "# Two\n");

  const findings = validateSkillReferences(join(packageRoot, "SKILL.md"));

  assert.deepEqual(
    findings.map(({ kind, target }) => ({ kind, target })),
    [
      { kind: "broken", target: "assets/missing.json" },
      { kind: "external", target: "../outside.md" },
      { kind: "deeper-than-one-hop", target: "two.md" },
    ],
  );
});

test("integrity check enforces unique names and synchronized user-only metadata", () => {
  const repositoryRoot = mkdtempSync(join(tmpdir(), "skill-integrity-"));
  write(
    join(repositoryRoot, "skills", "one", "SKILL.md"),
    skill("same", "# One\n", "disable-model-invocation: true\n"),
  );
  write(
    join(repositoryRoot, "skills", "one", "agents", "openai.yaml"),
    "interface:\n  display_name: One\n",
  );
  write(
    join(repositoryRoot, "skills", "two", "SKILL.md"),
    skill("same", "# Two\n"),
  );

  const result = checkSkillEcosystemIntegrity({ repositoryRoot });

  assert.equal(result.valid, false);
  assert.equal(result.findings.some(({ code }) => code === "duplicate-name"), true);
  assert.equal(
    result.findings.some(({ code }) => code === "user-only-metadata-mismatch"),
    true,
  );
});

test("quoted and numeric user-only values are invalid in frontmatter and sidecars", () => {
  const repositoryRoot = mkdtempSync(join(tmpdir(), "skill-quoted-user-only-"));
  write(
    join(repositoryRoot, "skills", "quoted", "SKILL.md"),
    skill("quoted", "# Quoted\n", 'disable-model-invocation: "true"\n'),
  );
  write(
    join(repositoryRoot, "skills", "quoted", "agents", "openai.yaml"),
    'policy:\n  allow_implicit_invocation: "false"\n',
  );
  write(
    join(repositoryRoot, "skills", "numeric", "SKILL.md"),
    skill("numeric", "# Numeric\n", "disable-model-invocation: 1\n"),
  );
  write(
    join(repositoryRoot, "skills", "numeric", "agents", "openai.yaml"),
    "policy:\n  allow_implicit_invocation: 0\n",
  );

  const result = checkSkillEcosystemIntegrity({ repositoryRoot });

  assert.equal(
    result.findings.filter(
      ({ code }) => code === "invalid-user-only-metadata",
    ).length,
    4,
  );
});

test("malformed user-only YAML cannot silently become model-invoked", () => {
  const repositoryRoot = mkdtempSync(join(tmpdir(), "skill-malformed-user-only-"));
  write(
    join(repositoryRoot, "skills", "malformed", "SKILL.md"),
    `---
name: malformed
description: malformed metadata fixture
disable-model-invocation: [true
---

# Malformed
`,
  );
  write(
    join(repositoryRoot, "skills", "malformed", "agents", "openai.yaml"),
    "policy:\n  allow_implicit_invocation: [false\n",
  );

  const result = checkSkillEcosystemIntegrity({ repositoryRoot });

  assert.equal(
    result.findings.some(({ code }) => code === "invalid-frontmatter"),
    true,
  );
  assert.equal(
    result.findings.some(
      ({ code, message }) =>
        code === "invalid-user-only-metadata" &&
        message.includes("openai.yaml"),
    ),
    true,
  );
});

test("integrity check catches unresolved composition and unbounded invocation cycles", () => {
  const repositoryRoot = mkdtempSync(join(tmpdir(), "skill-composition-"));
  write(join(repositoryRoot, "skills", "router", "SKILL.md"), skill("router"));
  write(join(repositoryRoot, "skills", "worker", "SKILL.md"), skill("worker"));
  const manifest: EcosystemManifest = {
    version: "1",
    edges: [
      { from: "router", kind: "invokes", to: "worker" },
      { from: "worker", kind: "may-invoke", to: "router" },
      { from: "router", kind: "requires", to: "missing" },
    ],
  };

  const result = checkSkillEcosystemIntegrity({ manifest, repositoryRoot });

  assert.equal(
    result.findings.some(({ code }) => code === "unresolved-composition-skill"),
    true,
  );
  assert.equal(
    result.findings.some(({ code }) => code === "unbounded-composition-cycle"),
    true,
  );
});

test("composition cannot autonomously invoke a user-only child", () => {
  const repositoryRoot = mkdtempSync(join(tmpdir(), "skill-user-only-edge-"));
  write(join(repositoryRoot, "skills", "router", "SKILL.md"), skill("router"));
  write(
    join(repositoryRoot, "skills", "manual", "SKILL.md"),
    skill("manual", "# Manual\n", "disable-model-invocation: true\n"),
  );
  write(
    join(repositoryRoot, "skills", "manual", "agents", "openai.yaml"),
    "policy:\n  allow_implicit_invocation: false\n",
  );

  const result = checkSkillEcosystemIntegrity({
    manifest: {
      version: "1",
      edges: [{ from: "router", kind: "invokes", to: "manual" }],
    },
    repositoryRoot,
  });

  assert.equal(
    result.findings.some(
      ({ code }) => code === "user-only-composition-violation",
    ),
    true,
  );
});

test("malformed composition manifests become integrity findings", () => {
  const repositoryRoot = mkdtempSync(join(tmpdir(), "skill-bad-manifest-"));
  write(join(repositoryRoot, "skills", "demo", "SKILL.md"), skill("demo"));

  const result = checkSkillEcosystemIntegrity({
    manifest: { version: "2", edges: "not-an-array" } as unknown as EcosystemManifest,
    repositoryRoot,
  });

  assert.equal(
    result.findings.some(({ code }) => code === "invalid-composition-manifest"),
    true,
  );
});

test("malformed default composition manifest becomes a finding", () => {
  const repositoryRoot = mkdtempSync(join(tmpdir(), "skill-bad-default-manifest-"));
  write(join(repositoryRoot, "skills", "demo", "SKILL.md"), skill("demo"));
  write(
    join(repositoryRoot, ".agents", "skill-ecosystem.json"),
    "{ not valid JSON",
  );

  const result = checkSkillEcosystemIntegrity({ repositoryRoot });

  assert.equal(result.valid, false);
  assert.equal(
    result.findings.some(
      ({ code }) => code === "invalid-composition-manifest",
    ),
    true,
  );
});

test("malformed explicit manifest writes a report and exits one", () => {
  const repositoryRoot = mkdtempSync(join(tmpdir(), "skill-bad-explicit-manifest-"));
  write(join(repositoryRoot, "skills", "demo", "SKILL.md"), skill("demo"));
  const manifestPath = join(repositoryRoot, "broken-manifest.json");
  write(manifestPath, "{ broken");
  const outputPath = join(
    mkdtempSync(join(tmpdir(), "skill-bad-manifest-report-")),
    "integrity.json",
  );
  const scriptPath = join(
    process.cwd(),
    "scripts",
    "repository-analysis",
    "skill-ecosystem-cli.ts",
  );

  const execution = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      scriptPath,
      "integrity",
      "--repo",
      repositoryRoot,
      "--manifest",
      manifestPath,
      "--output",
      outputPath,
    ],
    { encoding: "utf8" },
  );
  const report = JSON.parse(readFileSync(outputPath, "utf8")) as {
    findings: Array<{ code: string }>;
  };

  assert.equal(execution.status, 1, execution.stderr);
  assert.equal(
    report.findings.some(
      ({ code }) => code === "invalid-composition-manifest",
    ),
    true,
  );
});

test("missing plugin discovery roots become integrity findings", () => {
  const repositoryRoot = mkdtempSync(join(tmpdir(), "skill-missing-root-"));
  write(
    join(repositoryRoot, ".claude-plugin", "plugin.json"),
    JSON.stringify({ skills: ["./skills/does-not-exist"] }),
  );

  const result = checkSkillEcosystemIntegrity({ repositoryRoot });

  assert.equal(
    result.findings.some(({ code }) => code === "missing-discovery-root"),
    true,
  );
});

test("valid JSON that violates its adjacent schema becomes a finding", () => {
  const repositoryRoot = mkdtempSync(join(tmpdir(), "skill-schema-invalid-"));
  const skillRoot = join(repositoryRoot, "skills", "schema-demo");
  write(join(skillRoot, "SKILL.md"), skill("schema-demo"));
  write(
    join(skillRoot, "assets", "contract.schema.json"),
    JSON.stringify({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      additionalProperties: false,
      properties: { value: { type: "string" } },
      required: ["value"],
      type: "object",
    }),
  );
  write(
    join(skillRoot, "assets", "contract.json"),
    JSON.stringify({ value: 42 }),
  );
  write(join(skillRoot, "assets", "contract.missing.json"), JSON.stringify({}));

  const result = checkSkillEcosystemIntegrity({ repositoryRoot });

  assert.equal(
    result.findings.some(
      ({ code, message }) =>
        code === "json-schema-validation" && message.includes("contract.json"),
    ),
    true,
  );
  assert.equal(
    result.findings.some(
      ({ code, message }) =>
        code === "json-schema-validation" &&
        message.includes("contract.missing.json"),
    ),
    true,
  );
});

test("intentional router composition and shared principles are not ownership collisions", () => {
  const repositoryRoot = join(
    process.cwd(),
    "scripts",
    "repository-analysis",
    "fixtures",
    "cooperating-skill-ecosystem",
  );
  const manifest = JSON.parse(
    readFileSync(join(repositoryRoot, ".agents", "skill-ecosystem.json"), "utf8"),
  ) as EcosystemManifest;

  const result = checkSkillEcosystemIntegrity({ manifest, repositoryRoot });

  assert.equal(result.valid, true, JSON.stringify(result.findings, null, 2));
  assert.equal(result.inventory.skills.length, 7);
  assert.equal(
    result.inventory.skills.every(({ sidecars }) =>
      sidecars.includes("agents/openai.yaml"),
    ),
    true,
  );
  assert.equal(result.composition.edges.length, 10);
  assert.deepEqual(result.composition.cycles, []);
});

test("repository manifest models conditional health skills without unresolved nodes", () => {
  const repositoryRoot = process.cwd();
  const manifest = JSON.parse(
    readFileSync(join(repositoryRoot, ".agents", "skill-ecosystem.json"), "utf8"),
  ) as EcosystemManifest;

  const result = checkSkillEcosystemIntegrity({ manifest, repositoryRoot });

  assert.equal(result.valid, true, JSON.stringify(result.findings, null, 2));
  assert.equal(result.composition.edges.length, 11);
  assert.deepEqual(
    result.composition.nodes
      .filter(({ availability }) => availability === "conditional")
      .map(({ name }) => name)
      .sort(),
    ["architecture-guardrails", "codebase-health", "feedback-loop-health"],
  );
  assert.equal(
    result.composition.edges.some(
      ({ artifact }) => artifact === "Health Regression",
    ),
    true,
  );
});

test("the migrated auditor keeps every behavior-bearing package dependency", () => {
  const packageRoot = join(
    process.cwd(),
    "skills",
    "engineering",
    "skill-ecosystem-auditor",
  );
  const requiredDependencies = [
    "agents/openai.yaml",
    "assets/audit-result.fixture.json",
    "assets/audit-result.schema.json",
    "assets/eval-corpus.schema.json",
    "assets/eval-corpus.json",
    "assets/eval-observations.fixture.json",
    "assets/eval-observations.schema.json",
    "references/cooperating-ecosystems.md",
    "references/host-profiles.md",
    "references/migration.md",
    "references/rubric.md",
  ];

  for (const dependency of requiredDependencies) {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "auditor-package-"));
    const copiedPackage = join(temporaryRoot, "skill-ecosystem-auditor");
    cpSync(packageRoot, copiedPackage, { recursive: true });
    rmSync(join(copiedPackage, dependency));

    const findings = validateSkillReferences(join(copiedPackage, "SKILL.md"));

    assert.equal(
      findings.some(
        ({ kind, target }) => kind === "broken" && target === dependency,
      ),
      true,
      dependency,
    );
  }
});

test("auditor schemas preserve reproducible findings and extensible evaluation cases", () => {
  const packageRoot = join(
    process.cwd(),
    "skills",
    "engineering",
    "skill-ecosystem-auditor",
  );
  const auditSchema = JSON.parse(
    readFileSync(join(packageRoot, "assets", "audit-result.schema.json"), "utf8"),
  ) as {
    properties: { findings: { items: { required: string[] } } };
  };
  const corpusSchema = JSON.parse(
    readFileSync(join(packageRoot, "assets", "eval-corpus.schema.json"), "utf8"),
  ) as {
    properties: {
      cases: {
        items: {
          properties: {
            expectations: { additionalProperties: boolean };
            metadata: { additionalProperties: boolean };
          };
        };
      };
    };
  };

  assert.ok(
    auditSchema.properties.findings.items.required.includes("source"),
  );
  assert.ok(
    auditSchema.properties.findings.items.required.includes("observed_value"),
  );
  assert.equal(
    corpusSchema.properties.cases.items.properties.expectations
      .additionalProperties,
    true,
  );
  assert.equal(
    corpusSchema.properties.cases.items.properties.metadata
      .additionalProperties,
    true,
  );
});

test("auditor corpus, observations, and result fixtures are enforced by JSON Schema", () => {
  const packageRoot = join(
    process.cwd(),
    "skills",
    "engineering",
    "skill-ecosystem-auditor",
  );
  const invalidAssets = [
    ["audit-result.fixture.json", { audit_date: 42 }],
    ["eval-corpus.json", { version: "1" }],
    ["eval-observations.fixture.json", { runs: "not-an-array" }],
  ] as const;

  for (const [asset, invalidInstance] of invalidAssets) {
    const repositoryRoot = mkdtempSync(join(tmpdir(), "auditor-schema-"));
    const copiedPackage = join(
      repositoryRoot,
      "skills",
      "skill-ecosystem-auditor",
    );
    cpSync(packageRoot, copiedPackage, { recursive: true });
    write(
      join(copiedPackage, "assets", asset),
      JSON.stringify(invalidInstance),
    );

    const result = checkSkillEcosystemIntegrity({ repositoryRoot });

    assert.equal(
      result.findings.some(
        ({ code, message }) =>
          code === "json-schema-validation" && message.includes(asset),
      ),
      true,
      asset,
    );
  }
});

test("integrity CLI writes a compact receipt and machine-readable evidence", () => {
  const repositoryRoot = join(
    process.cwd(),
    "scripts",
    "repository-analysis",
    "fixtures",
    "cooperating-skill-ecosystem",
  );
  const outputPath = join(
    mkdtempSync(join(tmpdir(), "skill-integrity-output-")),
    "integrity.json",
  );
  const scriptPath = join(
    process.cwd(),
    "scripts",
    "repository-analysis",
    "skill-ecosystem-cli.ts",
  );
  const stdout = execFileSync(
    process.execPath,
    [
      "--import",
      "tsx",
      scriptPath,
      "integrity",
      "--repo",
      repositoryRoot,
      "--output",
      outputPath,
    ],
    { encoding: "utf8" },
  );
  const receipt = JSON.parse(stdout) as { outputPath: string; valid: boolean };
  const evidence = JSON.parse(readFileSync(outputPath, "utf8")) as {
    inventory: { skills: unknown[] };
    valid: boolean;
  };

  assert.deepEqual(receipt, { outputPath, valid: true });
  assert.equal(evidence.valid, true);
  assert.equal(evidence.inventory.skills.length, 7);
  assert.ok(stdout.length < 1_000);
});
