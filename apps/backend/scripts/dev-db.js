#!/usr/bin/env node
/**
 * Project-local PostgreSQL for development and tests. FALLBACK ONLY.
 *
 * This is no longer the default. The application now runs against the local
 * PostgreSQL 18 server (port 5432), created by scripts/bootstrap-local-db.sql;
 * the data was migrated out of this cluster and verified row-for-row. Keep
 * this script for a machine that has no PostgreSQL installed at all.
 *
 * Note that it starts on port 55432 precisely so it can never collide with a
 * system PostgreSQL on 5432.
 *
 * Why this exists
 * ---------------
 * The canonical way to run this stack is `docker compose up` (see the repo
 * root). But Docker Desktop is not installed on every machine a Final Year
 * Project has to run on - including the one this was built on - and "install
 * Docker first" is a poor answer when the alternative costs nothing.
 *
 * `embedded-postgres` unpacks a real PostgreSQL server into node_modules and
 * runs it on a project-local data directory. It is a genuine PostgreSQL - the
 * same engine, same SQL, same Prisma migrations - not an emulator such as
 * pg-mem, so anything verified against it is verified for real.
 *
 * Nothing is installed system-wide and no global configuration is touched.
 *
 *   node scripts/dev-db.js start    # start (creates the cluster on first run)
 *   node scripts/dev-db.js stop
 *   node scripts/dev-db.js status
 *   node scripts/dev-db.js reset    # destroy the cluster and start clean
 */

const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const EmbeddedPostgres = require('embedded-postgres').default;

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, '.pgdata');
const PID_FILE = path.join(DATA_DIR, '.embedded.json');

const CONFIG = {
  user: 'physio',
  password: 'physio_dev_password',
  port: Number(process.env.DEV_DB_PORT ?? 55432),
  database: 'physio',
};

const CONNECTION_URL =
  `postgresql://${CONFIG.user}:${CONFIG.password}` +
  `@127.0.0.1:${CONFIG.port}/${CONFIG.database}?schema=public`;

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const done = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(1000);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

function makeServer() {
  return new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: CONFIG.user,
    password: CONFIG.password,
    port: CONFIG.port,
    persistent: true,
    onLog: () => {}, // PostgreSQL's own chatter is noise here
  });
}

async function start() {
  if (await isPortOpen(CONFIG.port)) {
    console.log(`[dev-db] Already running on port ${CONFIG.port}`);
    console.log(`[dev-db] DATABASE_URL="${CONNECTION_URL}"`);
    return;
  }

  const pg = makeServer();
  const firstRun = !fs.existsSync(path.join(DATA_DIR, 'PG_VERSION'));

  if (firstRun) {
    console.log('[dev-db] Initialising a new PostgreSQL cluster (first run)...');
    fs.mkdirSync(DATA_DIR, { recursive: true });
    await pg.initialise();
  }

  console.log(`[dev-db] Starting PostgreSQL on port ${CONFIG.port}...`);
  await pg.start();

  if (firstRun) {
    await pg.createDatabase(CONFIG.database);
    console.log(`[dev-db] Created database "${CONFIG.database}"`);
  }

  fs.writeFileSync(PID_FILE, JSON.stringify({ port: CONFIG.port }, null, 2));

  console.log('[dev-db] Ready.');
  console.log(`[dev-db] DATABASE_URL="${CONNECTION_URL}"`);
  console.log('[dev-db] Leave this running. Press Ctrl+C to stop the database.');

  // embedded-postgres runs the server as a CHILD of this process, so this
  // process must stay alive - exiting here takes PostgreSQL down with it.
  // Behaves like `docker compose up`: occupies the terminal until stopped.
  const shutdown = async (signal) => {
    console.log(`\n[dev-db] ${signal} received, stopping PostgreSQL...`);
    try {
      await pg.stop();
      console.log('[dev-db] Stopped cleanly.');
    } catch (error) {
      console.error('[dev-db] Error during shutdown:', error.message);
    }
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  // Keep the event loop alive indefinitely.
  await new Promise(() => {});
}

async function stop() {
  if (!(await isPortOpen(CONFIG.port))) {
    console.log('[dev-db] Not running.');
    return;
  }
  const pg = makeServer();
  await pg.stop();
  console.log('[dev-db] Stopped.');
}

async function status() {
  const running = await isPortOpen(CONFIG.port);
  console.log(
    running
      ? `[dev-db] RUNNING on port ${CONFIG.port}`
      : `[dev-db] STOPPED (port ${CONFIG.port} closed)`,
  );
  if (running) console.log(`[dev-db] DATABASE_URL="${CONNECTION_URL}"`);
  process.exitCode = running ? 0 : 1;
}

async function reset() {
  await stop();
  if (fs.existsSync(DATA_DIR)) {
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
    console.log('[dev-db] Cluster destroyed.');
  }
  await start();
}

const commands = { start, stop, status, reset };
const command = process.argv[2] ?? 'start';

if (!commands[command]) {
  console.error(`Unknown command "${command}". Use: start | stop | status | reset`);
  process.exit(1);
}

commands[command]().catch((error) => {
  console.error(`[dev-db] ${command} failed:`, error.message);
  process.exit(1);
});
