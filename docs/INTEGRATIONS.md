# Integrations & Real-Credential Testing

Phase 1 does not call any external service. Later phases will add OpenRouter,
WordPress, Google Search Console / Trends, and image providers. This document
explains how to run tests that exercise real integrations (they are **not**
run by default).

## Default automated tests

`npm test` runs with mocked/no external services. The suite verifies:

- Multi-site CRUD and data isolation
- Duplicate-domain and validation rejection
- Cascading deletion
- Password hashing + signed session tokens (tamper/expiry)
- AES-256-GCM credential encryption and secret redaction
- Per-site settings/guidelines/AI/WordPress updates and serialization safety

## Real-credential integration tests (later phases)

These are intentionally **not** in the default suite, because they require
live credentials and external state. When a phase introduces a real
integration, add integration tests under `tests/integration/` guarded by an
environment flag, for example:

```bash
# OpenRouter
OPENROUTER_API_KEY=sk-or-... RUN_INTEGRATION=1 npm run test:integration
```

Guidelines for writing them:

- Never commit real credentials. Load them from environment variables only.
- Use a dedicated WordPress staging site with an application password scoped
  to that site.
- Use Google OAuth test credentials with least-privilege scopes.
- Image-provider tests should use a read-only API key and assert license
  metadata is preserved, without downloading large files.
- Clean up created WordPress posts/media after the test.

## Manual verification

For each external integration, the operator should manually confirm:

1. The provider's current official documentation and rate limits.
2. That credentials stored in BlogPilot are encrypted at rest (inspect the DB
   — values begin with `enc:v1:`).
3. That no credential ever appears in browser responses, page source, logs,
   or error messages.

## Provider adapters (research & Trends)

Research search and Trends use pluggable provider adapters
(`src/providers/`). The default providers honestly report that no automated
source is configured; manual fallbacks (adding research sources manually, and
importing Trends observations via CSV) are always available.

To add a real provider, implement the interface in `src/providers/types.ts`
and register it via `register()` in the corresponding registry. Use only
authorized APIs and respect robots directives, terms, privacy, and rate
limits. A Trends provider must return relative index values (never absolute
volume) and must fail honestly rather than fabricate.
