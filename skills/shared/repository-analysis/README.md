# Shared TypeScript Analysis Substrate

Reusable infrastructure for repository-diagnostic skills in this global skills repository. This substrate provides the "lever" that multiple diagnostic skills (maintenance-risk, test-suite-health, knowledge-hygiene, feedback-loop-health, codebase-health) can build on, without duplicating runners, tool discovery, caching, and report schemas.

## Philosophy

- **Build the lever, not a framework.** This substrate provides small deterministic scripts and adapters that make analysis rerunnable and reviewable. Shared infrastructure emerges from repeated concrete needs, not speculative abstraction.
- **Helpers must be obvious.** Consumers depend on capabilities, not presentation formats. Give adapters narrow, documented entry points and machine-readable output.
- **Doctor/health-check capability.** Long-lived or externally managed tools should have a cheap read-only "is this instance usable and is it the expected version?" check before expensive work depends on them.
- **Evidence survives cleanup; residue does not.** Cleanup removes scratch/runtime state without destroying the evidence/report a parent skill needs to synthesize.
- **Deterministic analysis beats repeated reasoning.** If the same repository inspection or normalization can be scripted, it lives here rather than asking every skill to rediscover it.

## What This Owns

- Repository-root discovery
- Ecosystem detection (language, build system, test framework)
- Subprocess execution with timeout and cancellation
- External CLI discovery and version probing
- Deterministic temporary/output directories
- Common exclusions (generated, vendor, lock files)
- Git and worktree metadata
- Partial-success reporting
- Cache keys and invalidation
- Common report metadata and schema helpers
- JSON parsing and validation
- Cleanup of ephemeral artifacts
- History analysis helpers (bulk commits, renames, merges, exclusions)
- Analysis budgets (quick, standard, deep modes)

## What This Does NOT Own

- Architecture judgments (that belongs to skills building on this)
- Test/coverage verdicts (test-suite-health owns that)
- Knowledge/documentation quality judgments (knowledge-hygiene owns that)
- Feedback-loop or maintenance-risk verdicts (those skills own them)
- Codebase-specific enforcement rules

## Adapter Model

External analyzers sit behind small adapters so skills depend on capabilities rather than presentation:

```
skill
  -> shared runner (this substrate)
      -> analyzer adapter
          -> external CLI (eslint, pytest, cargo test, etc.)
      -> normalized evidence
  -> skill-specific interpretation
```

Capabilities include:
- Temporal coupling (when things changed together)
- Cognitive complexity
- Mutation testing
- Randomized test order
- Dependency graph loading
- Dead-code candidates
- Build/test/verification timing

Analyzers are optional: missing ones produce honest partial results rather than silent skips or invented evidence.

## Core Modules

### `repository.ts`

Repository discovery and metadata:
- Detect repository root (git, package.json, etc.)
- Load ecosystem info (Node/Python/Rust/Go language detection)
- Worktree and commit metadata
- Git exclusions and merge base detection

### `executor.ts`

Subprocess execution with observability:
- Run commands with timeout/cancellation
- Capture stdout/stderr deterministically
- Report partial success when some tasks complete
- Health checks for tools before expensive work

### `cli-discovery.ts`

Find and probe external tools:
- Locate executable (PATH search, Node modules, Cargo, etc.)
- Probe version and capabilities
- Cheap health check before depending on a tool

### `schema.ts`

Common types and schemas:
- Analysis metadata (commit, worktree state, tool versions, time, analysis version)
- Report structure (findings with provenance)
- Partial-success envelope (which parts completed, which failed)
- Normalized evidence format

### `cache.ts`

Cache management:
- Cache key generation from repository state
- Invalidation when inputs change
- Ephemeral vs. evidence-surviving cleanup

### `history.ts`

History analysis helpers:
- Bulk mechanical commit exclusions
- Large changeset handling
- Rename tracking
- Configurable path/commit exclusions
- Merge-aware traversal

### `adapter-pattern.md`

Documentation and examples for writing adapters that normalize external CLI output.

## Analysis Budgets

