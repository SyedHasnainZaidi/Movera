#!/usr/bin/env node
/**
 * Prove that a restored database is equivalent to the one it came from.
 *
 * A migration between servers is only trustworthy if it is checked, and
 * "the app still starts" is not a check - a silently empty table or a dropped
 * partial index would pass that. This compares the live database against two
 * fingerprints captured from the source before the move:
 *
 *   .pgdump/baseline_rowcounts.txt   every table and its exact row count
 *   .pgdump/baseline_schema.txt      every table, column, enum label, index
 *                                    definition and constraint definition
 *
 * Both are compared as exact sets, so anything added, missing or altered is
 * reported by name rather than as a count mismatch.
 *
 *   node scripts/verify-db-migration.js
 *
 * Reads DATABASE_URL from apps/backend/.env. Exits non-zero on any difference.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const DUMP_DIR = path.join(ROOT, '.pgdump');
const PSQL =
  process.env.PSQL_PATH ?? 'C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe';

const ROWCOUNT_SQL = `select string_agg(
  format('select %L t, count(*) c from public.%I', tablename, tablename),
  ' union all ') from pg_tables where schemaname='public';`;

/**
 * Structural fingerprint, deliberately written to be comparable ACROSS
 * PostgreSQL major versions.
 *
 * The `contype <> 'n'` filter is the important part. PostgreSQL 18 records
 * every NOT NULL as a real row in pg_constraint (contype 'n'); PostgreSQL 17
 * and earlier stored it only as the pg_attribute.attnotnull flag. Comparing
 * pg_constraint verbatim therefore reports 159 phantom "extra" constraints on
 * a 17 -> 18 migration that is in fact identical.
 *
 * Nullability is still checked - it is just read from attnotnull, which means
 * the same thing on both versions.
 */
const SCHEMA_SQL = `
select 'table:'||tablename from pg_tables where schemaname='public'
union all select 'column:'||table_name||'.'||column_name||':'||data_type
  from information_schema.columns where table_schema='public'
union all select 'notnull:'||c.relname||'.'||a.attname
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname='public' and c.relkind='r'
    and a.attnum > 0 and not a.attisdropped and a.attnotnull
union all select 'enum:'||t.typname||':'||e.enumlabel
  from pg_type t join pg_enum e on e.enumtypid=t.oid
union all select 'index:'||indexname||':'||indexdef
  from pg_indexes where schemaname='public'
union all select 'constraint:'||conname||':'||pg_get_constraintdef(oid)
  from pg_constraint
  where connamespace='public'::regnamespace and contype <> 'n'`;

