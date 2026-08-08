---
name: agent-tool-analysis
description: Analyze local coding-agent tool telemetry, identify wasted tool-description context, and recommend a lower-overhead specialist-agent architecture. Use when a developer wants to reduce tool/context overhead, determine whether specialist agents are worthwhile, or discover how their actual workload should be partitioned.
---

# Agent Tool Analysis

Analyze the developer's actual agent-tool usage and recommend the simplest architecture that reduces context overhead without sacrificing required capabilities.

This skill is advisory. Do not create, install, enable, disable, or modify agent configurations unless the user explicitly asks for an apply/install step.

## Core principle

Do not assume any fixed agent taxonomy.

Names such as "GitHub specialist", "code specialist", "database specialist", or "cloud specialist" are possible conclusions from one user's telemetry, not predefined categories.

Let the analyzer discover the operational structure. Use the LLM to interpret that structure semantically only after the empirical analysis has completed.

The optimization target is:

- preserve required capability and task quality;
- reduce tool-description and related context overhead;
- prefer simpler architectures when additional specialists provide only marginal benefit;
- account explicitly for routing, delegation, and communication overhead;
- distinguish observed evidence from counterfactual assumptions.

The dependency-closed, dead-tool-pruned flat agent is the baseline to beat.

## Division of responsibility

The CLI owns empirical and quantitative analysis:

- telemetry discovery and ingestion;
- tool-call counts;
- directly observed exposure;
- provider/exposure evidence;
- tool-definition cost recovery or estimation;
- dead-tool pruning;
- dependency closure;
- tool affinity and boundary analysis;
- candidate partition search;
- token-cost estimates;
- activation rates;
- delegation break-even calculations;
- uncertainty and sensitivity analysis.

The LLM owns semantic interpretation:

- explaining the result;
- identifying coherent workload families;
- assigning human-readable agent names;
- writing agent descriptions;
- identifying likely responsibilities and routing boundaries;
- deciding whether a proposed split is interpretable enough to be useful;
- recognizing when the flat baseline is preferable;
- diagnosing environment-discovery failures;
- proposing validation or apply steps.

Do not reproduce quantitative analysis manually when the CLI can calculate it.

## Workflow

### 1. Locate the analyzer

Prefer the analyzer shipped with this skill.

Expected script:

```text
scripts/optimize_agent_tools.py
```

Resolve the script relative to this `SKILL.md` rather than assuming the user's current working directory.

If the host exposes the skill directory directly, use that location. Otherwise locate the current skill directory before invoking the script.

### 2. Run automatic discovery first

Run the analyzer without requiring the user to configure telemetry paths manually.

Preferred form:

```bash
uv run python <skill-dir>/scripts/optimize_agent_tools.py
```

If `uv` is unavailable, use an appropriate available Python interpreter:

```bash
python <skill-dir>/scripts/optimize_agent_tools.py
```

Do not ask the user for telemetry directories before attempting the analyzer's built-in defaults.

### 3. If discovery fails, diagnose before asking the user

If the analyzer reports that no supported sessions or definitions were found:

1. determine which supported coding-agent runtimes appear to be installed;
2. inspect common local configuration and telemetry locations;
3. rerun the analyzer with explicit path overrides when appropriate;
4. ask the user for a path only when it cannot be discovered safely.

Do not search unrelated personal files.

Prefer structural/runtime locations such as:

- application configuration directories;
- agent session/history directories;
- IDE workspace storage;
- runtime manifests;
- MCP/plugin configuration.

Avoid reading prompts, message bodies, tool arguments, command output, source-code contents, or other sensitive payloads merely to locate telemetry.

### 4. Read the generated analysis

The analyzer currently emits:

```text
agent_tool_analysis/agent_tool_analysis.json
agent_tool_analysis/agent_tool_analysis.md
```

Prefer the JSON artifact for structured reasoning and the Markdown report for human-readable verification.

