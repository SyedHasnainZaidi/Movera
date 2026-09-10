# Database migration: embedded PostgreSQL 17 to local PostgreSQL 18

Record of moving the application database off the project-local
`embedded-postgres` cluster and onto the PostgreSQL 18 server installed on the
development machine.

- **From:** PostgreSQL 17.5, `embedded-postgres`, `apps/backend/.pgdata`, port 55432
- **To:** PostgreSQL 18.6, Windows service `postgresql-x64-18`, port 5432
- **Moved:** 20 tables, 14 enum types, 39 indexes, 30 foreign keys, 539 rows
- **Result:** verified identical — schema fingerprint, row counts, and per-table
  content hashes all match

## Why the embedded server was used first

`embedded-postgres` unpacks a real PostgreSQL into `node_modules` and runs it
from a project-local data directory. It was chosen because the initial
environment probe (`psql --version`) found nothing on `PATH`.

That probe was wrong. PostgreSQL 18 was installed and running the whole time;
the installer simply does not add `C:\Program Files\PostgreSQL\18\bin` to
`PATH`. **Absence from `PATH` is not absence from the machine** — the reliable
checks are the service list and the listening ports:

```
Get-Service postgresql*
netstat -ano | findstr :5432
```

## Credential handling

`pg_hba.conf` on the target requires `scram-sha-256` on every path — `local`,
`127.0.0.1/32` and `::1/128` — and no `pgpass.conf` existed. Creating a role
therefore needs the `postgres` superuser password.

Three rules shaped how that was handled:

1. The superuser password was never requested in conversation, never written to
   a file, and never passed on a command line. `psql` prompts for it
   interactively; it exists only in that prompt.
2. `pg_hba.conf` was **not** edited and the service was **not** restarted to
   weaken authentication. Loosening a machine's database authentication to
   avoid typing a password is a poor trade.
3. The application does not connect as a superuser. It gets one role owning one
   database.

The application role's password is generated locally
(`crypto.randomBytes(32).toString('hex')` — hex so that every character is safe
inside a `postgresql://` URL and no percent-encoding is needed) and lives only
in `apps/backend/.env` and `.pgdump/`, both git-ignored.

`scripts/bootstrap-local-db.sql` is committed with a `__APP_PASSWORD__`
placeholder, so the procedure is reproducible without the secret being in the
repository.

## Procedure

1. **Dump** with the PostgreSQL 18 `pg_dump` against the 17.5 server. A newer
   client reading an older server is the supported direction.
   `--no-owner --no-privileges`, because ownership statements from the source
   must not be replayed on a differently-owned target.
2. **Fingerprint** the source: exact per-table row counts, plus a 535-entry
   structural fingerprint (tables, columns, nullability, enum labels, index
   definitions, constraint definitions).
3. **Bootstrap** the target as superuser: role `physio` with `LOGIN CREATEDB`
   (not superuser), database `physio` owned by it, and `public` schema
   ownership transferred to it.
4. **Restore** with `-v ON_ERROR_STOP=1`. A partial restore that reports
   success is the worst possible outcome.
5. **Verify** — `node scripts/verify-db-migration.js`.
6. **Switch** `DATABASE_URL` and re-run the test suites.

The `CREATEDB` grant matters: `prisma migrate dev` builds a temporary shadow
database to validate each new migration. Without it, authoring the *next*
migration fails with an error that is hard to trace to a privilege problem.

The `public` schema grant matters too. Since PostgreSQL 15 the `public` schema
is no longer writable by `PUBLIC`; without transferring ownership, Prisma fails
with `permission denied for schema public`.

## The Prisma migration history came across intact

`_prisma_migrations` is an ordinary table, so `pg_dump` carried both rows and
their checksums. The restored database was therefore recognised as already
migrated — no `prisma migrate resolve` was needed:

```
2 migrations found in prisma/migrations
Database schema is up to date!
```

`prisma migrate diff` independently reported `No difference detected` between
`schema.prisma` and the live database.

## A PostgreSQL 18 behaviour change that looked like data loss

The first verification run **failed** with 159 "extra" constraints on the
target — every one of them a `NOT NULL`, none of them missing, and row counts
passing.

The cause is a catalog change in PostgreSQL 18: it records each `NOT NULL` as a
real row in `pg_constraint` with `contype = 'n'`. PostgreSQL 17 and earlier
stored nullability **only** as the `pg_attribute.attnotnull` flag.

| | PG 17.5 source | PG 18.6 target |
| --- | --- | --- |
| `contype='f'` (foreign key) | 30 | 30 |
| `contype='p'` (primary key) | 20 | 20 |
| `contype='n'` (NOT NULL) | 0 | 159 |
| Columns with `attnotnull` | 159 | 159 |

The same 159 columns are NOT NULL on both servers. Nothing changed except how
the constraint is recorded. The verifier now excludes `contype = 'n'` and reads
nullability from `attnotnull`, which means the same thing on both versions.

This is worth stating plainly: **the failure was in the verification tool, not
the migration.** It is also the argument for having written the tool at all — a
check that only ever passes proves nothing.

### A second, self-inflicted lesson

The original baseline was captured with a query typed at a shell prompt while
the comparison used the script's own query. The two could drift, and did.
`verify-db-migration.js` now has a `--capture` mode so both directions share
one query definition:

```bash
node scripts/verify-db-migration.js --capture "postgresql://..."   # source
node scripts/verify-db-migration.js                                # target
```

## Verification results

Structure and row counts, target against source baseline:

```
Structure
  PASS  schema fingerprint (535 entries identical)
Data
  PASS  row counts (20 entries identical)
  source rows: 539   restored rows: 539
RESULT: identical. Migration verified.
```

Content, not just cardinality — an MD5 over every row of every table, ordered
deterministically so the result does not depend on physical row order:

```
tables hashed: 20 / 20
CONTENT IDENTICAL: all 20 tables hash equal across both servers.
```

Test suites re-run against PostgreSQL 18:

| Suite | Result |
| --- | --- |
| Backend unit (Jest) | 46 passed |
| Backend e2e (Supertest, real PostgreSQL) | 44 passed |

## Rollback

The embedded cluster was not destroyed. To go back, point `DATABASE_URL` at
`postgresql://physio:physio_dev_password@127.0.0.1:55432/physio?schema=public`
and run `npm run db:up`. The plain-SQL dump in `apps/backend/.pgdump/` restores
onto any PostgreSQL 17 or later.

## Note on the test database

The e2e suite runs against the same `DATABASE_URL` as development, which is now
the live local database. The suite only ever inserts — it contains no
`deleteMany`, `TRUNCATE` or `DROP`, which was checked before it was first run
against the migrated data — so it accumulates test rows rather than destroying
real ones. Giving the tests their own database is the correct fix and is listed
in the outstanding work.
