---
name: agent-tool-analysis
description: Analyze coding-agent tool telemetry, remove dead tools, and recommend whether a simple specialist split beats one pruned agent.
---

# Agent Tool Analysis

Find actual tool usage, remove dead tools, compare a pruned flat agent with telemetry-grounded specialist candidates, and explain the simplest architecture worth considering.

This skill is advisory. Do not modify agent configuration, MCP/plugin settings, or IDE settings unless the user explicitly asks for an apply step.

## Normal workflow

Run the one public optimizer command from the skill's `scripts` directory:

```text
python -m optimize_agent_tools
```

The command discovers supported local telemetry using its defaults and writes:

- `agent_tool_analysis/agent_tool_analysis.json` — structured evidence and recommendation;
- `agent_tool_analysis/agent_tool_analysis.md` — the report to read first;
- `agent_tool_analysis/architecture_manifest.json` — candidate architectures for optional replay validation.

Then:

1. inspect the pruned flat baseline and the specialist recommendation;
2. explain which tools are retained, removed, or grouped and why;
3. prefer the smallest coherent candidate that beats the baseline under plausible coordination costs;
4. stop before generating or installing agents.

The analyzer does not assign semantic names, invent responsibilities, learn routes, or choose a production winner. It supplies generic tool surfaces and measured trade-offs; interpretation comes after the evidence.

## Decision rule

The dependency-closed, dead-tool-pruned flat agent is the baseline to beat. Separate directly observed exposure, historical calls, inferred exposure, and unresolved exposure; missing evidence is not evidence of absence.

Specialists are worth considering only when their context savings plausibly exceed delegation and communication overhead without losing historically required capabilities. Prefer a simpler split over a larger one when the benefit is similar. A pruned flat agent is a valid recommendation.

## Escape hatches

Use these only when the normal workflow needs help:

- **Discovery repair:** use `inspect_codex_telemetry.py` to inspect supported telemetry structure when automatic discovery fails. Keep inspection structural and privacy-preserving; do not read prompts, tool arguments, command output, source code, or secrets merely to locate telemetry.
- **Empirical validation:** when the user wants quality, routing, or token validation, use `replay_architectures.py` internally with `architecture_manifest.json` and a real replay bundle. Replay is advanced validation, not part of the normal recommendation path, and its strict frozen-baseline check still applies.

## Evidence and privacy

Use tool names, provider names, session counts, call order, definition metadata, and exposure indicators. Avoid reproducing user content, prompts, arguments, outputs, source code, credentials, or tokens.

Do not claim production superiority from telemetry alone. Replay or another controlled quality experiment is required before applying a specialist architecture.
