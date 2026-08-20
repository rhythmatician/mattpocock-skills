# Adapter Pattern for External Analyzers

When building a skill that uses the shared analysis substrate, write a small adapter that normalizes an external tool's output into the standard evidence format. This keeps tools decoupled from skills and enables reuse across multiple diagnostic skills.

## Philosophy

- **Small adapters.** Adapters are thin layers that normalize output, not full abstraction frameworks.
- **Obvious contracts.** Each adapter has a clear input (raw tool output) and output (normalized evidence).
- **Tool-specific knowledge lives here.** The adapter knows about eslint's JSON format, pytest's output, etc. Skills don't.
- **Evidence survives reinterpretation.** A skill can reinterpret the same evidence for different purposes; the adapter output stays the same.

## Adapter Structure

An adapter is a TypeScript module with a clear contract:

```typescript
// Input: raw output from a tool
type RawToolOutput = string | Buffer | object;

// Output: normalized evidence in standard format
type NormalizedEvidence = AnalysisEvidence;

// Adapter function
export async function adapt(
  rawOutput: RawToolOutput,
  metadata: { tool: string; version: string }
): Promise<NormalizedEvidence>;
```

## Example: ESLint Adapter

```typescript
import { AnalysisEvidence } from '../schema';

/**
 * Normalize ESLint JSON output into standard evidence format.
 * 
 * Takes ESLint's --format=json output and converts it to a skill-agnostic
 * format that any diagnostic skill can interpret for its own purposes.
 */
export interface EslintFinding {
  filePath: string;
  line: number;
  column: number;
  message: string;
  ruleId: string;
  severity: 'error' | 'warning';
  fix?: { range: [number, number]; text: string };
}

export interface NormalizedEslintEvidence {
  totalFiles: number;
  filesWithIssues: number;
  totalIssues: number;
  errorCount: number;
  warningCount: number;
  issues: EslintFinding[];
  rules: {
    ruleId: string;
    severity: string;
    occurrences: number;
  }[];
}

export async function adaptEslintOutput(
  jsonOutput: string,
  toolVersion: string
): Promise<AnalysisEvidence> {
  let parsed: any[];
  
  try {
    parsed = JSON.parse(jsonOutput);
  } catch (e) {
    throw new Error(`Failed to parse ESLint JSON output: ${e}`);
  }

  // Normalize to our evidence schema
  let totalFiles = 0;
  let filesWithIssues = 0;
  let totalIssues = 0;
  let errorCount = 0;
  let warningCount = 0;
  const allIssues: EslintFinding[] = [];
  const ruleMap = new Map<string, { occurrences: number; severity: string }>();

  for (const result of parsed) {
    totalFiles++;
    if (result.messages.length > 0) {
      filesWithIssues++;
    }

    for (const message of result.messages) {
      totalIssues++;
      if (message.severity === 2) errorCount++;
      if (message.severity === 1) warningCount++;

      allIssues.push({
        filePath: result.filePath,
        line: message.line,
        column: message.column,
        message: message.message,
        ruleId: message.ruleId || 'unknown',
        severity: message.severity === 2 ? 'error' : 'warning',
        fix: message.fix,
      });

      // Aggregate by rule
      const existing = ruleMap.get(message.ruleId) || { occurrences: 0, severity: '' };
      existing.occurrences++;
      existing.severity = message.severity === 2 ? 'error' : existing.severity;
      ruleMap.set(message.ruleId, existing);
    }
  }

  const normalized: NormalizedEslintEvidence = {
    totalFiles,
    filesWithIssues,
    totalIssues,
    errorCount,
    warningCount,
    issues: allIssues,
    rules: Array.from(ruleMap.entries()).map(([ruleId, data]) => ({
      ruleId,
      severity: data.severity === 2 ? 'error' : 'warning',
      occurrences: data.occurrences,
    })),
  };

  return {
    analyzerId: 'eslint',
    timestamp: new Date().toISOString(),
    sourceTools: { eslint: toolVersion },
    data: normalized,
  };
}
```

## How Skills Use Adapters

A skill using this adapter:

