import type { WebSocket } from '@fastify/websocket';

/**
 * In-memory registry of live dashboard sockets, keyed by HOUSEHOLD id — so an
 * alert reaches every co-parent watching, not just the one whose device
 * reported it. In production this would be a pub/sub fan-out (Redis) so it
 * survives multiple server instances; for the MVP a per-process map is enough.
 */
const connections = new Map<string, Set<WebSocket>>();

export function addConnection(householdId: string, socket: WebSocket): void {
  let set = connections.get(householdId);
  if (!set) {
    set = new Set();
    connections.set(householdId, set);
  }
  set.add(socket);
  socket.on('close', () => {
    set!.delete(socket);
    if (set!.size === 0) connections.delete(householdId);
  });
}

/** Push a JSON message to every live dashboard in one household. */
export function broadcast(householdId: string, message: unknown): void {
  const set = connections.get(householdId);
  if (!set) return;
  const payload = JSON.stringify(message);
  for (const socket of set) {
    try {
      socket.send(payload);
    } catch {
      /* socket mid-close; ignore */
    }
  }
}