Do not paste or load an exhaustive multi-thousand-row report into working context unless necessary. Read the smallest sections needed to make the decision.

Pay particular attention to:

- corpus/session coverage;
- definition-cost coverage;
- directly observed exposure;
- pruned flat baseline;
- tools removed and retained;
- observed dead-tool savings;
- catalog-only pruning candidates;
- unresolved retained runtime exposure;
- clusters and strongest relationships;
- candidate architecture variants;
- exposure sensitivity;
- delegation break-even values;
- dependency warnings;
- caveats.

### 5. Establish the flat baseline

The default benchmark is the dependency-closed, dead-tool-pruned flat architecture.

Treat these categories separately:

- directly observed, never-used exposed tools: empirical removal candidates;
- catalog-only zero-use tools: possible removal candidates whose exposure benefit is unmeasured;
- retained used tools: required by historical evidence;
- dependency-retained tools: retained because another required capability depends on them;
- unresolved runtime exposure: unknown, not zero.

Do not call "catalog tokens removed" realized savings.

Prefer language such as:

```text
Catalog tokens removed: X
Observed dead-tool savings: Y known tokens/session
Catalog-only candidates: N tools; exposure benefit unmeasured
Unresolved retained runtime exposure: unknown
```

A specialist architecture must beat the pruned flat baseline, not merely the original bloated tool surface.

### 6. Interpret candidate specialization

Use telemetry-derived clusters and partitions as evidence, not as final agent definitions.

For each promising candidate, inspect:

- tool membership;
- internal affinity;
- boundary margins;
- activation frequency;
- cross-boundary usage;
- dependency warnings;
- estimated definition cost;
- break-even exposure assumptions;
- communication/delegation sensitivity;
- whether the grouping corresponds to a coherent responsibility.

Reject or de-prioritize a mathematically convenient grouping that has no sensible operational interpretation.

Do not hard-code domain labels. Infer them from the tool names, relationships, and workload evidence.

Examples of valid interpretations might include:

- source-control / pull-request operations;
- repository editing and test execution;
- deployment and infrastructure;
- database administration;
- browser automation;
- issue tracking;
- design tooling;
- observability;
- documentation.

These are examples only.

### 7. Decide how many agents are justified

The long-term target is to compare candidate architectures with different agent counts.

Prefer the smallest architecture that provides a meaningful robust advantage over the pruned flat baseline.

A useful decision ordering is:

```text
1 agent: pruned flat baseline
2 agents: candidate partitions
3 agents: candidate partitions
...
```

Evaluate each candidate using:

- expected tool-context cost;
- agent activation frequency;
- cross-agent task frequency;
- expected handoff count;
- delegation overhead sensitivity;
- capability coverage;
- quality evidence when available.

Do not recommend more agents solely because more clusters exist.

If a two-agent design provides nearly the same benefit as a five-agent design with substantially less coordination complexity, prefer the two-agent design.

### 8. Account for communication overhead

Specialization is useful only if saved context exceeds routing and communication cost.

Conceptually:

```text
expected architecture cost
    =
    expected specialist tool/context load
    + routing overhead
    + spawn/delegation overhead
    + inter-agent communication overhead
```

Use analyzer-generated break-even calculations when available.

Do not assume delegation is free.

If the report uses zero delegation overhead, describe it as a lower-bound sensitivity case.

### 9. Preserve evidence labels

Keep these concepts separate:

- actual tool call;
- directly observed exposure;
- inferred/counterfactual exposure;
- estimated definition cost;
- exact user-supplied definition cost;
- historical activation;
- assumed routing behavior.

Do not convert absence of evidence into evidence of absence.

In particular:

- a called tool with no exposure record does not prove it was not exposed;
- missing provider telemetry does not prove the provider was unavailable;
- catalog presence does not prove a definition was injected into model context;
- historical activation based on actual calls is an oracle-like lower bound for routing difficulty.

