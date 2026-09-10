#!/usr/bin/env node
/**
 * Temporarily share Movera over an ngrok tunnel.
 *
 *   node tools/share/share.js          # start sharing
 *   Ctrl+C                             # stop, and put every config back
 *
 * What it does
 * ------------
 * The app is three services on three ports, but only ONE of them can sit
 * behind a single free-tier tunnel. A visitor's browser would resolve the
 * other two against their own machine and find nothing there.
 *
 * So everything is routed through the Vite dev server, which proxies `/api`
 * to the backend and `/ws/session` to the pose service (see
 * apps/frontend/vite.config.ts). One origin, one tunnel, and no CORS or
 * third-party-cookie problems.
 *
 * This script:
 *   1. starts ngrok against the frontend port,
 *   2. reads the public URL back out of ngrok's local API,
 *   3. rewrites the three .env files to use it,
 *   4. restores every one of them when you stop it.
 *
 * Backups are taken before the first edit and restored on exit - including on
 * Ctrl+C - so a shared configuration cannot be left behind by accident.
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const FRONTEND_PORT = 5173;
const NGROK_API = 'http://127.0.0.1:4040/api/tunnels';

const TARGETS = {
  frontend: path.join(ROOT, 'apps', 'frontend', '.env'),
  backend: path.join(ROOT, 'apps', 'backend', '.env'),
  pose: path.join(ROOT, 'services', 'pose-service', '.env'),
};

const backups = new Map();
let ngrok = null;
let restored = false;

/** Any ngrok host, from this run or a previous one. */
const NGROK_ORIGIN = /https?:\/\/[^,\s]*\.ngrok[^,\s]*/g;

/**
 * Strip tunnel URLs left behind by an earlier run.
 *
 * The restore-on-exit handler cannot run if the process is force-killed - a
 * terminal closed, the machine sleeping, a task manager. When that happens the
 * .env files keep pointing at a tunnel that no longer exists, which silently
 * breaks emailed links and leaves a dead origin in the CORS allowlist.
 *
 * So rather than trusting the previous run to have cleaned up, every start
 * removes any ngrok origin it finds first. That also makes the backup taken
 * below a genuinely local-only baseline, so restoring really does restore.
 */
function stripStaleTunnels(contents) {
  // TRUST_PROXY is only ever switched on to serve a tunnel, but it holds no
  // URL, so a URL-based sweep would leave it behind. Left on locally it makes
  // the backend believe an unvalidated X-Forwarded-For header, which lets any
  // caller spoof its address and evade the login rate limit. Only cleared when
  // this file still carries a tunnel URL, so a deliberate setting survives.
  const sharing = /\.ngrok/.test(contents);

  return contents
    .split('\n')
    .map((line) => {
      if (sharing && line.startsWith('TRUST_PROXY=')) return null;

      if (!NGROK_ORIGIN.test(line)) {
        NGROK_ORIGIN.lastIndex = 0;
        return line;
      }
      NGROK_ORIGIN.lastIndex = 0;

      // APP_PUBLIC_URL holds a single URL: drop the whole setting so the
      // backend falls back to the first FRONTEND_URL entry.
      if (line.startsWith('APP_PUBLIC_URL=')) return null;

      // The list settings keep their non-ngrok entries.
      const [key, ...rest] = line.split('=');
      const kept = rest
        .join('=')
        .split(',')
        .map((v) => v.trim())
        .filter((v) => v && !/\.ngrok/.test(v));
      return kept.length ? `${key}=${kept.join(',')}` : null;
    })
    .filter((line) => line !== null)
    .join('\n');
}

function backup() {
  for (const [name, file] of Object.entries(TARGETS)) {
    if (!fs.existsSync(file)) {
      throw new Error(`Missing ${name} .env at ${file}`);
    }

    const onDisk = fs.readFileSync(file, 'utf8');
    const cleaned = stripStaleTunnels(onDisk);
    if (cleaned !== onDisk) {
      console.log(`  cleaned a stale tunnel URL out of ${name}/.env`);
      fs.writeFileSync(file, cleaned);
    }
    backups.set(file, cleaned);
  }
}

function restore() {
  if (restored) return;
  restored = true;
  for (const [file, contents] of backups) {
    fs.writeFileSync(file, contents);
  }
  console.log('\nConfiguration restored. The app is local-only again.');
  console.log('Restart the three services so they pick the original values back up.');
}

