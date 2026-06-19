# Stage 1: Build client (Vite → static SPA)
FROM node:22-slim AS client-build
WORKDIR /build/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# Stage 2: Build server (tsc → dist)
FROM node:22-slim AS server-build
WORKDIR /build/server
COPY server/package*.json ./
RUN npm ci
COPY server/ ./
RUN npx tsc

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
EXPOSE 8000
CMD ["node", "dist/index.js"]
