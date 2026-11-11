---
name: secure-coding
description: Secure-by-default coding rules (OWASP-style). Use when writing or reviewing code that handles auth, passwords, sessions, user input, SQL, shell commands, file paths, uploads, HTML output, secrets, API keys, CORS or outbound requests.
---

# Secure coding

Apply these by default, without being asked. If a request conflicts with security, do the secure thing and explain the risk in one line.

## Input and injection
- All external input is untrusted: request bodies, params, headers, cookies, files, third-party API responses, LLM output.
- Validate on the server: type, length, range, format; prefer allowlists.
- SQL/NoSQL: parameterized queries or an ORM. Never concatenate or format user data into a query.
- OS commands: no shell. Use argument arrays (`execFile`/`spawn`, `subprocess.run([...])`, `Command::new(..).arg(..)`).
- HTML: use `textContent` or framework escaping. Never put user data into `innerHTML`, `dangerouslySetInnerHTML`, `eval`, `new Function`.
- File paths: normalize, then check the result stays inside the allowed base directory. Reject `..` and absolute paths coming from users.
- Deserialization: JSON or `yaml.safe_load`; never `pickle`, `unserialize` or `yaml.load` on untrusted data.

## Auth and access
- Check authorization on the server for every request; deny by default.
- Take the user or owner id from the session or verified token, never from a request parameter (prevents IDOR).
- Passwords: bcrypt, argon2 or scrypt only. Never store or log plaintext, never md5/sha1, never return a hash.
- Sessions: cookies with `httpOnly`, `secure`, `sameSite`; rotate on login, invalidate on logout.
- JWT: verify signature and `exp`, reject `alg:none`, keep tokens short-lived.
- Rate-limit login and expensive endpoints.

## Secrets and crypto
- Secrets live in env vars or a secret manager, never in code, never in client bundles. Keep `.env` in `.gitignore`.
- Tokens, ids, salts, OTPs: `crypto.randomBytes`, `crypto.randomUUID`, `secrets.token_hex` — never `Math.random()`.
- Do not invent your own crypto.

## Configuration
- Generic error messages to users, details only to server logs. No stack traces in responses.
- Security headers: CSP, `X-Content-Type-Options: nosniff`, `frame-ancestors`, `Referrer-Policy`, HSTS.
- CORS: explicit origins, never `*` with credentials. CSRF protection for state-changing requests.
- Outbound requests to user-supplied URLs: allowlist hosts, block private IPs and `169.254.169.254`.
- Never log passwords, tokens, full card numbers or other secrets.

## Dependencies
- Only import packages you have verified exist; pin versions and commit the lockfile.

## Self-check before returning code
No secret in code · authz on the server · passwords hashed · queries parameterized · no user input into HTML, shell or eval · secure randomness · input validated · errors do not leak internals.
