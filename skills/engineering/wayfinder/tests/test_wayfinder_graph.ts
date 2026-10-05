import assert from "node:assert/strict";
import test from "node:test";
import { GitHubAdapter, GraphError, IssueData, issueFromData, renderGraphml, renderMermaid } from "../scripts/wayfinder_graph.ts";

function issue(number: number, title: string, state = "open", labels: string[] = [], assignees: string[] = []): IssueData {
    return {
        number,
        title,
        state,
        html_url: `https://github.com/acme/repo/issues/${number}`,
        labels: labels.map((name) => ({ name })),
        assignees: assignees.map((login) => ({ login })),
    };
}

class FixtureAdapter extends GitHubAdapter {
    constructor(
        private readonly issuesFixture: Record<number, IssueData>,
        private readonly childrenFixture: Record<number, number[]>,
        private readonly blockersFixture: Record<number, number[]>,
    ) {
        super("acme/repo");
    }

    override discoverMap(): IssueData {
        const maps = Object.values(this.issuesFixture).filter((candidate) => candidate.state === "open" && candidate.labels?.some((label) => (typeof label === "string" ? label : label.name) === "wayfinder:map"));
        if (maps.length !== 1) throw new GraphError(`expected one open wayfinder:map issue; found ${maps.length}`);
        return maps[0];
    }

    override issue(number: number): IssueData { return this.issuesFixture[number]; }
    override subIssues(number: number): IssueData[] { return (this.childrenFixture[number] ?? []).map((child) => this.issuesFixture[child]); }
    override blockers(number: number): IssueData[] { return (this.blockersFixture[number] ?? []).map((blocker) => this.issuesFixture[blocker]); }
}

function fixture(): FixtureAdapter {
    const issues = {
        1: issue(1, "Map", "open", ["wayfinder:map"]),
        2: issue(2, 'Research [API] & "shape"', "open", ["wayfinder:research"]),
        3: issue(3, "Choose route", "open", ["wayfinder:grilling"], ["dev"]),
        4: issue(4, "Prototype", "closed", ["wayfinder:prototype"]),
        5: issue(5, "Delivery issue"),
        99: issue(99, "External prerequisite"),
    };
    return new FixtureAdapter(issues, { 1: [2, 3, 5], 3: [4] }, { 3: [2], 4: [2, 3], 5: [99] });
}

test("builds and renders a graph from native relationships", () => {
    const graph = fixture().build();
    assert.equal(graph.root, 1);
    assert.ok(graph.edges.some((edge) => edge.source === 1 && edge.target === 5 && edge.kind === "hierarchy"));
    assert.ok(graph.edges.some((edge) => edge.source === 2 && edge.target === 3 && edge.kind === "blocks"));
    assert.ok(graph.edges.some((edge) => edge.source === 3 && edge.target === 4 && edge.kind === "blocks"));
    assert.equal(graph.issues.get(99)?.external, true);
    const mermaid = renderMermaid(graph);
    assert.match(mermaid, /#2 Research \[API\] & #quot;shape#quot;/);
    assert.match(mermaid, /click i2 "https:\/\/github\.com\/acme\/repo\/issues\/2"/);
    assert.match(mermaid, /i1 -. sub-issue .-> i2/);
    assert.match(mermaid, /i2 -- blocks --> i3/);
    assert.match(mermaid, /closed, prototype/);
    const graphml = renderGraphml(graph);
    assert.match(graphml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    assert.match(graphml, /<graphml[\s\S]*<\/graphml>\s*$/);
});

test("rejects dependency cycles", () => {
    const adapter = fixture();
    (adapter as unknown as { blockersFixture: Record<number, number[]> }).blockersFixture[2] = [4];
    assert.throws(() => adapter.build(), /dependency cycle: #2 -> #3 -> #4 -> #2/);
});

test("rejects multiple maps", () => {
    const adapter = fixture();
    (adapter as unknown as { issuesFixture: Record<number, IssueData> }).issuesFixture[6] = issue(6, "Other", "open", ["wayfinder:map"]);
    assert.throws(() => adapter.build(), /expected one open/);
});

test("reports incomplete issue responses", () => {
    assert.throws(() => issueFromData({ number: 7 } as IssueData), /incomplete or inaccessible/);
});

test("rejects cross-repository relationships", () => {
    const adapter = fixture();
    (adapter as unknown as { issuesFixture: Record<number, IssueData> }).issuesFixture[99].repository_url = "https://api.github.com/repos/other/repo";
    assert.throws(() => adapter.build(), /cross-repository relationship/);
});

test("uses paginated native GitHub endpoints", () => {
    const responses: Record<string, unknown> = {
        "repos/acme/repo/issues": [[issue(1, "Map", "open", ["wayfinder:map"])]],
        "repos/acme/repo/issues/1/sub_issues": [[issue(2, "Child")]],
        "repos/acme/repo/issues/2/sub_issues": [[]],
        "repos/acme/repo/issues/1/dependencies/blocked_by": [[]],
        "repos/acme/repo/issues/2/dependencies/blocked_by": [[]],
    };
    const calls: string[][] = [];
    const graph = new GitHubAdapter("acme/repo", (args) => {
        calls.push(args);
        return responses[args[5]];
    }).build();
    assert.deepEqual([...graph.issues.keys()].sort((a, b) => a - b), [1, 2]);
    assert.ok(calls.every((call) => call.includes("--paginate") && call.includes("--slurp")));
    assert.ok(calls.some((call) => call[5] === "repos/acme/repo/issues/2/dependencies/blocked_by"));
});

