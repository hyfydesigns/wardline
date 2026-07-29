import { randomUUID } from 'node:crypto';
import {
  createClassifier,
  SENSITIVITY_THRESHOLDS,
  type MonitoredEvent,
  type RiskClassifier,
} from '@wardline/classifier';
import { db } from './db.js';
import { broadcast } from './realtime.js';

/** Ingest payload from a device — a superset of MonitoredEvent. */
export interface IngestEvent extends Partial<MonitoredEvent> {
  eventId: string;
  occurredAt: string;
  source: string;
  kind: string;
  text?: string;
  url?: string;
  /** Only present on kind='usage' rollups. */
  category?: string;
  minutes?: number;
}

// Cache one classifier per sensitivity threshold.
const classifiers = new Map<number, RiskClassifier>();
function classifierFor(threshold: number): RiskClassifier {
  let c = classifiers.get(threshold);
  if (!c) {
    c = createClassifier({ threshold });
    classifiers.set(threshold, c);
  }
  return c;
}

/** No single reported sample may exceed this many minutes of screen time. */
const MAX_USAGE_MINUTES_PER_EVENT = 120;

/** While a device stays tampered, re-remind the parent at most this often. */
const TAMPER_REMINDER_MS = 6 * 60 * 60 * 1000;

type IntegritySignal = { status: 'tampered'; reason: string } | { status: 'ok' } | null;

/**
 * Interpret a device's integrity heartbeat. The agent reports every watchdog
 * cycle: `kind: 'tamper'` with a reason when something is wrong, or
 * `kind: 'integrity_ok'` when checks pass. (`kind: 'system'` + "TAMPER:" prefix
 * is accepted for older agents.) Returns null if this isn't an integrity event.
 */
function integritySignalOf(ev: IngestEvent): IntegritySignal {
  const text = (ev.text ?? '').replace(/^TAMPER:\s*/i, '');
  if (ev.kind === 'tamper') return { status: 'tampered', reason: text || 'Integrity check failed' };
  if (ev.kind === 'integrity_ok') return { status: 'ok' };
  if (ev.kind === 'system' && /^TAMPER:/i.test(ev.text ?? '')) return { status: 'tampered', reason: text };
  return null;
}

