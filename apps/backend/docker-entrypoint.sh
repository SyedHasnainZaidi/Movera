#!/bin/sh
# ---------------------------------------------------------------------------
# Backend container entrypoint.
#
# Applies pending migrations, then hands the process over to the command.
#
# `migrate deploy` is the production command: it applies committed migrations
# and nothing else. It never generates, never prompts, and never resets - all
# of which `migrate dev` will happily do to a database with real sessions in
# it.
#
# The final `exec` matters. Without it this shell stays as PID 1 and Node runs
# as its child, so a SIGTERM from `docker stop` reaches the shell and not the
# application - Nest's shutdown hooks never fire, in-flight requests are cut,
# and the container is SIGKILLed ten seconds later. `exec` replaces the shell
# with Node, which then receives signals directly.
#
# Running migrations at start is correct for a single instance, which is what
# this deployment is. Prisma takes a database advisory lock, so concurrent
# starts serialise rather than corrupt - but if this is ever scaled past one
# replica, move the migration to a one-shot job instead.
# ---------------------------------------------------------------------------
set -e

echo "[entrypoint] Applying database migrations..."
npx prisma migrate deploy --schema prisma/schema.prisma
echo "[entrypoint] Migrations up to date."

exec "$@"
