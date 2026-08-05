---
name: tdd
description: Build new Python behavior test-first with pytest. Use for explicit TDD or BDD requests, new features, or protecting established behavior; reported bugs and regressions belong to diagnosing-bugs.
---

# Behavior-first TDD/BDD

Use this skill as workflow owner for new behavior or explicit test-first work. For a reported failure or regression, `diagnosing-bugs` owns diagnosis and repair and may apply these testing principles internally.

This skill is a reference for writing tests that increase confidence in business-relevant behavior. The loop is still red → green → refactor, but the first question is not "how do I test this function?" It is "what behavior matters to the user or downstream caller?"

When exploring the codebase, read `CONTEXT.md` (if it exists) so test names and interface vocabulary match the project's domain language, and respect ADRs in the area you're touching.

## Start with behavior, not methods

Before writing a test, identify:

- the user or consumer need,
- the behavior that matters,
- the seam where that behavior can be observed.

A behavior is often broader than a single method. It may span several functions, services, or layers. Choose the seam that exposes the behavior without reaching into internals.

See [tests.md](tests.md) for examples and [mocking.md](mocking.md) for mocking guidance.

## What a good test is

A good test:

- protects a business rule or observable outcome,
- uses a public seam or realistic interface,
- survives refactors because it checks behavior, not implementation,
- reads like a specification in plain language.

Examples:

- "user can register and later retrieve their account"
- "duplicate email is rejected"
- "refund is not issued when payment fails"

## Seams — where tests go

A **seam** is the boundary where behavior becomes observable. Tests live at seams, not inside the implementation.

Before writing a test, confirm:

- which seam will be exercised,
- what the caller can observe,
- whether the test is checking user-visible behavior.

Avoid writing tests against private methods, module internals, or side channels.

## Testing pain is architecture feedback

If a test is hard to write, hard to isolate, or needs lots of mocks, monkeypatches, sleeps, or a real database just to exercise a small rule, that is often a signal that the code has mixed concerns or hidden dependencies.

Common smells:

- too many mocks or patching tricks for a simple outcome
- hidden state such as time, randomness, environment variables, or a live database
- one function trying to handle transport, domain logic, and infrastructure at once
- tests that only pass if the system is arranged in a very specific order

When this happens, prefer to:

- separate the concern into a clearer service or domain layer,
- make dependencies explicit,
- move the boundary closer to the user-visible behavior.

A useful dependency gradient is:

- easiest to test: pure functions and explicit parameters
- moderate: injected collaborators and in-memory fakes
- hardest: globals, environment lookups, live databases, and hidden side effects

## Anti-patterns

- **Implementation-coupled** — asserts on internal calls, tests private methods, or verifies through a side channel instead of the public behavior. The tell: the test breaks when you refactor but the user-visible behavior has not changed.
- **Tautological** — the assertion recomputes the expected value the same way the code does (`assert calculate_total(items) == sum(...)`), so it passes by construction and can never disagree with the implementation.
- **Horizontal slicing** — writing a large batch of tests before understanding the behavior. Work in **vertical slices** instead: one behavior, one test, one minimal implementation change at a time.
- **Ceremony-first BDD** — turning every test into Gherkin or a formal DSL when the real value is simply naming and protecting the behavior clearly. BDD is a mindset, not a syntax requirement.

## Rules of the loop

- **Discover the behavior first.** Name the outcome in plain language before you write the assertion.
- **Red before green.** Write the failing test first, then only enough code to make it pass.
- **One slice at a time.** One behavior, one seam, one small implementation step.
- **Refactor after the behavior is protected.** Do not refactor while the test is still unclear or incomplete.
