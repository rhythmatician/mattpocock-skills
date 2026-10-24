# SOP Writer - Standard Operating Procedure Generator

## Overview

Documents "how we do things" so processes don't live in one person's head. If someone is on vacation and work stops, you need an SOP.

---

## 1. When to Apply

| Trigger | Behavior |
|---------|----------|
| Repetitive task needs documenting | Full SOP creation |
| "SOP", "process document" | Interactive SOP builder |
| New team member asks "how do I..." | SOP generation prompt |

---

## 2. SOP Template

```markdown
# SOP: [Process Name]

| Field | Value |
|-------|-------|
| **Version** | 1.0 |
| **Last Updated** | YYYY-MM-DD |
| **Owner** | [Name/Role] |
| **Frequency** | [Daily/Weekly/Monthly/As needed] |
| **Estimated Time** | [N] minutes |

---

## Purpose
[1-2 sentences: why this process exists and what it achieves]

## Scope
- **Applies to**: [Who performs this]
- **When**: [What triggers this process]
- **Not covered**: [What this SOP doesn't address]

## Prerequisites
- [ ] [Access/tool/permission needed]
- [ ] [Knowledge/training required]

---

## Procedure

### Step 1: [Action Name]
**Who**: [Role]
**How**:
1. [Specific action with exact details]
2. [Include screenshots/links where helpful]
3. [Include expected result]

> ⚠️ **Caution**: [Common mistake to avoid]

### Step 2: [Action Name]
**Who**: [Role]
**How**:
1. [Specific action]
2. [Specific action]

**Decision Point:**
- If [condition A] → Go to Step 3
- If [condition B] → Go to Step 4
- If [unclear] → Escalate to [person/role]

### Step 3: [Action Name]
...

---

## Checklist Summary
- [ ] Step 1: [Brief description]
- [ ] Step 2: [Brief description]
- [ ] Step 3: [Brief description]
- [ ] Final verification: [What to check]

## Troubleshooting

| Problem | Likely Cause | Solution |
|---------|-------------|----------|
| [Problem 1] | [Cause] | [Fix] |
| [Problem 2] | [Cause] | [Fix] |

## Escalation
- **Level 1**: [Person/Role] — [contact method]
- **Level 2**: [Person/Role] — [contact method]

## Revision History
| Date | Version | Change | Author |
|------|---------|--------|--------|
| YYYY-MM-DD | 1.0 | Initial creation | [Name] |
```

---

## 3. Common Startup SOPs

| SOP | Frequency | Priority |
|-----|-----------|----------|
| **Production deployment** | Per release | ★★★ |
| **Incident response** | As needed | ★★★ |
| **Customer onboarding** | Per customer | ★★★ |
| **Bug triage** | Daily | ★★☆ |
| **Sprint ceremonies** | Bi-weekly | ★★☆ |
| **Expense reporting** | Monthly | ★☆☆ |
| **New vendor setup** | As needed | ★☆☆ |

---

## 4. Writing Tips

1. **Write for the new hire**: Assume zero context
2. **Be specific**: "Click the blue Submit button" not "Submit the form"
3. **One action per step**: Don't combine multiple actions
4. **Include decision points**: What if something goes wrong?
5. **Add screenshots**: For complex UIs or dashboards
6. **Test it**: Have someone else follow it without help

---

## 5. Tool Coordination

| Tool | Purpose |
|------|---------|
| **Write** | Generate SOP documents |
| **Read** | Reference existing processes |

---

## 6. Boundaries

**Will:**
- Generate structured SOP documents with checklists
- Include troubleshooting and escalation sections
- Provide templates for common startup processes
- Follow consistent formatting across SOPs

**Will Not:**
- Observe actual processes (you describe, AI documents)
- Automate the processes themselves
- Replace training (SOPs supplement, not replace)
- Guarantee process compliance