```typescript
import { Repository, Executor, CliDiscovery } from 'shared/repository-analysis';
import { adaptEslintOutput } from './eslint-adapter';

export async function analyzeWithEslint(repoPath: string) {
  const repo = await Repository.discover(repoPath);
  const executor = new Executor(repo.rootPath);
  const cli = new CliDiscovery(repo.rootPath);

  // Check health first
  const eslintHealth = await executor.checkHealth('eslint');
  if (!eslintHealth.available) {
    return { error: 'ESLint not available' };
  }

  // Run analysis
  const result = await executor.run('eslint', ['.', '--format=json'], {
    timeout: 30000,
  });

  if (result.exitCode !== 0 && result.exitCode !== 1) {
    // eslint exits with 1 if issues found, 0 if clean
    return { error: `ESLint failed: ${result.stderr}` };
  }

  // Normalize through adapter
  const evidence = await adaptEslintOutput(result.stdout, eslintHealth.version!);

  // Skill-specific interpretation (maintenance-risk, quality-gates, etc.)
  const interpretation = interpretForMaintenanceRisk(evidence);
  
  return interpretation;
}
```

## Key Patterns

### 1. Handle Multiple Output Formats

Some tools support multiple output formats. Provide adapters for the most useful ones:

```typescript
export async function adaptEslintOutput(
  output: string,
  format: 'json' | 'compact' | 'stylish',
  version: string
): Promise<AnalysisEvidence> {
  switch (format) {
    case 'json':
      return adaptEslintJson(output, version);
    case 'compact':
      return adaptEslintCompact(output, version);
    default:
      return adaptEslintStylish(output, version);
  }
}
```

### 2. Graceful Degradation for Partial Output

If a tool partially succeeds, capture what you can:

```typescript
export async function adaptPytestOutput(
  output: string,
  version: string
): Promise<AnalysisEvidence> {
  const lines = output.split('\n');
  const tests: TestResult[] = [];
  let parseErrors = 0;

  for (const line of lines) {
    try {
      // Parse test results from pytest output
      const result = parseTestLine(line);
      if (result) tests.push(result);
    } catch (e) {
      parseErrors++;
    }
  }

  return {
    analyzerId: 'pytest',
    timestamp: new Date().toISOString(),
    sourceTools: { pytest: version },
    data: {
      tests,
      totalTests: tests.length,
      passedTests: tests.filter(t => t.status === 'passed').length,
      failedTests: tests.filter(t => t.status === 'failed').length,
    },
    partialReason: parseErrors > 0 ? `${parseErrors} test results could not be parsed` : undefined,
  };
}
```

### 3. Preserve Tool-Specific Details

Include raw/detailed output so consumers can drill down if needed:

```typescript
return {
  analyzerId: 'cargo-build',
  timestamp: new Date().toISOString(),
  sourceTools: { cargo: version },
  data: {
    summary: {
      passed: results.filter(r => r.status === 'pass').length,
      failed: results.filter(r => r.status === 'fail').length,
    },
    // Preserve raw results for drill-down
    rawResults: parsed,
    // And stderr in case there are warnings
    warnings: stderr,
  },
};
```

## Testing Adapters

Test adapters with real tool output:

```typescript
import { adaptEslintOutput } from '../adapters/eslint';

describe('ESLint adapter', () => {
  it('normalizes eslint JSON output', async () => {
    const eslintOutput = `
      [
        {
          "filePath": "src/index.ts",
          "messages": [
            {
              "ruleId": "no-unused-vars",
              "severity": 2,
              "message": "Unused variable 'x'",
              "line": 5,
              "column": 1
            }
          ],
          "errorCount": 1,
          "warningCount": 0,
          "fixableErrorCount": 0,
          "fixableWarningCount": 0,
          "source": "const x = 1;"
        }
      ]
    `;

    const evidence = await adaptEslintOutput(eslintOutput, '8.40.0');

    expect(evidence.analyzerId).toBe('eslint');
    expect(evidence.data.totalIssues).toBe(1);
    expect(evidence.data.errorCount).toBe(1);
    expect(evidence.data.issues[0].ruleId).toBe('no-unused-vars');
  });
});
```

## When to Add a New Adapter

Add an adapter when:
1. A diagnostic skill needs to integrate with an external tool
2. The tool has distinct output formats (JSON, text, binary)
3. Multiple skills might use the same tool
4. The tool's format might change between versions

Don't add:
- Framework-specific helpers (those belong in the skill)
- Decision-making logic (that's skill-specific interpretation)
- Multi-tool orchestration (that's the executor's job)

## Migration Path

When a tool or its output format changes:
1. Create a new adapter version: `adaptEslintOutput_v2`
2. Update the substrate version
3. Old adapters stay available for backward compatibility
4. Skills gradually migrate to the new adapter
5. Cache keys automatically invalidate due to version mismatch

This keeps the analysis substrate stable while tools evolve around it.
