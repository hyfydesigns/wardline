# Wardline API — Fastify + built-in node:sqlite, run via tsx (no build step).
# Node 22 is required for node:sqlite.
FROM node:22-slim

WORKDIR /app

# Install dependencies first for better layer caching. Copy every workspace's
# manifest, then the lockfile-driven install.
COPY package.json package-lock.json ./
COPY classifier/package.json ./classifier/
COPY server/package.json ./server/
COPY agent-sim/package.json ./agent-sim/
COPY web/package.json ./web/
RUN npm ci

# Application source (node_modules and secrets excluded via .dockerignore).
COPY . .

# Container defaults. The platform injects PORT; the server reads process.env.PORT.
# HOST must be 0.0.0.0 so the service is reachable outside the container.
# NODE_ENV=production activates the JWT-secret guard — JWT_SECRET must be set.
ENV NODE_ENV=production
ENV HOST=0.0.0.0

# DB_PATH should point at a mounted volume (e.g. /data/wardline.db) so the
# SQLite database survives restarts and redeploys.

# tsx is a runtime dependency here (it executes the TypeScript entry point).
CMD ["npm", "run", "start", "-w", "server"]
