import '@fastify/jwt';
import type { FastifyRequest, FastifyReply } from 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    /** Set by the authenticate hook from the verified JWT. */
    parentId: string;
    /** The household this parent belongs to — the real scope for all data. */
    householdId: string;
    /** 'owner' | 'parent' — resolved fresh from the DB on every request. */
    parentRole: string;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    // tokenVersion is optional so tokens minted before this field existed
    // still verify — the authenticate hook only checks it when present.
    payload: { parentId: string; tokenVersion?: number };
    user: { parentId: string; tokenVersion?: number };
  }
}
