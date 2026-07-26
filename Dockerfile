# Stage 1: Build server (tsc → dist). Built first so the client stage can reuse
# the server source tree + node_modules for its native offline chunk (below).
FROM node:22-slim AS server-build
WORKDIR /build/server
COPY server/package*.json ./
RUN npm ci
COPY server/ ./
RUN npx tsc

# Stage 2: Build client (Vite → static SPA)
FROM node:22-slim AS client-build
WORKDIR /build/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
# The native (Capacitor) offline chunk imports the reused server engine + wrappers
# + calibration data VERBATIM (hard rule 2) from ../server. The client build
# (tsc -p tsconfig.native.json + vite) type-checks and bundles them, so the whole
# built server tree — src, data, AND node_modules (pino/astronomy-engine types are
# resolved from there) — must be present at ../server. Web users never load the
# resulting engine chunk (it is code-split behind isNative()). See
# NATIVE_ALARM_SPEC.md §3b.
COPY --from=server-build /build/server /build/server
# Two independent bundles: the SPA (dist, also packaged into the Android APK by
# Capacitor) and the operator dashboard (dist-admin, web-only — see
# client/vite.admin.config.ts for why they are kept apart).
RUN npm run build && npm run build:admin

# Stage 3: Production
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
# Server compiled output + deps. node_modules is required at runtime because the
# engine loads astronomy-engine via createRequire (CJS) — not bundled.
COPY --from=server-build /build/server/dist ./dist
COPY --from=server-build /build/server/node_modules ./node_modules
COPY --from=server-build /build/server/package.json ./
# Offline GeoNames cities dataset (loaded once at boot). Resolves to /app/data.
COPY --from=server-build /build/server/data ./data
# Built client served as static SPA by Express.
COPY --from=client-build /build/client/dist ./static
# Admin dashboard, served at /admin (server/src/app.ts resolves ../static-admin).
COPY --from=client-build /build/client/dist-admin ./static-admin
EXPOSE 8000
CMD ["node", "dist/index.js"]
