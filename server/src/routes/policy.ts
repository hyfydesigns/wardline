import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { resolveDevice } from '../pipeline.js';
import { computeActiveBlock, type Schedule } from '../policyLogic.js';

/**
 * Device-facing policy downlink. The agent and browser extension poll this to
 * learn what to enforce: category filters, custom block/allow lists, SafeSearch,
 * and — crucially — `activeBlock`, a server-computed "is the internet supposed
 * to be off right now" flag derived from the household schedule and the child's
 * screen-time limit. The device doesn't reason about schedules; it trusts this.
 */
export async function policyRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Minimal identity check for a device token — used by the installer's
   * "Test Connection" button to confirm the key actually works before the
   * parent finishes setup, instead of finding out days later that it didn't.
   */
  app.get('/api/devices/whoami', async (req, reply) => {
    const auth = req.headers.authorization ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const ctx = token ? resolveDevice(token) : null;
    if (!ctx) return reply.code(401).send({ error: 'Invalid or missing device token.' });

    const row = db
      .prepare(`SELECT d.name AS deviceName, c.name AS childName FROM devices d JOIN children c ON c.id = d.child_id WHERE d.id = ?`)
      .get(ctx.deviceId) as { deviceName: string; childName: string };
    return row;
  });

  app.get('/api/policy', async (req, reply) => {
    const auth = req.headers.authorization ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const ctx = token ? resolveDevice(token) : null;
    if (!ctx) return reply.code(401).send({ error: 'Invalid or missing device token.' });

    const household = db.prepare(`SELECT settings_json FROM households WHERE id = ?`).get(ctx.householdId) as { settings_json: string };
    const settings = JSON.parse(household.settings_json) as {
      filters?: Record<string, boolean>;
      safeSearch?: boolean;
      customBlocked?: string[];
      customAllowed?: string[];
    };

    const schedules = db
      .prepare(`SELECT name, kind, days, start_min AS startMin, end_min AS endMin, scope FROM schedules WHERE household_id = ? ORDER BY start_min`)
      .all(ctx.householdId)
      .map((s) => {
        const row = s as { days: string };
        return { ...s, days: row.days.split(',').filter(Boolean).map(Number) } as Schedule;
      });

    const child = db.prepare(`SELECT screen_limit_min AS limitMin FROM children WHERE id = ?`).get(ctx.childId) as { limitMin: number };
    const today = new Date().toISOString().slice(0, 10);
    const usedTodayMin = (db.prepare(`SELECT minutes FROM screen_time WHERE child_id = ? AND day = ?`).get(ctx.childId, today) as { minutes: number } | undefined)?.minutes ?? 0;
    const exceeded = usedTodayMin >= child.limitMin;

    // Compute the active block right now (schedule window or screen-time cap).
    const now = new Date();
    const { activeBlock, minuteOfDay, dayOfWeek } = computeActiveBlock(schedules, child.limitMin, usedTodayMin, now);

    const policy = {
      filters: {
        adult: settings.filters?.adult ?? true,
        gambling: settings.filters?.gambling ?? true,
        social: settings.filters?.social ?? false,
        gaming: settings.filters?.gaming ?? false,
        streaming: settings.filters?.streaming ?? false,
      },
      safeSearch: settings.safeSearch ?? true,
      blocked: settings.customBlocked ?? [],
      allowed: settings.customAllowed ?? [],
      schedules,
      screenTime: { limitMin: child.limitMin, usedTodayMin, exceeded },
      server: { iso: now.toISOString(), minuteOfDay, dayOfWeek },
      activeBlock,
    };

    // A version hash lets the device skip re-applying an unchanged policy.
    const policyVersion = createHash('sha1')
      .update(JSON.stringify({ f: policy.filters, s: policy.safeSearch, b: policy.blocked, a: policy.allowed, sc: policy.schedules, l: child.limitMin }))
      .digest('hex')
      .slice(0, 12);

    return { policyVersion, ...policy };
  });
}
