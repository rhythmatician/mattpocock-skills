# Maintenance-risk report contract

Emit one JSON object with this shape before the human summary:

```json
{
  "schemaVersion": 1,
  "diagnostic": "maintenance-risk",
  "repository": {
    "root": "absolute path",
    "head": "commit SHA or unknown",
    "stateId": "survey state identifier",
    "dirty": false
  },
  "status": "complete | partial",
  "findings": [
    {
      "id": "stable finding identifier",
      "rank": 1,
      "phase": "temporal-coupling | hotspots | change-amplification | cognitive-complexity | dependency-pathology | dead-architecture",
      "files": ["path/from/repository/root"],
      "metrics": {
        "metricName": "measured value"
      },
      "whyItMayMatter": "maintenance consequence, kept separate from the metric",
      "claimType": "measured-fact | measured-candidate | interpretation",
      "evidenceStrength": {
        "level": 4,
        "basis": "executed"
      },
      "provenance": [
        {
          "analyzer": "git | omen | graphify | focused-probe",
          "command": "command or artifact operation",
          "source": "artifact path, commit, or source location",
          "toolVersion": "version or persisted-artifact"
        }
      ],
      "nonStaticSeamsChecked": ["schema, format, configuration, convention, lifecycle, or external behavior"],
      "nextStep": "one focused investigation or refactoring target"
    }
  ],
  "cleared": [
    {
      "candidate": "what was checked",
      "reason": "why the evidence did not support a finding"
    }
  ],
  "unavailableCapabilities": [
    {
      "phase": "diagnostic phase",
      "reason": "bounded analysis, missing tool, invalid artifact, or failed command"
    }
  ]
}
```

Rules:

- Rank findings by converging evidence and practical maintenance consequence, not one raw score.
- Keep metric values as JSON numbers when the analyzer produced numbers.
- Use repository-relative paths in `files`.
- A finding that combines phases cites every contributing provenance record.
- `interpretation` never inherits a stronger level than the evidence that supports it.
- Omit low-value suspicions instead of padding the list.
- Keep `findings` empty when the evidence supports no important risk.
