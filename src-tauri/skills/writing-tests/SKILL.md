---
name: writing-tests
description: How to write useful automated tests (unit, integration, regression) and run them. Use when asked to add tests, fix a bug (write a failing test first), raise coverage, or when the project has a test suite next to the code you change.
---

# Writing tests

## Find the existing setup first
- Look for the test runner and conventions already used: `package.json` scripts (`vitest`, `jest`, `playwright`), `pytest.ini` or `pyproject.toml`, `cargo test` modules, `*_test.go`.
- Copy the style of an existing test file next to the code: same folder layout, naming, helpers, fixtures. Do not introduce a new framework.

## What to test
- Behaviour, not implementation: inputs to observable outputs and effects.
- For each unit: the main happy path, boundaries (0, 1, empty, max length, unicode), invalid input, and error handling.
- Bug fix: first write a test that reproduces the bug and fails, then fix the code, then see it pass.
- Security-relevant code: test that bad input is rejected (path traversal `../`, oversized input, missing auth).

## How to write them
- One behaviour per test, with a name that says it: `returns 404 when the user does not own the note`.
- Arrange, Act, Assert. Keep fixtures small and inline when possible.
- Deterministic: no real network, no sleeping, no dependence on the current time or random order. Fake time and inject randomness.
- Clean up temp files and state. Tests must pass when run alone and in any order.
- Assert specific values, not just "truthy" or "no exception".

## Run them
- Run only the affected tests first (fast feedback), then the whole suite.
- Read failures fully. A failing test is information: fix the code or, if the test was wrong, explain why you changed the test.
- Report the exact command you ran and the result. Never claim tests pass without running them.
