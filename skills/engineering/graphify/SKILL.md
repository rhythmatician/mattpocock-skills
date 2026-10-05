---
name: graphify
description: "Graphify code and project content. Use an existing graphify-out/graph.json to answer natural-language questions about architecture or relationships. Also use when the user explicitly asks to build, update, query, traverse, explain, export, or watch a Graphify graph from code, documents, papers, images, or video, or to ingest or synchronize closed Wayfinder decisions."
---

# Graphify

Turn a corpus into a navigable knowledge graph with an honest audit trail and persistent HTML, JSON, and Markdown outputs.

## Route the request

1. If the user invoked `/graphify --help` or `/graphify -h` with no other arguments, load [command usage](references/usage.md), print its Usage block verbatim, and stop before runtime initialization.
2. If the user explicitly asks to ingest or synchronize closed Wayfinder decisions, load the [Wayfinder decision-ingestion adapter](references/wayfinder-decisions.md).
3. If the request is a natural-language corpus question, `graphify-out/graph.json` is absent, and the user did not explicitly invoke Graphify, return control to the owning workflow for normal source exploration. Stop this skill before runtime initialization or graph construction.
4. Before any command, load [the cross-platform runtime](references/runtime.md). It defines the exact `graphify_python` launcher for PowerShell and POSIX shells. Use that launcher in every referenced runbook.
5. If `graphify-out/graph.json` exists and the request is a natural-language corpus question, use [query, path, and explain](references/query.md) without detecting files, checking corpus size, or rebuilding. Keep implicitly triggered queries read-only unless the user asks to persist the result.
6. For `--update` or `--cluster-only`, load [incremental update and reclustering](references/update.md) and the [full-build runbook](references/full-build.md) sections it explicitly reuses.
7. For `add` or `--watch`, use [add and watch](references/add-watch.md).
8. Otherwise use the [full-build runbook](references/full-build.md). If no path was supplied, use `.` without asking.

Load these branch references only when their condition is present:

- GitHub URLs, multiple roots, or monorepo merge: [GitHub and merge](references/github-and-merge.md)
- Video or audio: [transcription](references/transcribe.md)
- Semantic agent extraction: [extraction specification](references/extraction-spec.md)
- Wiki, Neo4j, FalkorDB, SVG, GraphML, MCP, or benchmark flags: [exports](references/exports.md)
- Commit hooks or CLAUDE.md integration: [hooks](references/hooks.md)

Every reference is one hop from this file. After using one, return here to select any additional branch.

## Wayfinder handoff

When invoked from a Wayfinder ticket, return an evidence packet: the answer; nodes and edges used; source locations and confidence; and any ambiguity or missing evidence. Wayfinder owns the ticket resolution and every planning-state judgment.

Implicit Wayfinder handoffs query an existing graph read-only. Persistence and decision ingestion require an explicit user request or standing direction in the map's **Notes**. When no graph exists, return control to Wayfinder for normal source exploration.

## Semantic extraction invariants

- Structural code extraction is deterministic, free, and needs no API key.
- Never ask for an API key or block on a missing key. Graphify reads only an already-set `GEMINI_API_KEY` or `GOOGLE_API_KEY`; otherwise the host agent performs semantic extraction.
- A code-only corpus skips semantic extraction but must still create an empty `.graphify_semantic.json` before merging.
- Run structural and semantic extraction concurrently when the host supports it.
- For documents, papers, or images without Gemini, use subagents when available. If unavailable, extract inline; never stall.
- Preserve `EXTRACTED`, `INFERRED`, and `AMBIGUOUS` provenance and the confidence rubric from the extraction specification.
- Cache semantic results against the absolute extraction-spec path so prompt changes invalidate stale entries.
- Do not stamp failed or omitted semantic files in the manifest; they must be re-queued on the next update.

## Honesty and safety

- Never invent an edge. Use `AMBIGUOUS` when evidence is uncertain.
- Never skip the large-corpus warning or hide skipped-sensitive files.
- Always show token cost and raw cohesion scores in the report.
- Warn before HTML visualization above 5,000 nodes.
- An empty extraction must not overwrite a valid graph or report.
- Honor the graph shrink guard. If shrinkage is intentional, require the explicit force path.
- Surface graph-health warnings for dangling or missing endpoints, self-loops, and collapsed directed or undirected edges.
- Treat cleanup as targeted deletion of known `graphify-out` temporary files only.

## Completion criteria

- Query, path, or explain: finish when the answer cites graph evidence; when persistence was requested, also confirm the saved result.
- Build, update, add, cluster, or export: finish when every requested output exists and is non-empty and every applicable warning is surfaced. Report the absolute output directory; show only God Nodes, Surprising Connections, and Suggested Questions from `GRAPH_REPORT.md`; then offer the single most interesting suggested question for follow-up traversal.
- Watch or MCP: finish the handoff when the long-running process is active and its mode and stop procedure are reported.
