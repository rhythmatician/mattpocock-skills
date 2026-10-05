# Graphify adapter: Wayfinder decisions

Load this only when the user explicitly asks to ingest or synchronize closed Wayfinder decisions, or when a Wayfinder map's **Notes** explicitly require it. This adapter projects canonical tracker resolutions into corpus documents that Graphify can extract. It never writes to the tracker.

## Interface and authority

The adapter accepts:

- one Wayfinder map identity;
- the corpus root whose graph should receive the decisions; and
- optionally, a named subset of closed decision tickets.

It produces one normalized Markdown document per closed decision under `<corpus-root>/wayfinder-decisions/`, then runs the normal Graphify full-build or update workflow. The ticket URL is the decision's stable identity. The normalized document and resulting graph nodes are derived projections: the tracker resolution remains canonical.

The adapter must not:

- edit the map, ticket, resolution comment, or tracker dependencies;
- treat graph edges as Wayfinder blockers or frontier state;
- ingest open tickets, fog, or out-of-scope closures as decided facts;
- guess which comment is the resolution; or
- persist an ordinary Wayfinder graph query unless separately requested.

## Read the canonical decisions

Consult the repository's issue-tracker instructions for its read operations. For GitHub, read the map and each selected ticket without mutation:

```text
gh issue view <map> --json number,title,body,url
gh issue view <ticket> --json number,title,body,url,state,closedAt,comments
```

Enumerate decisions from the map's **Decisions so far** links, not from every closed child: a closed child may instead be out of scope. In each ticket, select the comment beginning with `<!-- wayfinder-resolution -->`.

For older tickets without the marker, do not infer from “last comment.” Report the ticket as skipped and ask the user to identify or mark the canonical resolution. Likewise, skip and report any ticket that is not closed, is absent from **Decisions so far**, or has multiple marked resolution comments.

## Normalize the projection

Use the host's file-edit primitive to create or update one adapter-owned file per decision. Derive its name from the immutable ticket URL, excluding the mutable ticket title:

```text
<corpus-root>/wayfinder-decisions/<tracker-host>-<owner>-<repository>-<ticket-number>.md
```

Normalize the URL-derived segments to lowercase ASCII letters, digits, and hyphens. For a tracker URL without those four components, use the lowercase hexadecimal SHA-256 of the complete ticket URL as the filename stem. Before writing, scan adapter-owned files for the same `source_url`; update that projection rather than creating a second one, and move a legacy or non-normalized filename to the stable name.

Write this shape, preserving the ticket's question and marked resolution verbatim:

```markdown
---
graphify_adapter: wayfinder-decision
source_url: <ticket URL>
captured_at: <ticket closedAt>
author: <resolution comment author>
---

# Decision: <ticket title>

- Map: [<map title>](<map URL>)
- Ticket: [<ticket title>](<ticket URL>)
- Closed: <ticket closedAt>
- Provenance: canonical marked Wayfinder resolution comment

## Question

<the ticket's Question section>

## Resolution

<marked resolution comment without the marker>

## Decision gist

<the exact gist from the map's Decisions so far entry>
```

Keep filenames and field order stable so synchronization is idempotent. Overwrite or move only a file carrying `graphify_adapter: wayfinder-decision` whose `source_url` matches the same ticket. If a previously projected ticket has been reopened or removed from **Decisions so far**, remove only its matching adapter-owned file during an explicitly requested synchronization and report the removal.

The explicit map and ticket links allow semantic extraction to produce evidence-backed relationships. The standard Graphify provenance rules apply: explicit relationships are `EXTRACTED`; uncertain semantic connections remain `INFERRED` or `AMBIGUOUS`. Never manufacture relationships from tracker ordering or proximity in the map body.

## Update the graph

After materializing the normalized documents, return to `SKILL.md` and run:

- the normal full-build workflow when `graphify-out/graph.json` does not exist; or
- the normal `--update` workflow when it does.

Do not splice nodes directly into `graph.json`; extraction, health checks, the shrink guard, and manifest handling remain owned by the normal Graphify workflows.

Then load `graphify-out/graph.json` and verify every non-skipped projection by its ticket URL. Each must contribute at least one node whose `source_url` equals the ticket URL and whose `source_file`, `captured_at`, and `author` are non-empty. A decision that produces no matching node, or loses any required provenance field, is **failed**, not ingested. Report it with the normalized document path and missing evidence so the extraction can be corrected and rerun.

The adapter is complete only when every selected decision is either skipped for one of the explicit canonical-source reasons above or has at least one verified provenance-bearing node.

Complete the adapter handoff by reporting:

- decisions ingested, updated, removed, skipped, and failed;
- the absolute normalized-document directory;
- the absolute Graphify output directory;
- any ambiguous or missing resolution provenance; and
- all warnings required by the selected Graphify build or update workflow.
