# Changelog

All notable changes to the shared analysis substrate will be documented in this file.

## [0.1.0] - 2026-08-19

### Added

- **Core Modules**
  - `repository.ts`: Repository discovery, ecosystem detection, git metadata
  - `executor.ts`: Subprocess execution with timeouts, cancellation, observability
  - `cli-discovery.ts`: External CLI tool discovery and version probing
  - `schema.ts`: Common types, schemas, and validators
  - `cache.ts`: Analysis result caching with validity checking
  - `history.ts`: Repository history analysis with filtering and hotspot detection

- **Documentation**
  - `README.md`: Comprehensive substrate overview and philosophy
  - `docs/adapter-pattern.md`: How to write adapters for external tools
  - `docs/budget-modes.md`: Analysis budgets (quick, standard, deep) and implementation guide

- **Key Features**
  - Repository root discovery (git, package.json, Cargo.toml, go.mod, pyproject.toml)
  - Ecosystem detection (language, build system, test framework, package manager)
  - Subprocess execution with timeout/cancellation support
  - Tool health checks before expensive work
  - Deterministic cache management with commit-based invalidation
  - Partial success reporting for complex analyses
  - History analysis with bulk commit exclusion and hotspot detection
  - Standard exclusion patterns (generated, vendor, lock files)
  - Analysis budget constraints (quick: 30s, standard: 3min, deep: 20min)
  - JSON schema validators for evidence and metadata

- **Project Agnostic Design**
  - No language assumptions (TypeScript, Python, Rust, Go support)
  - No modification of target repositories for audits
  - Reusable across all diagnostic skills
  - Adapter pattern for normalizing tool output
  - Provenance tracking for evidence reuse

### Acceptance Criteria

- [x] Shared infrastructure in TypeScript using repo conventions
- [x] Repository discovery, subprocess execution, tool discovery, metadata, caching, partial failure handling
- [x] Analyzer output behind adapter/normalization boundaries
- [x] Project/language agnostic, non-destructive audits
- [x] Narrow documented invocation/contracts
- [x] Tool/process health/version checks
- [x] Cleanup preserves evidence while removing residue
- [x] Existing analysis artifacts can be reused
- [x] History helpers support exclusions/renames/large changesets
- [x] Quick/standard/deep budgets representable
- [x] Normalized evidence with provenance between skills
- [ ] maintenance-risk as early proving consumer (separate PR)
- [ ] No skill-specific judgments hard-coded

### Next Steps

1. Implement `maintenance-risk` skill as first proving consumer
2. Add example adapters for eslint, pytest, cargo test
3. Collect feedback from other diagnostic skills
4. Refine adapter patterns based on real usage
5. Add performance optimization based on profiling