function readDatabaseUrl() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) {
    throw new Error(`No .env at ${envPath}`);
  }
  const line = fs
    .readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .find((l) => l.trim().startsWith('DATABASE_URL'));
  if (!line) throw new Error('DATABASE_URL not found in .env');
  const raw = line
    .slice(line.indexOf('=') + 1)
    .trim()
    .replace(/^["']|["']$/g, '');
  return toLibpqUrl(raw);
}

/**
 * Prisma accepts connection-string parameters that libpq does not, and psql
 * rejects the whole URL on the first one it does not recognise:
 *   psql: error: invalid URI query parameter: "schema"
 * They are Prisma client settings, irrelevant to a psql session, so they are
 * dropped rather than translated.
 */
const PRISMA_ONLY_PARAMS = [
  'schema',
  'connection_limit',
  'pool_timeout',
  'pgbouncer',
  'socket_timeout',
  'statement_cache_size',
  'schema_search_path',
];

function toLibpqUrl(raw) {
  const url = new URL(raw);
  for (const key of PRISMA_ONLY_PARAMS) url.searchParams.delete(key);
  return url.toString();
}

/** Runs SQL through psql and returns unaligned, tuples-only lines. */
function query(url, sql) {
  const out = execFileSync(PSQL, [url, '-tA', '-c', sql], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return out.split(/\r?\n/).filter((l) => l.length > 0);
}

/** Set difference in both directions, reported by name. */
function compare(label, expected, actual) {
  const e = new Set(expected);
  const a = new Set(actual);
  const missing = [...e].filter((x) => !a.has(x));
  const extra = [...a].filter((x) => !e.has(x));

  if (missing.length === 0 && extra.length === 0) {
    console.log(`  PASS  ${label} (${e.size} entries identical)`);
    return true;
  }
  console.log(`  FAIL  ${label}`);
  missing.slice(0, 25).forEach((x) => console.log(`          missing: ${x}`));
  extra.slice(0, 25).forEach((x) => console.log(`          extra:   ${x}`));
  if (missing.length > 25) console.log(`          ...and ${missing.length - 25} more missing`);
  if (extra.length > 25) console.log(`          ...and ${extra.length - 25} more extra`);
  return false;
}

const mask = (url) => url.replace(/:\/\/([^:]+):[^@]+@/, '://$1:***@');

/** Collects both fingerprints from one database. */
function fingerprint(url) {
  const countQuery = query(url, ROWCOUNT_SQL)[0];
  return {
    rows: query(url, countQuery).sort(),
    schema: query(url, SCHEMA_SQL).sort(),
  };
}

/**
 * Capture mode. Writes the baselines from a SOURCE database.
 *
 *   node scripts/verify-db-migration.js --capture "postgresql://..."
 *
 * Capture and compare deliberately share ROWCOUNT_SQL and SCHEMA_SQL. An
 * earlier version of this migration captured the baseline with a hand-written
 * query typed at a shell prompt and compared with the script's own; the two
 * drifted, and the difference showed up as a false migration failure.
 */
function capture(rawUrl) {
  const url = toLibpqUrl(rawUrl);
  console.log(`Capturing baseline from: ${mask(url)}\n`);
  fs.mkdirSync(DUMP_DIR, { recursive: true });

  const { rows, schema } = fingerprint(url);
  fs.writeFileSync(path.join(DUMP_DIR, 'baseline_rowcounts.txt'), rows.join('\n') + '\n');
  fs.writeFileSync(path.join(DUMP_DIR, 'baseline_schema.txt'), schema.join('\n') + '\n');

  const total = rows.reduce((s, l) => s + Number(l.split('|')[1] ?? 0), 0);
  console.log(`  ${rows.length} tables, ${total} rows`);
  console.log(`  ${schema.length} schema fingerprint entries`);
  console.log('\nBaseline written to .pgdump/');
}

function main() {
  const captureFlag = process.argv.indexOf('--capture');
  if (captureFlag !== -1) {
    const url = process.argv[captureFlag + 1];
    if (!url) throw new Error('--capture requires a connection URL');
    return capture(url);
  }

  const url = readDatabaseUrl();
  console.log(`Verifying: ${mask(url)}\n`);

  const baselineRows = path.join(DUMP_DIR, 'baseline_rowcounts.txt');
  const baselineSchema = path.join(DUMP_DIR, 'baseline_schema.txt');
  for (const f of [baselineRows, baselineSchema]) {
    if (!fs.existsSync(f)) {
      console.error(`Missing baseline: ${f}`);
      console.error('Capture it from the source database before migrating.');
      process.exit(2);
    }
  }

  const lines = (f) =>
    fs.readFileSync(f, 'utf8').split(/\r?\n/).filter(Boolean).sort();

  const { rows: actualRows, schema: actualSchema } = fingerprint(url);
  const expectedRows = lines(baselineRows);
  const expectedSchema = lines(baselineSchema);

  console.log('Structure');
  const schemaOk = compare('schema fingerprint', expectedSchema, actualSchema);
  console.log('\nData');
  const rowsOk = compare('row counts', expectedRows, actualRows);

  const total = (arr) =>
    arr.reduce((sum, l) => sum + Number(l.split('|')[1] ?? 0), 0);
  console.log(
    `\n  source rows: ${total(expectedRows)}   restored rows: ${total(actualRows)}`,
  );

  if (schemaOk && rowsOk) {
    console.log('\nRESULT: identical. Migration verified.');
    process.exit(0);
  }
  console.log('\nRESULT: differences found. Migration NOT verified.');
  process.exit(1);
}

try {
  main();
} catch (error) {
  console.error(`verify-db-migration failed: ${error.message}`);
  process.exit(2);
}
