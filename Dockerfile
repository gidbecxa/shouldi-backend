# ── Stage 1: build ────────────────────────────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Remove dev dependencies so the final layer is lean
RUN npm prune --omit=dev

# ── Stage 2: production image ──────────────────────────────────────────────────
FROM node:20-slim AS runner

# @napi-rs/canvas pre-built binary needs libfontconfig at runtime for
# font resolution when drawing the share-card PNG.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libfontconfig1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/dist        ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

ENV NODE_ENV=production

# Railway injects PORT automatically; default kept for local docker run.
EXPOSE 5000

CMD ["node", "dist/main.js"]
