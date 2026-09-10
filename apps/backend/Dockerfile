# ---------------------------------------------------------------------------
# NestJS backend
#
# Built from the REPOSITORY ROOT so the npm workspace lockfile is available:
#   docker build -f apps/backend/Dockerfile .
# Both compose files already set the context correctly.
#
# See /.dockerignore for what is kept out of that context - notably the .env
# files, whose secrets would otherwise be baked into the build layer by the
# `COPY apps/backend` below.
# ---------------------------------------------------------------------------

FROM node:22-bookworm-slim AS deps
WORKDIR /repo
# Manifests only, so this layer stays cached until dependencies change.
COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/
COPY apps/frontend/package.json apps/frontend/
RUN npm ci --workspace=@physio/backend --include-workspace-root


FROM deps AS build
WORKDIR /repo
COPY apps/backend apps/backend
# Prisma Client is generated code - it must exist before tsc runs.
RUN npx prisma generate --schema apps/backend/prisma/schema.prisma
RUN npm run build --workspace=@physio/backend
# Compile the production-safe database scripts. This runs AFTER the Nest build
# because nest-cli.json sets deleteOutDir, which would otherwise wipe them out
# of dist/ again. See tsconfig.prisma.json for what is included and why the
# demo seed is not.
RUN npm run build:prisma-scripts --workspace=@physio/backend


FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /repo

# curl backs the healthcheck below.
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/
COPY apps/frontend/package.json apps/frontend/
# --omit=dev, and the Prisma CLI is a runtime dependency rather than a dev one
# precisely so that it survives this. The entrypoint runs `prisma migrate
# deploy` on every start; with the CLI omitted, npx would instead reach out to
# the npm registry on each container boot - slow, dependent on outbound
# internet from the host, and unreliable without a TTY. Migrations are the last
# thing that should be fetched over the network at start-up.
RUN npm ci --omit=dev --workspace=@physio/backend --include-workspace-root \
 && npm cache clean --force

# dist/ carries both the compiled application and dist/prisma/, the compiled
# exercise-library script.
COPY --from=build /repo/apps/backend/dist apps/backend/dist
# The generated client and its engines. `npm ci` above installed @prisma/client
# but could not generate against a schema that had not been copied yet.
COPY --from=build /repo/node_modules/.prisma node_modules/.prisma
COPY --from=build /repo/node_modules/@prisma node_modules/@prisma
# Migrations and schema ship with the image so `migrate deploy` can run on start.
COPY apps/backend/prisma apps/backend/prisma
COPY apps/backend/docker-entrypoint.sh apps/backend/docker-entrypoint.sh

# Never run as root.
USER node
WORKDIR /repo/apps/backend
EXPOSE 3000

# In the image rather than only in compose, so a plain `docker run` is still
# supervised.
HEALTHCHECK --interval=15s --timeout=5s --start-period=45s --retries=5 \
  CMD curl -fsS "http://127.0.0.1:${PORT:-3000}/api/v1/health" || exit 1

# Invoked through `sh` so the script does not need an executable bit, which
# does not survive a checkout on Windows.
ENTRYPOINT ["sh", "/repo/apps/backend/docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
