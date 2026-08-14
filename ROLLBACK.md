# Security hardening rollback

## Before deploy

1. Create a Railway PostgreSQL backup/PITR checkpoint.
2. Preserve the current SQLite volume (`DB_PATH`, normally `/data/shepherd.db`)
   as a read-only copy.
3. Record the currently deployed Railway release.

## Emergency Postgres rollback

The migration is one-way at runtime: do not point a downgraded binary at the
Postgres database. Roll back the Railway application release and reattach/use
the preserved SQLite volume with its matching pre-migration release. If writes
occurred after migration, restore PostgreSQL from the pre-deploy checkpoint or
export the affected tables before returning to SQLite; otherwise newer writes
will be lost. Rehearse this with a copied production database before launch.

## Temporary legacy URL-hash access

Do **not** re-enable it in normal operation: it reintroduces account takeover.
If authentication is catastrophically unavailable, roll back the entire Railway
release to the pre-hardening version. Do not cherry-pick a route that accepts
`userId` from URL/body; use maintenance messaging while the JWT configuration is
repaired.

## Rate-limit incident response

First inspect whether the capacity is provider latency or abusive traffic. For a
short, documented incident window, set `RATE_LIMIT_BYPASS=true` and redeploy;
this bypasses authenticated daily quota only. It does not remove the global
Anthropic concurrency queue. Reset it to `false` immediately after recovery.
