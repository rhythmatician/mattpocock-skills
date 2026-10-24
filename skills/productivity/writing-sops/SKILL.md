---
name: writing-sops
description: Create or revise practical standard operating procedures for staff, including software operation, office processes, and handoffs. Use when documenting a repeatable task or updating an SOP after a workflow changes.
---

# Writing SOPs

Write a procedure the intended employee can follow during real work. Choose topics and detail by what helps that person complete the task, recognize an exception, and verify the result.

For JGI work, read [references/jgi.md](references/jgi.md) before choosing scope or examples. It defines the local boundary between SOPs and calibration Work Procedures.

## Establish the task

Identify the reader, the event that starts the task, and the result that means it is finished. Reuse the conversation and available materials before asking questions.

Read existing instructions, forms, screenshots, and relevant application documentation. For software, establish which released workflow the reader actually uses. Code and planned features can explain intent, but instructions need evidence of the operator's current experience.

Ask focused questions about missing decisions, exceptions, and handoffs. Confirm consequential gaps rather than inventing button names, business rules, contacts, or recovery actions. Keep unresolved questions beside the draft for the requester; do not bury guesses in executable steps.

This stage is complete when the normal path and important exceptions are understood well enough to draft, with remaining gaps identified.

## Draft for use at the workstation

Honor the requested format and destination. Reuse a useful existing layout; otherwise start with this outline and omit sections that add no value.

```markdown
# [Task name]

[Who this is for, when to use it, and what it accomplishes.]

## Before you start

[Required access, equipment, documents, and identifying information.]

## Do the task

1. [Action using the labels or terms the reader sees.]
   [Expected result or check where it matters.]
2. [Next action.]
   [Decision or handoff at the point it arises.]

## Check that you are finished

[Observable evidence that the work succeeded, including any handoff.]

## If something goes wrong

| What you see | What to do next |
| --- | --- |
| [Recognizable symptom] | [Supported recovery, or where to get help] |
```

- Give each step one main action. Put checks and warnings beside the action they affect.
- Use the reader's vocabulary and exact visible labels. Include screenshots when they resolve ambiguity; prefer labels over colors or screen coordinates.
- Explain branches where they occur. Make record identity, responsibility changes, and completion checks explicit where a mistake would affect another job or person.
- Cover exceptions suggested by the real workflow. For tasks with external effects, distinguish failed, partly completed, and uncertain outcomes before recommending a retry.
- Keep implementation details out of staff instructions unless the reader needs them to act. Troubleshooting should start with what the reader sees.
- Add a quick checklist only when it helps repeat users, and keep it consistent with the full instructions.
- Use dates, software versions, or a maintenance contact when they help someone recognize stale guidance. Formal approvals, document numbers, revision tables, and audit language belong only where the user or an applicable process requires them.

## Check usefulness and deliver

Walk through the normal path and relevant exceptions against the supplied evidence. Check that instructions cover starting, choosing the correct job or record, completing the work, and recognizing success or a need for help.

When a walkthrough by an intended reader is available, use their hesitations and questions to revise the draft. Otherwise deliver the draft with the specific checks still needed; do not claim a staff walkthrough occurred. Testing a procedure does not itself authorize purchases, uploads, or business-record changes.

Keep proposed process improvements separate from instructions for current practice. When updating an SOP, check affected screenshots, branches, and any summary checklist together.

Deliver the procedure and a brief account of remaining questions or verification limits. Success means the reader can complete the task and handle the covered exceptions without relying on unwritten explanations.