### 10. Produce an interpreted recommendation

Summarize the result in terms a developer can act on.

Use a structure like:

```text
Baseline
- pruned flat architecture
- immediate dead-tool removals
- observed savings
- unresolved exposure/cost uncertainty

Recommended architecture
- agent count
- expected advantage over pruned flat
- coordination rate
- break-even communication overhead
- confidence / major assumptions

Agent 1 — <inferred name>
- responsibility
- tools
- why these tools belong together
- when it should be selected or delegated to

Agent 2 — <inferred name>
- responsibility
- tools
- why these tools belong together
- when it should be selected or delegated to

Alternative architectures
- simpler or more aggressive candidates
- why they were not preferred

Validation needed
- remaining quality/routing questions
```

Agent names should describe responsibilities, not implementation artifacts such as `cluster_01`.

Agent descriptions should be concise enough to act as useful routing descriptions.

### 11. Stop before applying changes

Unless the user explicitly asks to generate or install agents:

- do not write agent configuration files;
- do not remove tools from existing configurations;
- do not modify MCP/plugin settings;
- do not install or uninstall plugins;
- do not edit IDE settings.

Present the recommendation and ask whether the user wants to proceed to validation or application.

## Failure handling

### No telemetry found

Report:

- which runtimes were checked;
- which paths were checked;
- whether the runtime appears installed;
- what additional path information is needed.

Then retry when possible.

### Insufficient history

If the corpus is too small or sparse, do not force a specialist recommendation.

Recommend continued collection or a conservative pruned-flat architecture.

### Definition costs unresolved

Continue structural analysis, but clearly mark cost-dependent conclusions as uncertain.

Use scenario/sensitivity ranges when available.

Do not fabricate tool-schema sizes.

### Exposure unresolved

Do not interpret missing exposure evidence as zero exposure.

Use labeled sensitivity analysis.

Where possible, recommend a controlled runtime experiment to measure effective exposure cost.

### No specialist beats pruned flat

Recommend the pruned flat architecture.

"One agent after pruning" is a valid and potentially optimal result.

## Privacy

Telemetry analysis should minimize collection of user content.

Prefer:

- tool names;
- provider names;
- structural JSON paths;
- call counts;
- timestamps/session IDs when needed;
- schema/definition metadata;
- exposure indicators.

Avoid collecting or reproducing:

- prompts;
- message text;
- tool arguments;
- shell command contents;
- tool outputs;
- source-code contents;
- credentials;
- tokens or secrets.

If additional telemetry inspection is required, inspect structure before payload contents.

## Current limitations

The present implementation is an analysis-stage prototype.

Known incomplete areas:

```text
TODO: generalized k-agent partition search across the full tool graph
TODO: compact recommendation-input artifact for LLM interpretation
TODO: empirical router evaluation
TODO: replay / A-B task-quality validation
TODO: skill/context-cost accounting beyond tool definitions
TODO: host-specific agent generation
TODO: installation/apply workflow
TODO: broader runtime adapters and automatic discovery
```

Do not conceal these limitations.

## Current decision rule

For the current analysis stage:

1. remove directly observed, never-used exposed tools when dependency-safe;
2. use the resulting dependency-closed flat architecture as the baseline;
3. consider specialist architectures only when they show a meaningful advantage over that baseline under plausible exposure and delegation assumptions;
4. prefer coherent, simpler partitions;
5. require empirical quality validation before claiming that specialization is production-superior;
6. do not generate or install agents automatically.

## Future target

The intended mature workflow is:

```text
telemetry discovery
    -> dead-tool pruning
    -> generalized k-agent partition search
    -> context/communication economics
    -> semantic agent interpretation
    -> replay / quality validation
    -> user approval
    -> host-specific agent generation
```

The final output should be a set of actual specialist agents with coherent responsibilities, useful names and descriptions, appropriate tool scopes, and evidence that their reduced context surface is worth the cost of coordination.
