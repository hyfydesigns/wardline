import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import websocket from '@fastify/websocket';
import { config } from './config.js';
import { db, initSchema } from './db.js';
import { seedIfEmpty } from './seed.js';
import { authRoutes } from './routes/auth.js';
import { apiRoutes } from './routes/api.js';
import { ingestRoutes } from './routes/ingest.js';
import { policyRoutes } from './routes/policy.js';
import { householdRoutes } from './routes/household.js';
import { addConnection } from './realtime.js';

export interface BuildOptions {
  /** Quiet logging for tests. */
  logger?: boolean;
}

/**
 * Build the fully-wired Fastify app WITHOUT listening. Kept separate from the
 * entry point so tests can drive it with `app.inject()` — no ports, no races.
 */
export async function buildServer(opts: BuildOptions = {}): Promise<FastifyInstance> {
  initSchema();
  seedIfEmpty();

  const app = Fastify({
    logger: opts.logger === false ? false : { transport: undefined, level: 'info' },
  });

  await app.register(cors, { origin: config.corsOrigins, credentials: true });
  await app.register(jwt, { secret: config.jwtSecret });
  await app.register(websocket);

  // Parent-JWT auth guard used by protected routes. Membership is re-read from
  // the database on every request, so removing a co-parent revokes access
  // immediately rather than waiting for their token to expire.
  app.decorate('authenticate', async (req, reply) => {
    try {
      await req.jwtVerify();
      const parentId = (req.user as { parentId: string }).parentId;
      const row = db
        .prepare(`SELECT household_id AS householdId, role FROM parents WHERE id = ?`)
        .get(parentId) as { householdId: string | null; role: string } | undefined;
      if (!row?.householdId) {
        reply.code(401).send({ error: 'This account no longer has access.' });
        return;
      }
      req.parentId = parentId;
      req.householdId = row.householdId;
      req.parentRole = row.role;
    } catch {
      reply.code(401).send({ error: 'Not signed in.' });
    }
  });

  app.get('/health', async () => ({ ok: true, service: 'wardline-server' }));

  await app.register(authRoutes);
  await app.register(apiRoutes);
  await app.register(ingestRoutes);
  await app.register(policyRoutes);
  await app.register(householdRoutes);

  // Live alert stream. Token passed as a query param since browsers can't set
  // headers on a WebSocket handshake.
  app.register(async (scoped) => {
    scoped.get('/ws', { websocket: true }, (socket, req) => {
      const token = (req.query as { token?: string }).token ?? '';
      let parentId: string;
      try {
        parentId = scoped.jwt.verify<{ parentId: string }>(token).parentId;
      } catch {
        socket.close(1008, 'Invalid token');
        return;
      }
      // Subscribe by household, so every co-parent gets the same live alerts.
      const row = db.prepare(`SELECT household_id AS householdId FROM parents WHERE id = ?`).get(parentId) as
        | { householdId: string | null }
        | undefined;
      if (!row?.householdId) {
        socket.close(1008, 'No household');
        return;
      }
      addConnection(row.householdId, socket);
      socket.send(JSON.stringify({ type: 'hello', householdId: row.householdId }));
    });
  });

  return app;
}
