#!/usr/bin/env -S npx tsx
/** Render a Wayfinder map from GitHub's native issue relationships. */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export class GraphError extends Error { }

export interface IssueData {
    number: number;
    title: string;
    html_url: string;
    state: string;
    labels?: Array<{ name: string } | string>;
    assignees?: Array<{ login: string }>;
    repository_url?: string;
    pull_request?: unknown;
}

export class Issue {
    readonly number: number;
    readonly title: string;
    readonly url: string;
    readonly state: string;
    readonly labels: readonly string[];
    readonly assignees: readonly string[];
    readonly external: boolean;

    constructor(data: {
        number: number;
        title: string;
        url: string;
        state: string;
        labels?: readonly string[];
        assignees?: readonly string[];
        external?: boolean;
    }) {
        this.number = data.number;
        this.title = data.title;
        this.url = data.url;
        this.state = data.state;
        this.labels = data.labels ?? [];
        this.assignees = data.assignees ?? [];
        this.external = data.external ?? false;
    }

    get role(): string {
        const roles = this.labels
            .filter((label) => label.startsWith("wayfinder:"))
            .map((label) => label.slice("wayfinder:".length))
            .sort();
        return roles[0] ?? "delivery";
    }
}

export interface Edge {
    readonly source: number;
    readonly target: number;
    readonly kind: "hierarchy" | "blocks";
}

export class IssueGraph {
    readonly root: number;
    readonly issues = new Map<number, Issue>();
    readonly edges: Edge[] = [];
    readonly warnings: string[] = [];

    constructor(root: number) {
        this.root = root;
    }

    addIssue(issue: Issue): void {
        const old = this.issues.get(issue.number);
        if (old && !sameIssue(old, issue)) {
            throw new GraphError(`conflicting data for issue #${issue.number}`);
        }
        this.issues.set(issue.number, issue);
    }

    addEdge(source: number, target: number, kind: Edge["kind"]): void {
        if (!this.edges.some((edge) => edge.source === source && edge.target === target && edge.kind === kind)) {
            this.edges.push({ source, target, kind });
        }
    }

    validate(): void {
        const missing = [...new Set(this.edges.flatMap(({ source, target }) => [source, target]))]
            .filter((number) => !this.issues.has(number))
            .sort((a, b) => a - b);
        if (missing.length) {
            throw new GraphError(
                `relationships reference missing issues: ${missing.map((number) => `#${number}`).join(", ")}`,
            );
        }
        const cycle = findCycle(this.issues.keys(), this.edges
            .filter(({ kind }) => kind === "blocks")
            .map(({ source, target }) => [source, target] as const));
        if (cycle) {
            throw new GraphError(`dependency cycle: ${cycle.map((number) => `#${number}`).join(" -> ")}`);
        }
    }
}

function sameIssue(left: Issue, right: Issue): boolean {
    return left.number === right.number && left.title === right.title && left.url === right.url &&
        left.state === right.state && JSON.stringify(left.labels) === JSON.stringify(right.labels) &&
        JSON.stringify(left.assignees) === JSON.stringify(right.assignees) && left.external === right.external;
}

function findCycle(nodes: Iterable<number>, edges: Iterable<readonly [number, number]>): number[] | undefined {
    const adjacent = new Map<number, number[]>();
    for (const node of nodes) adjacent.set(node, []);
    for (const [source, target] of edges) adjacent.get(source)?.push(target);
    const active: number[] = [];
    const done = new Set<number>();

    const visit = (node: number): number[] | undefined => {
        const activeIndex = active.indexOf(node);
        if (activeIndex !== -1) return [...active.slice(activeIndex), node];
        if (done.has(node)) return undefined;
        active.push(node);
        for (const target of adjacent.get(node) ?? []) {
            const found = visit(target);
            if (found) return found;
        }
        active.pop();
        done.add(node);
        return undefined;
    };

    for (const node of adjacent.keys()) {
        const found = visit(node);
        if (found) return found;
    }
    return undefined;
}

type Run = (args: string[]) => unknown;

export class GitHubAdapter {
    readonly repository: string;
    readonly run: Run;

    constructor(repository: string, run?: Run) {
        this.repository = repository;
        this.run = run ?? GitHubAdapter.runGh;
    }

