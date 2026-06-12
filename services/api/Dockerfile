# ============================================================================
# AIpbx API — multi-stage build
# ============================================================================

# ---- Build stage ----------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app

# argon2 needs build toolchain for its native addon
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
RUN npm run build \
  && npm prune --omit=dev

# ---- Runtime stage --------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# non-root runtime
RUN useradd --system --uid 10001 --create-home appuser

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json

USER appuser
EXPOSE 3000

CMD ["node", "dist/index.js"]
