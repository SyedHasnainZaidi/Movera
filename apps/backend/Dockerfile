# ---------------------------------------------------------------------------
# NestJS backend
#
# Built from the REPOSITORY ROOT so the npm workspace lockfile is available:
#   docker build -f apps/backend/Dockerfile .
# docker-compose.yml already sets the context correctly.
# ---------------------------------------------------------------------------

FROM node:22-bookworm-slim AS deps
WORKDIR /repo
# Copy manifests only, so this layer is cached until dependencies change.
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


FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /repo

# curl is used by the compose healthcheck.
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/
COPY apps/frontend/package.json apps/frontend/
RUN npm ci --omit=dev --workspace=@physio/backend --include-workspace-root \
 && npm cache clean --force

COPY --from=build /repo/apps/backend/dist apps/backend/dist
COPY --from=build /repo/node_modules/.prisma node_modules/.prisma
COPY --from=build /repo/node_modules/@prisma node_modules/@prisma
# Migrations and seed ship with the image so `migrate deploy` can run on start.
COPY apps/backend/prisma apps/backend/prisma

# Never run as root.
USER node
WORKDIR /repo/apps/backend
EXPOSE 3000
CMD ["node", "dist/main.js"]
