# Analysis Budgets: Quick, Standard, Deep

The shared analysis substrate supports bounded execution depth so diagnostic skills can control analysis scope and timing.

## Budget Modes

Each analysis declares which budget it runs under. This bounds cost and ensures predictable performance.

### Quick (0-30 seconds)

Shallow analysis for immediate feedback:
- Run only the fastest checks
- Analyze only changed files or recent commits
- Skip expensive network/subprocess operations
- Return partial results rather than waiting for completeness

**Use when:**
- User wants immediate feedback while working
- Running in CI/CD before expensive jobs
- Pre-flight validation in pre-commit hooks
- Checking a small subset of the codebase

**Example:**

```typescript
const result = await executor.run('eslint', [changedFiles.join(' ')], {
  timeout: 20000,
  budget: 'quick',
});
```

### Standard (30 seconds - 5 minutes)

Balanced depth for normal use:
- Analyze full codebase
- Run all declared checks
- Collect hotspots and trends
- Generate full reports

**Use when:**
- Regular development workflow
- Post-commit hooks
- Pull request validation
- Default for all diagnostic skills

**Example:**

```typescript
const result = await executor.run('eslint', ['.'], {
  timeout: 180000,
  budget: 'standard',
});
```

### Deep (5-30 minutes)

Exhaustive analysis for thorough review:
- Include historical analysis (full git log)
- Run mutation testing or property-based checks
- Perform cross-repository analysis
- Build complete dependency graphs
- Generate detailed trend/pattern reports

**Use when:**
- Pre-release audits
- Major refactoring decisions
- Architectural reviews
- Onboarding to new repositories
- Quarterly health checks

**Example:**

```typescript
const analysis = await historyAnalyzer.analyze({
  maxCommits: 10000,
  budget: 'deep',
});
```

## Implementing Budget-Aware Code

### 1. Skip Expensive Work in Quick Mode

```typescript
export async function analyzeRepository(
  repo: Repository,
  budget: 'quick' | 'standard' | 'deep'
) {
  // Always run core analysis
  const coreResults = await runCoreAnalysis(repo);

  // Skip expensive parts in quick mode
  if (budget !== 'quick') {
    const historicalAnalysis = await analyzeHistory(repo);
    const trendAnalysis = await analyzeTrends(repo);
    return { ...coreResults, historicalAnalysis, trendAnalysis };
  }

  return coreResults;
}
```

### 2. Limit Scope by Budget

```typescript
export async function analyzeHistory(
  repo: Repository,
  budget: 'quick' | 'standard' | 'deep'
) {
  const maxCommits = budget === 'quick' ? 50 : budget === 'standard' ? 500 : 5000;
  
  return historyAnalyzer.analyze({
    maxCommits,
  });
}
```

### 3. Adjust Timeout by Budget

```typescript
export function getTimeoutMs(budget: 'quick' | 'standard' | 'deep'): number {
  switch (budget) {
    case 'quick':
      return 20000; // 20 seconds
    case 'standard':
      return 180000; // 3 minutes
    case 'deep':
      return 1200000; // 20 minutes
  }
}
```

## Budget Contract

When a skill declares it supports a budget, it commits to:

| Budget   | Max Time | Max Files | Max Commits | Scope |
|----------|----------|-----------|------------|-------|
| Quick    | 30s      | Changed   | 100        | Current |
| Standard | 3min     | All       | 1000       | All |
| Deep     | 20min    | All       | Unlimited  | Historical + Deep |

For example, `maintenance-risk` might say:

> Supports all budgets. Quick mode analyzes recent changes and reports on hotspots. Standard mode includes full codebase and recent history. Deep mode includes 10 years of git history and fine-grained trend analysis.

## Communicating Budget to Users

Always tell users what budget you're using and what that means:

```typescript
function describeAnalysis(budget: 'quick' | 'standard' | 'deep'): string {
  switch (budget) {
    case 'quick':
      return `Quick analysis (~20s): Recent changes only. Use for instant feedback.`;
    case 'standard':
      return `Standard analysis (~3min): Full codebase. Use for normal workflow.`;
    case 'deep':
      return `Deep analysis (~15min): Full history & trends. Use for audits/reviews.`;
  }
}
```

## Selecting Budget Programmatically

Let consumers declare which budget they want:

```typescript
// In CLI or config
await analyzeRepository(repo, 'standard');

// In issue/comment
// @diagnostic-skill analyze:quick
// (user wants fast feedback)

// In CI
// Standard budget for PRs, deep for nightly
const budget = process.env.CI_JOB_STAGE === 'nightly' ? 'deep' : 'standard';
```

## Budget and Caching

Cache keys include the budget, so:
- `quick` results don't mask `standard` results
- Each budget has its own cache entry
- Stale quick results don't prevent fresh standard runs
- Deep analysis can build on standard cache

```typescript
const key = cache.generateKey('eslint', 'standard', toolVersions, commitSha);
// Different budget = different cache entry
const deepKey = cache.generateKey('eslint', 'deep', toolVersions, commitSha);
```

## Progressive Depth

Some skills might use progressive depth: start with quick, fetch standard if user wants more detail:

```typescript
// Initial request
const quickAnalysis = await analyze(repo, 'quick');
console.log(quickAnalysis.summary);

// User asks for details
const fullAnalysis = await analyze(repo, 'standard');
console.log(fullAnalysis.detailed);

// User wants historical trends
const deepAnalysis = await analyze(repo, 'deep');
console.log(deepAnalysis.trends);
```

## Error Handling by Budget

Different budgets handle failures differently:

```typescript
try {
  return await runAnalysis(repo, budget);
} catch (error) {
  if (budget === 'quick') {
    // Quick mode: fail fast, let user retry with standard
    throw error;
  } else {
    // Standard/deep: return partial results rather than failing completely
    return partialSuccess([completed], [failed]);
  }
}
```

## Examples by Skill

### maintenance-risk

- **Quick:** Hotspots in recent commits, top contributors
- **Standard:** 1-year risk timeline, volatility patterns
- **Deep:** Full history, risk trends, contributor expertise maps

### test-suite-health

- **Quick:** Recent test performance
- **Standard:** Full test coverage, failure rate
- **Deep:** Historical coverage trends, slowest tests, mutation analysis

### knowledge-hygiene

- **Quick:** Doc staleness in changed files
- **Standard:** Full doc/code alignment audit
- **Deep:** Multi-year documentation decay patterns, cross-repo knowledge consistency

### feedback-loop-health

- **Quick:** Current CI/deployment times
- **Standard:** 3-month feedback time trends
- **Deep:** 1-year deployment patterns, root cause analysis

## Documenting Budget Support

In your skill's README or issue template:

```markdown
## Analysis Budgets

This skill supports all budgets:

- **Quick** (~30s): Analyzes recent changes for immediate feedback
- **Standard** (~3min): Full codebase analysis. Recommended for normal workflow
- **Deep** (~15min): Includes 1-year history and trend analysis

Request a specific budget with `budget=quick` or let the skill choose based on context.
```

---

Budget-aware analysis ensures skills remain responsive while supporting thorough audits when needed.
