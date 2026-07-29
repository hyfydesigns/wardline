import type { FastifyInstance } from 'fastify';
import { processIngest, resolveDevice, type IngestEvent } from '../pipeline.js';

/**
 * Device-facing ingest. Authenticated by a per-device bearer token (issued at
 * enrolment), NOT the parent JWT. This is the only endpoint the Windows agent
 * and browser extensions call.
 */
export async function ingestRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/ingest', async (req, reply) => {
    const auth = req.headers.authorization ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const ctx = token ? resolveDevice(token) : null;
    if (!ctx) return reply.code(401).send({ error: 'Invalid or missing device token.' });

    const body = (req.body ?? {}) as { events?: IngestEvent[]; agentVersion?: string };
    if (!Array.isArray(body.events)) {
      return reply.code(400).send({ error: 'Body must include an events array.' });
    }
    const result = await processIngest(ctx, body.events, body.agentVersion);
    return { ok: true, ...result };
  });
}
