---
name: debugging
description: Systematic debugging - reproduce, read the error, form hypotheses, isolate, fix the root cause, add a regression test. Use when something is broken, crashes, throws an error, fails a test, shows wrong output, or the user says it does not work.
---

# Debugging

Do not guess-and-patch. Find the cause, then fix it.

1. **Reproduce.** Get the exact steps, input and environment. Run it yourself (terminal, test, browser) and see the failure. If you cannot reproduce it, gather more data instead of changing code.
2. **Read the whole error.** Message, error type, stack trace, file and line. The first error in the log is usually the real one; later ones are often consequences. For a UI, read the browser console and network responses.
3. **Locate.** Open the code at the reported line and follow the data backwards: where does the bad value come from? Check recent changes to that area.
4. **Hypothesize and test.** Write down one to three possible causes. Test the most likely one with the cheapest experiment: a log line, a minimal input, comparing with a working version (`git diff`). Remove temporary logs afterwards.
5. **Fix the root cause**, not the symptom. Do not swallow errors with an empty `catch`, do not add `?.` or `as any` just to silence the problem, do not widen types to hide it.
6. **Prove the fix.** Re-run the reproduction. Add a regression test that failed before and passes now. Run the neighbouring tests.
7. **Explain** in two or three sentences: what was wrong, why, and what changed.

Common causes to check: wrong path or working directory, missing env var or config, async race or missing `await`, stale cache or build, off-by-one, null or undefined, wrong type at a boundary (string vs number, JSON parsing), mismatched versions, permissions, encoding (UTF-8, CRLF).
