import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { newToken } from '../auth.js';

const DAY_MS = 86_400_000;

function dayStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function lastNDays(n: number): string[] {
  const out: string[] = [];
  const now = Date.now();
  for (let i = n - 1; i >= 0; i--) out.push(dayStr(new Date(now - i * DAY_MS)));
  return out;
}
function ownsChild(householdId: string, childId: string): boolean {
  return !!db.prepare(`SELECT 1 FROM children WHERE id = ? AND household_id = ?`).get(childId, householdId);
}

export async function apiRoutes(app: FastifyInstance): Promise<void> {
  // Everything here requires a valid parent JWT.
  app.addHook('preHandler', app.authenticate);

  /** Sidebar + Overview: children with live status, today's minutes, open alerts, 7-day spark. */
  app.get('/api/children', async (req) => {
    const householdId = req.householdId;
    const today = dayStr(new Date());
    const days = lastNDays(7);
    const children = db
      .prepare(`SELECT id, name, color, screen_limit_min FROM children WHERE household_id = ? ORDER BY rowid`)
      .all(householdId) as { id: string; name: string; color: string; screen_limit_min: number }[];

    return children.map((c) => {
      const device = db
        .prepare(`SELECT name, last_seen, tamper_status FROM devices WHERE child_id = ? LIMIT 1`)
        .get(c.id) as { name: string; last_seen: string | null; tamper_status: string } | undefined;
      const todayMin = (db.prepare(`SELECT minutes FROM screen_time WHERE child_id = ? AND day = ?`).get(c.id, today) as { minutes: number } | undefined)?.minutes ?? 0;
      const openAlerts = (db.prepare(`SELECT COUNT(*) AS n FROM alerts WHERE child_id = ? AND status = 'open'`).get(c.id) as { n: number }).n;
      const blockedToday = (db.prepare(
        `SELECT COUNT(*) AS n FROM events e JOIN devices d ON d.id = e.device_id
         WHERE d.child_id = ? AND e.kind = 'blocked' AND substr(e.occurred_at, 1, 10) = ?`,
      ).get(c.id, today) as { n: number }).n;
      const spark = days.map((day) => (db.prepare(`SELECT minutes FROM screen_time WHERE child_id = ? AND day = ?`).get(c.id, day) as { minutes: number } | undefined)?.minutes ?? 0);
      const online = device?.last_seen ? Date.now() - new Date(device.last_seen).getTime() < 5 * 60_000 : false;
      return {
        id: c.id,
        name: c.name,
        color: c.color,
        limitMin: c.screen_limit_min,
        todayMin,
        openAlerts,
        blockedToday,
        spark,
        device: device ? { name: device.name, online, lastSeen: device.last_seen, tamper: device.tamper_status } : null,
      };
    });
  });

  /** Alerts list, optionally filtered by child + severity. */
  app.get('/api/alerts', async (req) => {
    const householdId = req.householdId;
    const { childId, severity } = req.query as { childId?: string; severity?: string };
    const clauses = [`c.household_id = @householdId`];
    const params: Record<string, string> = { householdId };
    if (childId) {
      clauses.push(`a.child_id = @childId`);
      params.childId = childId;
    }
    if (severity && severity !== 'all') {
      clauses.push(`a.severity = @severity`);
      params.severity = severity;
    }
    const rows = db
      .prepare(
        `SELECT a.id, a.child_id AS childId, ch.name AS childName, ch.color AS childColor,
                a.category, a.severity, a.confidence, a.label, a.snippet, a.source,
                a.occurred_at AS occurredAt, a.status, d.name AS deviceName
         FROM alerts a
         JOIN children ch ON ch.id = a.child_id
         JOIN children c ON c.id = a.child_id
         JOIN devices d ON d.id = a.device_id
         WHERE ${clauses.join(' AND ')}
         ORDER BY a.occurred_at DESC
         LIMIT 200`,
      )
      .all(params);

    const counts = db
      .prepare(
        `SELECT a.severity AS severity, COUNT(*) AS n
         FROM alerts a JOIN children c ON c.id = a.child_id
         WHERE c.household_id = ? GROUP BY a.severity`,
      )
      .all(householdId) as { severity: string; n: number }[];
    const bySeverity = { critical: 0, concerning: 0, informational: 0 } as Record<string, number>;
    for (const r of counts) bySeverity[r.severity] = r.n;

    return { alerts: rows, counts: { ...bySeverity, all: rows.length } };
  });

  /** Update an alert's status: reviewed | dismissed | false_positive. */
  app.post('/api/alerts/:id/status', async (req, reply) => {
    const householdId = req.householdId;
    const { id } = req.params as { id: string };
    const { status } = (req.body ?? {}) as { status?: string };
    const allowed = ['open', 'reviewed', 'dismissed', 'false_positive'];
    if (!status || !allowed.includes(status)) {
      return reply.code(400).send({ error: `status must be one of ${allowed.join(', ')}` });
    }
    const owned = db
      .prepare(`SELECT 1 FROM alerts a JOIN children c ON c.id = a.child_id WHERE a.id = ? AND c.household_id = ?`)
      .get(id, householdId);
    if (!owned) return reply.code(404).send({ error: 'Alert not found.' });
    db.prepare(`UPDATE alerts SET status = ? WHERE id = ?`).run(status, id);
    return { id, status };
  });

  /** Reports: screen-time trend for the last N days, one series per child. */
  app.get('/api/reports/screen-time', async (req) => {
    const householdId = req.householdId;
    const n = Math.min(30, Math.max(1, Number((req.query as { days?: string }).days ?? 7)));
    const days = lastNDays(n);
    const children = db
      .prepare(`SELECT id, name, color FROM children WHERE household_id = ? ORDER BY rowid`)
      .all(householdId) as { id: string; name: string; color: string }[];
    const series = children.map((c) => ({
      childId: c.id,
      name: c.name,
      color: c.color,
      values: days.map((day) => (db.prepare(`SELECT minutes FROM screen_time WHERE child_id = ? AND day = ?`).get(c.id, day) as { minutes: number } | undefined)?.minutes ?? 0),
    }));
    return { days, series };
  });

  /** Reports: category breakdown for one child over the last N days. */
  app.get('/api/reports/categories', async (req, reply) => {
    const householdId = req.householdId;
    const { childId } = req.query as { childId?: string; days?: string };
    const n = Math.min(30, Math.max(1, Number((req.query as { days?: string }).days ?? 7)));
    if (!childId || !ownsChild(householdId, childId)) return reply.code(404).send({ error: 'Unknown child.' });
    const since = dayStr(new Date(Date.now() - (n - 1) * DAY_MS));
    const rows = db
      .prepare(`SELECT category, SUM(minutes) AS minutes FROM usage WHERE child_id = ? AND day >= ? GROUP BY category ORDER BY minutes DESC`)
      .all(childId, since) as { category: string; minutes: number }[];
    const total = rows.reduce((s, r) => s + r.minutes, 0) || 1;
    return rows.map((r) => ({ category: r.category, minutes: r.minutes, pct: Math.round((r.minutes / total) * 100) }));
  });

  /** Reports: alert volume by severity per week for the last N weeks. */
  app.get('/api/reports/alerts-by-severity', async (req) => {
    const householdId = req.householdId;
    const weeks = Math.min(12, Math.max(1, Number((req.query as { weeks?: string }).weeks ?? 4)));
    const out: { week: string; critical: number; concerning: number; informational: number }[] = [];
    for (let w = weeks - 1; w >= 0; w--) {
      const end = Date.now() - w * 7 * DAY_MS;
      const start = end - 7 * DAY_MS;
      const startStr = dayStr(new Date(start));
      const endStr = dayStr(new Date(end));
      const rows = db
        .prepare(
          `SELECT a.severity AS severity, COUNT(*) AS n
           FROM alerts a JOIN children c ON c.id = a.child_id
           WHERE c.household_id = ? AND a.occurred_at >= ? AND a.occurred_at < ?
           GROUP BY a.severity`,
        )
        .all(householdId, startStr, endStr) as { severity: string; n: number }[];
      const bucket = { critical: 0, concerning: 0, informational: 0 } as Record<string, number>;
      for (const r of rows) bucket[r.severity] = r.n;
      out.push({ week: `Wk ${weeks - w}`, ...(bucket as { critical: number; concerning: number; informational: number }) });
    }
    return out;
  });

  /** Devices table. */
  app.get('/api/devices', async (req) => {
    const householdId = req.householdId;
    return db
      .prepare(
        `SELECT d.id, d.name, d.agent_version AS agentVersion, d.browser_coverage AS browserCoverage,
                d.tamper_status AS tamperStatus, d.last_seen AS lastSeen, ch.name AS childName, ch.color AS childColor
         FROM devices d JOIN children ch ON ch.id = d.child_id
         WHERE ch.household_id = ? ORDER BY ch.rowid`,
      )
      .all(householdId)
      .map((d) => {
        const row = d as { lastSeen: string | null };
        return { ...d, online: row.lastSeen ? Date.now() - new Date(row.lastSeen).getTime() < 5 * 60_000 : false };
      });
  });

  /**
   * Enrol a new Windows PC. Mints the device token the installer consumes —
   * this is what "Add a device" in the dashboard hands the parent.
   */
  app.post('/api/devices', async (req, reply) => {
    const householdId = req.householdId;
    const { childId, name } = (req.body ?? {}) as { childId?: string; name?: string };
    const deviceName = (name ?? '').trim();

    if (!childId || !ownsChild(householdId, childId)) {
      return reply.code(404).send({ error: 'Choose a child in your household.' });
    }
    if (!/^[\w .-]{2,40}$/.test(deviceName)) {
      return reply.code(400).send({ error: 'Give the PC a name (2–40 characters).' });
    }
    if (db.prepare(`SELECT 1 FROM devices d JOIN children c ON c.id = d.child_id WHERE c.household_id = ? AND d.name = ?`).get(householdId, deviceName)) {
      return reply.code(409).send({ error: 'A device with that name already exists.' });
    }

    const id = `d_${randomUUID().slice(0, 8)}`;
    const deviceToken = `wl-${newToken(18)}`;
    db.prepare(
      `INSERT INTO devices (id, child_id, name, agent_version, device_token, browser_coverage, tamper_status, last_seen)
       VALUES (?, ?, ?, 'not yet installed', ?, 'awaiting first check-in', 'ok', NULL)`,
    ).run(id, childId, deviceName, deviceToken);

    return { id, name: deviceName, childId, deviceToken };
  });

  /**
   * Mint a fresh device key for an existing device — the one-time reveal on
   * creation is easy to miss, and the key is never shown again otherwise.
   * Invalidates the previous key immediately, so a device already installed
   * with the old one will need reinstalling/reconfiguring with the new one.
   */
  app.post('/api/devices/:id/regenerate', async (req, reply) => {
    const householdId = req.householdId;
    const { id } = req.params as { id: string };
    const device = db
      .prepare(`SELECT d.id, d.name FROM devices d JOIN children c ON c.id = d.child_id WHERE d.id = ? AND c.household_id = ?`)
      .get(id, householdId) as { id: string; name: string } | undefined;
    if (!device) return reply.code(404).send({ error: 'Device not found.' });

    const deviceToken = `wl-${newToken(18)}`;
    db.prepare(`UPDATE devices SET device_token = ? WHERE id = ?`).run(deviceToken, id);
    return { id: device.id, name: device.name, deviceToken };
  });

  /**
   * Remove a device. Its key stops authenticating immediately; a still-
   * installed agent/extension just gets 401s from then on rather than being
   * told to uninstall. Events and alerts it produced are cascade-deleted
   * (ON DELETE CASCADE); screen-time/usage are per-child aggregates, not
   * per-device, so they're unaffected.
   */
  app.delete('/api/devices/:id', async (req, reply) => {
    const householdId = req.householdId;
    const { id } = req.params as { id: string };
    const device = db
      .prepare(`SELECT d.id FROM devices d JOIN children c ON c.id = d.child_id WHERE d.id = ? AND c.household_id = ?`)
      .get(id, householdId);
    if (!device) return reply.code(404).send({ error: 'Device not found.' });

    db.prepare(`DELETE FROM devices WHERE id = ?`).run(id);
    return { ok: true };
  });

  /** Household schedule blocks. */
  app.get('/api/schedules', async (req) => {
    const householdId = req.householdId;
    return db
      .prepare(`SELECT id, name, kind, days, start_min AS startMin, end_min AS endMin, scope FROM schedules WHERE household_id = ? ORDER BY start_min`)
      .all(householdId)
      .map((s) => {
        const row = s as { days: string };
        return { ...s, days: row.days.split(',').filter(Boolean).map(Number) };
      });
  });

  /** Settings read/write (filters, safe search, screenshots, notifications, sensitivity). */
  app.get('/api/settings', async (req) => {
    const householdId = req.householdId;
    const row = db.prepare(`SELECT settings_json FROM households WHERE id = ?`).get(householdId) as { settings_json: string } | undefined;
    return row ? JSON.parse(row.settings_json) : {};
  });

  app.put('/api/settings', async (req) => {
    const householdId = req.householdId;
    const current = JSON.parse((db.prepare(`SELECT settings_json FROM households WHERE id = ?`).get(householdId) as { settings_json: string }).settings_json);
    const merged = { ...current, ...(req.body as object) };
    db.prepare(`UPDATE households SET settings_json = ? WHERE id = ?`).run(JSON.stringify(merged), householdId);
    return merged;
  });
}
