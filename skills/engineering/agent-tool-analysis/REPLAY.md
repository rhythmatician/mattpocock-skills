# Replay/A-B harness

The replay harness evaluates an architecture manifest with any number of architectures and agents. `pruned_flat_baseline` remains the benchmark and must retain the frozen dependency-closed flat tool surface.

The harness does not learn routes, infer exposure, or search for partitions. The manifest and replay bundle provide explicit architecture membership and explicit per-architecture activation paths.

## Architecture manifest

Use `architecture_manifest.example.json` as the schema example. Each architecture declares:

- `architecture_id`;
- `parent_tools`;
- `agents`, mapping arbitrary agent IDs to arbitrary tool lists.

The manifest also declares `baseline_architecture_id` and the historical tool-capability set. The parser rejects a drifted `pruned_flat_baseline` surface.

## Activation paths and measurements

Each task may provide an `activation_paths` object keyed by architecture ID. A path is ordered and may contain zero, one, or multiple agent IDs. This is an explicit replay route, not a routing policy.

Each recorded observation reports the executor's actual `agent_activation_path`, plus:

- task success and observed replay capability coverage;
- tool-call, routing, missed, and unnecessary activation failures;
- input and tool-definition/context tokens;
- explicit `delegation_tokens` and `inter_agent_communication_tokens`;
- turns and wall-clock time.

Historical tool capability coverage is calculated from the manifest's available tool surfaces. Observed replay capability coverage is calculated from the executor observations. They are reported separately and are not interchangeable.

## Candidate success gate

A candidate passes only when all three strict conditions hold:

- historical tool-capability coverage is exactly 100%;
- mean task quality is at least the `pruned_flat_baseline` result;
- total tool-definition/context tokens are strictly lower than `pruned_flat_baseline`.

The harness also reports agent activations, inter-agent handoffs, delegation tokens, communication tokens, total orchestration tokens, and all prior operational metrics.

## Run

Generate or refresh `agent_tool_analysis/agent_tool_analysis.json` first, then run `replay_architectures.py` with both `--architecture-manifest` and `--replay-input`. The CLI verifies that the generated report's retained baseline tools match the manifest.

The example observations are synthetic schema placeholders only and are not quality or architecture evidence. Supply a real replay bundle captured by an external executor before treating results as empirical.
