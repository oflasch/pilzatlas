# Stage 1: Build static PWA assets (dist/) and bundle Express WFS proxy (server.mjs)
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json ./
RUN npm install --no-audit --no-fund

COPY index.html tsconfig.json vite.config.ts server.ts ./
COPY public ./public
COPY src ./src

# Build static React/Vite PWA bundle into /app/dist
RUN npm run build

# Bundle server.ts + OpenGeodata.NRW WFS proxy into a standalone ESM file
RUN npx esbuild server.ts \
  --bundle \
  --platform=node \
  --target=node22 \
  --format=esm \
  --packages=external \
  --outfile=server.mjs

# Stage 2: Minimal production runtime serving static PWA + /api/nrw/geodata proxy
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Install only the Express runtime needed by server.mjs (zero Vite/React/build tooling)
RUN npm init -y >/dev/null 2>&1 \
  && npm install --no-audit --no-fund express@^4.21.2 \
  && npm cache clean --force

COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/server.mjs ./server.mjs

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server.mjs"]
