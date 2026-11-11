---
name: verify-before-done
description: Final quality gate before saying a coding task is finished. Use at the end of every task that changed code — re-read the diff, build, type-check, run tests, check edge cases, report honestly.
---

# Verify before done

Never say "done" on hope. Before your final answer, walk this list. Skip a step only if it truly cannot apply, and say which one you skipped and why.

## 1. Re-read what you changed
- Open every file you edited and read the changed region again, top to bottom.
- Look for: leftover debug output, commented-out code, `TODO`/placeholder bodies, duplicated blocks, broken indentation, unused imports and variables.
- Make sure every new function is actually called and every renamed symbol is updated at all call sites (search for the old name).

## 2. Prove it compiles
- Run the project's own commands (look in `package.json` scripts, `Cargo.toml`, `Makefile`, `pyproject.toml`): build, type-check (`tsc --noEmit`, `cargo check`, `mypy`), lint.
- Read the error output fully. Fix the first error first, then re-run.

## 3. Prove it works
- Run the relevant tests. If there are none for this code, add a small one or exercise the behaviour directly (run the CLI, open the page in the browser, call the endpoint).
- Try the unhappy paths: empty input, very long input, missing file, network failure, no permission, double click or repeated call.

## 4. Check you did what was asked
- Re-read the user's request. Is every requirement covered? Nothing extra and risky added?
- Did you keep the existing style, naming and structure of the project?
- Security quick check: no secrets in code, user input validated, no string-built SQL, shell or HTML.

## 5. Report honestly
- Say what you changed (files), how you verified it (commands and results), and what is NOT verified or still open.
- If a check failed and you could not fix it, say so plainly with the error. Never claim a test passed that you did not run.