Support bounded execution depth:
- `quick`: Shallow analysis for fast feedback (seconds)
- `standard`: Balanced depth for normal use (minutes)
- `deep`: Exhaustive analysis for thorough reviews (many minutes)

Each skill declares which budget it supports, and runners respect the bound.

## Usage

For a skill building on this substrate:

```typescript
import { Repository } from './repository';
import { Executor } from './executor';
import { Schema } from './schema';

async function analyzeRepository(path: string) {
  const repo = await Repository.discover(path);
  const executor = new Executor(repo);
  
  // Health check before expensive work
  const health = await executor.checkHealth('eslint');
  if (!health.available) {
    return partialSuccess({
      analyzed: false,
      reason: 'eslint not available'
    });
  }
  
  // Run analysis
  const result = await executor.run('eslint', ['.'], { timeout: 30000 });
  
  // Normalize evidence through adapter
  const normalized = await normalizeEslintOutput(result);
  
  // Return with metadata
  return {
    evidence: normalized,
    metadata: Schema.createMetadata({
      repository: repo,
      toolVersions: { eslint: health.version },
      analysisTime: Date.now(),
    })
  };
}
```

Consumers can then interpret the normalized evidence however they want:

```typescript
// maintenance-risk interprets it for risk assessment
// test-suite-health interprets it for test quality
// Neither needs to know how the analysis was run
```

## Interoperability

Preserve provenance so child findings can be reused:
- Hotspot data guides test targeting
- Dependency evidence informs architecture
- Document graph metadata informs knowledge hygiene
- Feedback timing informs maintenance risk
- `/codebase-health` can synthesize child evidence without scraping prose

## Example: First Consumer (maintenance-risk)

`maintenance-risk` is the early proving consumer that validates this substrate before over-generalizing:

1. Use repository discovery to understand the codebase
2. Use CLI discovery to find analyzers (eslint, pytest, cargo, etc.)
3. Use executor to run them with health checks
4. Normalize output through adapters
5. Combine evidence into a maintenance-risk report
6. Return normalized evidence so other skills can reuse findings

## Acceptance Criteria

- [x] Core analysis infrastructure is TypeScript using repo conventions
- [x] Repository discovery, subprocess execution, tool discovery, common metadata, caching/artifacts, partial failure handling are reusable
- [x] Analyzer-specific output isolated behind adapter/normalization boundaries
- [x] Substrate remains project/language agnostic and does not modify target repos for audits by default
- [x] Helpers expose narrow documented invocation/contracts
- [x] Tool/process health/version checks supported
- [x] Cleanup preserves evidence while removing scratch/runtime residue
- [x] Existing reusable analysis artifacts can be consumed instead of regenerated
- [x] History helpers support exclusions/renames/large changesets
- [x] Quick/standard/deep budgets representable
- [x] Normalized evidence can pass between cooperating skills with provenance
- [ ] maintenance-risk uses this as early proving consumer (separate PR)
- [ ] No skill-specific judgments are hard-coded here

## Directory Structure

```
skills/shared/repository-analysis/
├── README.md                    # This file
├── src/
│   ├── repository.ts            # Repository discovery and metadata
│   ├── executor.ts              # Subprocess execution
│   ├── cli-discovery.ts         # Find and probe external tools
│   ├── schema.ts                # Common types and schemas
│   ├── cache.ts                 # Cache management
│   ├── history.ts               # History analysis helpers
│   ├── index.ts                 # Public exports
│   └── __tests__/               # Test suite
│       ├── repository.test.ts
│       ├── executor.test.ts
│       ├── cli-discovery.test.ts
│       └── schema.test.ts
├── docs/
│   ├── adapter-pattern.md       # How to write adapters
│   ├── budget-modes.md          # Analysis budget documentation
│   └── examples/
│       ├── eslint-adapter.ts
│       ├── pytest-adapter.ts
│       └── cargo-test-adapter.ts
└── CHANGELOG.md
```

## Notes for Future Skills

When adding a new diagnostic skill:
1. Import from `skills/shared/repository-analysis`
2. Implement your skill's judgment logic (not the infrastructure)
3. Write a small adapter to normalize your external tool's output
4. Return normalized evidence with full provenance
5. Update this README with your skill as a documented consumer
