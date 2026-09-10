# ---------------------------------------------------------------------------
# React frontend, served as static files by nginx.
#
# Built from the REPOSITORY ROOT (see docker-compose.yml for the context).
#
# Vite inlines VITE_* variables at BUILD time, so the API and WebSocket URLs
# are baked into the bundle. They are therefore build arguments, not runtime
# environment - and they must be the addresses the BROWSER can reach
# (localhost:3000), never the compose-internal hostnames (backend:3000), which
# mean nothing outside the Docker network.
# ---------------------------------------------------------------------------

FROM node:22-bookworm-slim AS build
WORKDIR /repo

ARG VITE_API_URL=http://localhost:3000/api/v1
ARG VITE_POSE_WS_URL=ws://localhost:8000/ws/session
ARG VITE_POSE_FRAME_SAMPLE_FPS=10
ARG VITE_POSE_IMAGE_WIDTH=480
ARG VITE_POSE_IMAGE_QUALITY=0.6

ENV VITE_API_URL=$VITE_API_URL \
    VITE_POSE_WS_URL=$VITE_POSE_WS_URL \
    VITE_POSE_FRAME_SAMPLE_FPS=$VITE_POSE_FRAME_SAMPLE_FPS \
    VITE_POSE_IMAGE_WIDTH=$VITE_POSE_IMAGE_WIDTH \
    VITE_POSE_IMAGE_QUALITY=$VITE_POSE_IMAGE_QUALITY

COPY package.json package-lock.json ./
COPY apps/frontend/package.json apps/frontend/
COPY apps/backend/package.json apps/backend/
RUN npm ci --workspace=@physio/frontend --include-workspace-root

COPY apps/frontend apps/frontend
RUN npm run build --workspace=@physio/frontend


FROM nginx:1.27-alpine AS runtime
COPY --from=build /repo/apps/frontend/dist /usr/share/nginx/html

# The nginx image's entrypoint runs `envsubst` over
# /etc/nginx/templates/*.template at startup, substituting only variables that
# are actually set in the environment, then writes the result to
# /etc/nginx/conf.d/. So ${PORT} is filled in and nginx's own $-variables
# ($uri, $http_upgrade, ...) are left alone. PORT defaults to 80 here for a
# plain `docker run`; Railway overrides it at runtime.
ENV PORT=80
COPY apps/frontend/nginx.conf.template /etc/nginx/templates/default.conf.template

RUN apk add --no-cache curl
# EXPOSE is documentation only; Railway routes to whatever $PORT it assigned.
EXPOSE 80