/** Persist a tamper/restore alert and push it to live dashboards. Returns 1. */
function raiseTamperAlert(
  ctx: DeviceContext,
  ev: IngestEvent,
  severity: 'critical' | 'informational',
  label: string,
  snippet: string,
): number {
  db.prepare(
    `INSERT OR IGNORE INTO events (id, device_id, occurred_at, source, kind, host) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(ev.eventId, ctx.deviceId, ev.occurredAt, ev.source, ev.kind, null);
  const id = randomUUID();
  db.prepare(
    `INSERT INTO alerts (id, child_id, device_id, event_id, category, severity, confidence, label, snippet, source, occurred_at, status)
     VALUES (?, ?, ?, ?, 'tamper', ?, NULL, ?, ?, ?, ?, 'open')`,
  ).run(id, ctx.childId, ctx.deviceId, ev.eventId, severity, label, snippet, ev.source, ev.occurredAt);
  broadcast(ctx.householdId, {
    type: 'alert',
    alert: { id, childId: ctx.childId, category: 'tamper', severity, confidence: null, label, snippet, source: ev.source, occurredAt: ev.occurredAt, status: 'open' },
  });
  return 1;
}

function hostOf(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).host;
  } catch {
    return url.slice(0, 80);
  }
}

function today(occurredAt: string): string {
  return occurredAt.slice(0, 10); // YYYY-MM-DD
}

interface DeviceContext {
  deviceId: string;
  childId: string;
  householdId: string;
  sensitivity: keyof typeof SENSITIVITY_THRESHOLDS;
}

/** Resolve device → child → household and the household's sensitivity setting. */
export function resolveDevice(deviceToken: string): DeviceContext | null {
  const row = db
    .prepare(
      `SELECT d.id AS deviceId, c.id AS childId, h.id AS householdId, h.settings_json AS settings
       FROM devices d
       JOIN children c ON c.id = d.child_id
       JOIN households h ON h.id = c.household_id
       WHERE d.device_token = ?`,
    )
    .get(deviceToken) as
    | { deviceId: string; childId: string; householdId: string; settings: string }
    | undefined;
  if (!row) return null;
  let sensitivity: keyof typeof SENSITIVITY_THRESHOLDS = 'balanced';
  try {
    const s = JSON.parse(row.settings)?.alerts?.sensitivity;
    if (s && s in SENSITIVITY_THRESHOLDS) sensitivity = s;
  } catch {
    /* default */
  }
  return { deviceId: row.deviceId, childId: row.childId, householdId: row.householdId, sensitivity };
}

export interface IngestResult {
  accepted: number;
  alerts: number;
}

/**
 * Core loop: classify risk events, store minimal telemetry, roll up usage,
 * create alerts (idempotent on eventId), and push new alerts to live
 * dashboards.
 */
export async function processIngest(ctx: DeviceContext, events: IngestEvent[], agentVersion?: string): Promise<IngestResult> {
  const classifier = classifierFor(SENSITIVITY_THRESHOLDS[ctx.sensitivity]);
  const now = new Date().toISOString();
  let alerts = 0;

  db.prepare(`UPDATE devices SET last_seen = ? WHERE id = ?`).run(now, ctx.deviceId);
  // The Windows agent reports its own version on every check-in; the browser
  // extension doesn't, so this only ever moves off "not yet installed" once
  // the .NET agent (not just the extension) has actually connected.
  if (agentVersion) {
    db.prepare(`UPDATE devices SET agent_version = ? WHERE id = ?`).run(`v${agentVersion}`, ctx.deviceId);
  }

  const insertEvent = db.prepare(
    `INSERT OR IGNORE INTO events (id, device_id, occurred_at, source, kind, host)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const alreadyAlerted = db.prepare(`SELECT 1 FROM alerts WHERE event_id = ?`);
  const insertAlert = db.prepare(
    `INSERT INTO alerts (id, child_id, device_id, event_id, category, severity, confidence, label, snippet, source, occurred_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')`,
  );
  const upsertScreen = db.prepare(
    `INSERT INTO screen_time (child_id, day, minutes) VALUES (?, ?, ?)
     ON CONFLICT(child_id, day) DO UPDATE SET minutes = minutes + excluded.minutes`,
  );
  const upsertUsage = db.prepare(
    `INSERT INTO usage (child_id, day, category, minutes) VALUES (?, ?, ?, ?)
     ON CONFLICT(child_id, day, category) DO UPDATE SET minutes = minutes + excluded.minutes`,
  );

  for (const ev of events) {
    // Usage rollups: no classification, just aggregate time. Clamped so a
    // buggy or hostile agent can't inflate a day beyond what's plausible.
    if (ev.kind === 'usage') {
      const day = today(ev.occurredAt);
      const minutes = Math.min(MAX_USAGE_MINUTES_PER_EVENT, Math.max(0, Math.round(ev.minutes ?? 0)));
      if (minutes > 0) {
        upsertScreen.run(ctx.childId, day, minutes);
        upsertUsage.run(ctx.childId, day, ev.category ?? 'Other', minutes);
      }
      continue;
    }

    // Integrity heartbeats bypass the risk classifier entirely: they must
    // always reach the parent, never depend on matching a language rule. But
    // they alert only on a *change* of state — becoming tampered, the reason
    // changing, or a periodic reminder while still tampered — so a device that
    // sits in one state doesn't spam an identical alert every cycle.
    const integrity = integritySignalOf(ev);
    if (integrity) {
      const prev = (db.prepare(`SELECT tamper_status FROM devices WHERE id = ?`).get(ctx.deviceId) as { tamper_status: string }).tamper_status;

      if (integrity.status === 'tampered') {
        const last = db
          .prepare(`SELECT snippet, occurred_at FROM alerts WHERE device_id = ? AND category = 'tamper' AND severity = 'critical' ORDER BY occurred_at DESC LIMIT 1`)
          .get(ctx.deviceId) as { snippet: string | null; occurred_at: string } | undefined;
        const isTransition = prev !== 'tampered';
        const reasonChanged = !!last && last.snippet !== integrity.reason;
        const stale = !!last && Date.now() - new Date(last.occurred_at).getTime() > TAMPER_REMINDER_MS;

        db.prepare(`UPDATE devices SET tamper_status = 'tampered' WHERE id = ?`).run(ctx.deviceId);

        if (isTransition || reasonChanged || stale) {
          alerts += raiseTamperAlert(ctx, ev, 'critical', 'Protection tampered with', integrity.reason);
        }
        continue;
      }

      // integrity.status === 'ok' — only meaningful as a transition back.
      if (prev === 'tampered') {
        db.prepare(`UPDATE devices SET tamper_status = 'ok' WHERE id = ?`).run(ctx.deviceId);
        alerts += raiseTamperAlert(ctx, ev, 'informational', 'Protection restored', 'Integrity checks are passing again on this device.');
      }
      continue;
    }

    // Enforcement telemetry: a site the device blocked. Stored for the
    // "blocked today" count; never classified (there's no content to judge).
    if (ev.kind === 'blocked') {
      insertEvent.run(ev.eventId, ctx.deviceId, ev.occurredAt, ev.source, 'blocked', hostOf(ev.url) ?? null);
      continue;
    }

    insertEvent.run(ev.eventId, ctx.deviceId, ev.occurredAt, ev.source, ev.kind, hostOf(ev.url) ?? null);

    const verdict = await classifier.classify({
      eventId: ev.eventId,
      deviceId: ctx.deviceId,
      occurredAt: ev.occurredAt,
      source: ev.source,
      url: ev.url,
      text: ev.text ?? '',
      kind: ev.kind,
    });

    if (!verdict.flagged || !verdict.category) continue;
    if (alreadyAlerted.get(ev.eventId)) continue; // idempotent re-sync

    const alertId = randomUUID();
    insertAlert.run(
      alertId,
      ctx.childId,
      ctx.deviceId,
      ev.eventId,
      verdict.category,
      verdict.severity ?? 'informational',
      verdict.confidence ?? null,
      verdict.label ?? verdict.category,
      verdict.snippet ?? null,
      ev.source,
      ev.occurredAt,
    );
    alerts++;

    broadcast(ctx.householdId, {
      type: 'alert',
      alert: {
        id: alertId,
        childId: ctx.childId,
        category: verdict.category,
        severity: verdict.severity,
        confidence: verdict.confidence,
        label: verdict.label,
        snippet: verdict.snippet,
        source: ev.source,
        occurredAt: ev.occurredAt,
        status: 'open',
      },
    });
  }

  return { accepted: events.length, alerts };
}
