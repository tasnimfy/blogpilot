# Security Notes

## Authentication & sessions

- Dashboard uses email/password authentication. Passwords are hashed with
  bcrypt (cost 12).
- Sessions use stateless HMAC-SHA256-signed cookies (`HttpOnly`, `SameSite=Lax`).
  Tokens carry a 7-day expiry and are verified on every protected request.
- The dashboard is never exposed unauthenticated: every dashboard route and
  API handler calls `requireUser()` server-side.

## Credential storage

- OpenRouter API keys and WordPress application passwords are encrypted at
  rest with **AES-256-GCM** using `APP_ENC_KEY`, which lives **outside** the
  database.
- Encrypted values are prefixed `enc:v1:` and are never returned to the
  browser. Serialization helpers strip the ciphertext and expose only a
  `hasApiKey` / `hasAppPassword` boolean.
- `redactSecrets()` is available for logging so keys/passwords are never
  written to logs.

## Data isolation

- Every site-owned record carries a `websiteId` with a cascade foreign key.
- Business-logic services are site-scoped; API routes resolve records by the
  authenticated operator and never mix sites.

## Input handling

- All API bodies are validated with zod before touching the database.
- Prisma parameterized queries prevent SQL injection.
- Model/AI output, CSV imports, research excerpts, image metadata, and
  WordPress responses are treated as **untrusted input** and validated before
  use; none are ever executed as code or injected into prompts as instructions.

## SSRF protections (WordPress, later phases)

- WordPress connections require HTTPS.
- Planned SSRF guards block localhost, private/loopback/link-local ranges and
  cloud metadata endpoints, disable redirect bypass, and enforce timeouts and
  response-size limits. These are implemented with the WordPress connection in
  Phase 6.

## Audit logging

Sensitive actions (login, site create/update/delete/status, settings,
credentials) are recorded in `AuditLog` with actor, site, entity, and a
redacted detail payload.

## Operational hygiene

- Secrets come from environment variables; `.env` is gitignored.
- Logs never contain article bodies or decrypted secrets.
- `poweredByHeader` is disabled.

## Known hardening to complete in later phases

- Rate limiting on authentication and API endpoints.
- CSRF tokens (SameSite=Lax mitigates the main vector; explicit tokens to be
  added).
- File-upload validation (for CSV imports).
- Periodic dependency vulnerability scanning (`npm audit`).