/** Replace a KEY=value line, or append it when the key is absent. */
function setEnv(contents, key, value) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  return pattern.test(contents)
    ? contents.replace(pattern, line)
    : `${contents.trimEnd()}\n${line}\n`;
}

function applyPublicUrl(publicUrl) {
  const host = new URL(publicUrl).host;

  // --- frontend: talk to the same origin, not to localhost -----------------
  let frontend = backups.get(TARGETS.frontend);
  frontend = setEnv(frontend, 'VITE_API_URL', '/api/v1');
  frontend = setEnv(frontend, 'VITE_POSE_WS_URL', '/ws/session');
  fs.writeFileSync(TARGETS.frontend, frontend);

  // --- backend: allow the tunnel origin, and put it in emailed links -------
  let backend = backups.get(TARGETS.backend);
  const origins = new Set(
    (/^FRONTEND_URL=(.*)$/m.exec(backend)?.[1] ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  );
  origins.add(publicUrl);
  backend = setEnv(backend, 'FRONTEND_URL', [...origins].join(','));
  // Verification and password-reset links must point at the tunnel; the
  // default (localhost) would be dead on a visitor's machine.
  backend = setEnv(backend, 'APP_PUBLIC_URL', publicUrl);
  // Every request now arrives from the Vite proxy. Without this, all visitors
  // share one rate-limit bucket and lock each other out at ten logins a minute.
  backend = setEnv(backend, 'TRUST_PROXY', 'true');
  fs.writeFileSync(TARGETS.backend, backend);

  // --- pose service: accept the tunnel origin on the WebSocket -------------
  let pose = backups.get(TARGETS.pose);
  const poseOrigins = new Set(
    (/^ALLOWED_ORIGINS=(.*)$/m.exec(pose)?.[1] ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  );
  poseOrigins.add(publicUrl);
  pose = setEnv(pose, 'ALLOWED_ORIGINS', [...poseOrigins].join(','));
  fs.writeFileSync(TARGETS.pose, pose);

  return host;
}

async function waitForPublicUrl(attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(NGROK_API);
      const body = await response.json();
      const https = (body.tunnels ?? []).find(
        (t) => t.public_url?.startsWith('https://'),
      );
      if (https) return https.public_url;
    } catch {
      // ngrok's local API is not listening yet.
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('ngrok did not report a public URL. Check its output above.');
}

async function main() {
  console.log('Starting an ngrok tunnel for Movera...\n');
  backup();

  ngrok = spawn('ngrok', ['http', String(FRONTEND_PORT), '--log', 'stdout'], {
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let sawAuthError = false;
  const watch = (chunk) => {
    const text = chunk.toString();
    if (text.includes('ERR_NGROK_4018')) sawAuthError = true;
  };
  ngrok.stdout.on('data', watch);
  ngrok.stderr.on('data', watch);

  ngrok.on('exit', (code) => {
    if (sawAuthError) {
      console.error(
        '\nngrok is not authenticated. Get a free token from\n' +
          '  https://dashboard.ngrok.com/get-started/your-authtoken\n' +
          'then run:\n' +
          '  ngrok config add-authtoken <your token>\n',
      );
    } else if (code !== 0 && !restored) {
      console.error(`\nngrok exited with code ${code}.`);
    }
    restore();
    process.exit(code ?? 0);
  });

  const publicUrl = await waitForPublicUrl();
  const host = applyPublicUrl(publicUrl);

  console.log('='.repeat(66));
  console.log('  MOVERA IS SHARED');
  console.log('='.repeat(66));
  console.log(`\n  ${publicUrl}\n`);
  console.log('  Send that link to your testers.\n');
  console.log('  Config updated:');
  console.log('    frontend  -> same-origin API and WebSocket');
  console.log(`    backend   -> CORS + email links allow ${host}`);
  console.log(`    pose      -> WebSocket accepts ${host}`);
  console.log('\n  NOW RESTART the backend, pose service and frontend so they');
  console.log('  read the new values. Leave this window open.\n');
  console.log('  Ctrl+C here stops the tunnel and restores every config file.');
  console.log('='.repeat(66));
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (ngrok) ngrok.kill();
    restore();
    process.exit(0);
  });
}
process.on('exit', restore);

main().catch((error) => {
  console.error(`\nshare failed: ${error.message}`);
  if (ngrok) ngrok.kill();
  restore();
  process.exit(1);
});