    private static runGh(args: string[]): unknown {
        try {
            return JSON.parse(execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new GraphError(message || "gh api failed");
        }
    }

    private paged(endpoint: string, fields: string[] = []): IssueData[] {
        const args = ["api", "--method", "GET", "--paginate", "--slurp", endpoint];
        for (const field of fields) args.push("-f", field);
        const pages = this.run(args);
        if (!Array.isArray(pages)) throw new GraphError("unexpected paginated GitHub response");
        return pages.flatMap((page) => Array.isArray(page) ? page as IssueData[] : []);
    }

    discoverMap(): IssueData {
        const matches = this.paged(`repos/${this.repository}/issues`, ["state=open", "labels=wayfinder:map", "per_page=100"])
            .filter((issue) => !issue.pull_request);
        if (matches.length !== 1) {
            const numbers = matches.map(({ number }) => `#${number}`).join(", ") || "none";
            throw new GraphError(`expected one open wayfinder:map issue; found ${matches.length} (${numbers})`);
        }
        return matches[0];
    }

    issue(number: number): IssueData {
        return this.run(["api", `repos/${this.repository}/issues/${number}`]) as IssueData;
    }

    private localIssue(data: IssueData): Issue {
        const repositoryUrl = data.repository_url ?? "";
        if (repositoryUrl && !repositoryUrl.replace(/\/+$/, "").endsWith(`/repos/${this.repository}`)) {
            throw new GraphError(`cross-repository relationship to ${repositoryUrl} is not supported; select a map whose issue relationships stay in one repository`);
        }
        return issueFromData(data);
    }

    subIssues(number: number): IssueData[] {
        return this.paged(`repos/${this.repository}/issues/${number}/sub_issues`, ["per_page=100"]);
    }

    blockers(number: number): IssueData[] {
        return this.paged(`repos/${this.repository}/issues/${number}/dependencies/blocked_by`, ["per_page=100"]);
    }

    build(mapNumber?: number): IssueGraph {
        const rootData = mapNumber === undefined ? this.discoverMap() : this.issue(mapNumber);
        const graph = new IssueGraph(rootData.number);
        const queue = [rootData];
        const descendants = new Set<number>();
        while (queue.length) {
            const data = queue.shift()!;
            graph.addIssue(this.localIssue(data));
            descendants.add(data.number);
            for (const child of this.subIssues(data.number)) {
                graph.addIssue(this.localIssue(child));
                graph.addEdge(data.number, child.number, "hierarchy");
                if (!descendants.has(child.number)) queue.push(child);
            }
        }
        for (const number of descendants) {
            for (const blocker of this.blockers(number)) {
                if (!graph.issues.has(blocker.number)) {
                    const external = new Issue({ ...this.localIssue(blocker), external: true });
                    graph.addIssue(external);
                    graph.warnings.push(`#${number} is blocked by external issue #${blocker.number}, outside map #${graph.root}`);
                }
                graph.addEdge(blocker.number, number, "blocks");
            }
        }
        graph.validate();
        return graph;
    }
}

export function issueFromData(data: IssueData, external = false): Issue {
    try {
        if (data.number === undefined || data.title === undefined || data.html_url === undefined || data.state === undefined) {
            throw new Error("missing required issue field");
        }
        return new Issue({
            number: Number(data.number), title: String(data.title), url: String(data.html_url), state: String(data.state),
            labels: (data.labels ?? []).map((label) => typeof label === "string" ? label : label.name),
            assignees: (data.assignees ?? []).map(({ login }) => login), external,
        });
    } catch (error) {
        throw new GraphError(`incomplete or inaccessible issue response: ${error instanceof Error ? error.message : String(error)}`);
    }
}

export function renderMermaid(graph: IssueGraph): string {
    const blocked = new Set(graph.edges.filter((edge) => edge.kind === "blocks" && graph.issues.get(edge.source)!.state === "open").map(({ target }) => target));
    const lines = ["flowchart LR"];
    for (const number of [...graph.issues.keys()].sort((a, b) => a - b)) {
        const issue = graph.issues.get(number)!;
        const title = issue.title.replaceAll("\\", "\\\\").replaceAll('"', "#quot;").replaceAll("\n", " ");
        const flags = [issue.state, issue.role];
        if (blocked.has(number)) flags.push("blocked");
        if (issue.assignees.length) flags.push("assigned");
        if (issue.external) flags.push("external");
        lines.push(`  i${number}["#${number} ${title}<br/>(${flags.join(", ")})"]`);
        lines.push(`  click i${number} "${issue.url}" "Open issue #${number}"`);
    }
    for (const edge of [...graph.edges].sort(edgeSort)) {
        lines.push(`  i${edge.source} ${edge.kind === "hierarchy" ? "-. sub-issue .->" : "-- blocks -->"} i${edge.target}`);
    }
    const roles = [...new Set([...graph.issues.values()].map((issue) => issue.role))].sort();
    const palette = ["#dbeafe", "#dcfce7", "#fef3c7", "#fce7f3", "#ede9fe", "#e5e7eb", "#cffafe"];
    roles.forEach((role, index) => {
        lines.push(`  classDef role${index} fill:${palette[index % palette.length]},stroke:#475569`);
        lines.push(`  class ${[...graph.issues.values()].filter((issue) => issue.role === role).map((issue) => `i${issue.number}`).join(",")} role${index}`);
    });
    const closed = [...graph.issues.values()].filter((issue) => issue.state === "closed").map((issue) => `i${issue.number}`).join(",");
    if (closed) lines.push("  classDef closed opacity:0.55,stroke-dasharray:4 3", `  class ${closed} closed`);
    return `${lines.join("\n")}\n`;
}

function edgeSort(left: Edge, right: Edge): number {
    return left.kind.localeCompare(right.kind) || left.source - right.source || left.target - right.target;
}

export function renderGraphml(graph: IssueGraph): string {
    const escape = (value: unknown) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
    const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">'];
    for (const key of ["title", "url", "state", "role", "assigned", "external", "kind"]) lines.push(`  <key id="${key}" for="${key === "kind" ? "edge" : "node"}" attr.name="${key}" attr.type="string"/>`);
    lines.push('  <graph id="wayfinder" edgedefault="directed">');
    for (const number of [...graph.issues.keys()].sort((a, b) => a - b)) {
        const issue = graph.issues.get(number)!;
        lines.push(`    <node id="i${number}">`);
        for (const [key, value] of Object.entries({ title: `#${number} ${issue.title}`, url: issue.url, state: issue.state, role: issue.role, assigned: String(Boolean(issue.assignees.length)), external: String(issue.external) })) lines.push(`      <data key="${key}">${escape(value)}</data>`);
        lines.push("    </node>");
    }
    [...graph.edges].sort(edgeSort).forEach((edge, index) => lines.push(`    <edge id="e${index}" source="i${edge.source}" target="i${edge.target}"><data key="kind">${edge.kind}</data></edge>`));
    lines.push("  </graph>", "</graphml>");
    return `${lines.join("\n")}\n`;
}

export function main(argv = process.argv.slice(2)): number {
    let repository: string | undefined;
    let mapNumber: number | undefined;
    let format: "mermaid" | "graphml" = "mermaid";
    let output: string | undefined;
    try {
        for (let index = 0; index < argv.length; index++) {
            const argument = argv[index];
            if (argument === "--repo") repository = argv[++index];
            else if (argument === "--map") mapNumber = Number(argv[++index]);
            else if (argument === "--format") format = argv[++index] as typeof format;
            else if (argument === "--output") output = argv[++index];
            else if (argument === "--help") { console.log("Usage: wayfinder_graph.ts [--repo OWNER/REPO] [--map NUMBER] [--format mermaid|graphml] [--output FILE]"); return 0; }
            else throw new GraphError(`unknown argument: ${argument}`);
        }
        if (format !== "mermaid" && format !== "graphml") throw new GraphError(`invalid format: ${format}`);
        repository ??= execFileSync("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], { encoding: "utf8" }).trim();
        const graph = new GitHubAdapter(repository).build(mapNumber);
        const rendered = format === "mermaid" ? renderMermaid(graph) : renderGraphml(graph);
        if (output) writeFileSync(output, rendered, "utf8"); else process.stdout.write(rendered);
        graph.warnings.forEach((warning) => console.error(`warning: ${warning}`));
        return 0;
    } catch (error) {
        console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
        return 2;
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main();
