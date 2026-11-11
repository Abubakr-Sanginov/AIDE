---
name: careful-code-changes
description: Discipline for editing an existing codebase safely - read before writing, small focused diffs, follow project conventions, no placeholders or invented APIs. Use for any feature, fix or refactor in an existing project.
---

# Careful code changes

## Before editing
- Read the files you will change and their direct callers. Do not edit a file you have not read.
- Find how the project already solves similar problems (search for a similar component, endpoint or util) and follow that pattern.
- Check the real names: functions, props, types, config keys, package names. Never guess an API — open the definition or the package docs. Do not add a dependency that is not installed unless the user asked; if you must, verify the package name exists.
- If the request is ambiguous, pick the safest reasonable interpretation and say it in one line, or ask.

## While editing
- Make the smallest change that fully solves the task. Do not reformat or rename unrelated code.
- Match the existing style: naming, file layout, quotes, imports, error handling, the language of comments and UI strings.
- Write complete code. No `// ... rest of code`, no `TODO: implement`, no stub returning fake data, unless the user asked for a sketch.
- Handle errors and edge cases explicitly: empty lists, null or undefined, failed requests, loading state.
- Keep functions short and names descriptive. Remove code you made obsolete; do not leave dead code or duplicates.
- When editing with search and replace, include enough surrounding lines to match exactly one place.

## After editing
- Search for every usage of anything you renamed or whose signature you changed.
- Build, type-check and run tests (see the verify-before-done skill) and fix what you broke.
- Summarize which files changed and why, in a few lines.
