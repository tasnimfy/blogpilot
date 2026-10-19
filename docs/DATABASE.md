# Database Backup & Recovery

## SQLite (default)

The database is a single file: `prisma/blogpilot.db`.

### Backup (safe, online)

SQLite supports online backup. Use the SQLite CLI or a scheduled task that
copies the file while taking a write lock. A robust option:

```bash
sqlite3 prisma/blogpilot.db ".backup 'backups/blogpilot-$(date +%F).db'"
```

The `.backup` command produces a consistent snapshot even while the app is
running. Alternatively, stop the app and copy the file.

Because stored credentials are encrypted with `APP_ENC_KEY`, a database backup
alone is not enough to recover credentials — you must also back up
`APP_ENC_KEY` (store it in a separate, secret location such as a password
manager or secrets manager). Losing the key means stored API keys and
WordPress passwords cannot be decrypted.

### Recovery

1. Restore the `.db` file to `prisma/blogpilot.db`.
2. Ensure `APP_ENC_KEY` matches the value used when the backup was created.
3. Run `npm run prisma:deploy` to bring migrations in line with the schema.
4. Start the app.

## PostgreSQL

Use `pg_dump`:

```bash
pg_dump blogpilot > blogpilot.dump
```

Restore with `psql`. Back up `APP_ENC_KEY` alongside as above.

## Reset (development only)

```bash
npm run db:reset
```

This drops all data, reapplies migrations, and reseeds the admin account. It
is destructive — never run it against a production database.

## Test database

`npm run test:create-db` recreates `prisma/test.db`. It is wiped by the test
suite between runs and is not used by the app.
