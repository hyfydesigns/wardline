import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';

/**
 * Thin wrapper over Node's built-in SQLite (no native build step). The schema
 * is created on first boot. Data minimisation is visible in the schema: the
 * `events` table never stores page/message text — only alerts keep a short,
 * classifier-produced snippet.
 */
export const db = new DatabaseSync(config.dbPath);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

export function initSchema(): void {
  db.exec(`
    -- A household is what children, schedules, and settings actually belong to.
    -- One or more parent accounts (co-parents) share it.
    CREATE TABLE IF NOT EXISTS households (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      plan          TEXT NOT NULL DEFAULT 'family',
      settings_json TEXT NOT NULL DEFAULT '{}',
      created_at    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS invitations (
      id           TEXT PRIMARY KEY,
      household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
      email        TEXT NOT NULL,
      token        TEXT UNIQUE NOT NULL,
      role         TEXT NOT NULL DEFAULT 'parent',
      invited_by   TEXT NOT NULL,
      created_at   TEXT NOT NULL,
      expires_at   TEXT NOT NULL,
      accepted_at  TEXT
    );

    CREATE TABLE IF NOT EXISTS parents (
      id            TEXT PRIMARY KEY,
      email         TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name          TEXT NOT NULL,
      plan          TEXT NOT NULL DEFAULT 'family',
      settings_json TEXT NOT NULL DEFAULT '{}',
      created_at    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS children (
      id                    TEXT PRIMARY KEY,
      parent_id             TEXT NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
      name                  TEXT NOT NULL,
      color                 TEXT NOT NULL DEFAULT 'marcus',
      screen_limit_min      INTEGER NOT NULL DEFAULT 240
    );

    CREATE TABLE IF NOT EXISTS devices (
      id               TEXT PRIMARY KEY,
      child_id         TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
      name             TEXT NOT NULL,
      agent_version    TEXT NOT NULL DEFAULT 'v1.4.2',
      device_token     TEXT UNIQUE NOT NULL,
      browser_coverage TEXT NOT NULL DEFAULT 'Chrome, Edge — active',
      tamper_status    TEXT NOT NULL DEFAULT 'ok',
      last_seen        TEXT
    );

    -- Minimal event log. NO page/message text is ever stored here.
    CREATE TABLE IF NOT EXISTS events (
      id          TEXT PRIMARY KEY,
      device_id   TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
      occurred_at TEXT NOT NULL,
      source      TEXT NOT NULL,
      kind        TEXT NOT NULL,
      host        TEXT
    );

    CREATE TABLE IF NOT EXISTS alerts (
      id          TEXT PRIMARY KEY,
      child_id    TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
      device_id   TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
      event_id    TEXT,
      category    TEXT NOT NULL,
      severity    TEXT NOT NULL,
      confidence  REAL,
      label       TEXT NOT NULL,
      snippet     TEXT,
      source      TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'open'
    );

    -- Aggregated screen-time minutes per child per day (for reports/overview).
    CREATE TABLE IF NOT EXISTS screen_time (
      child_id TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
      day      TEXT NOT NULL,
      minutes  INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (child_id, day)
    );

    -- Category usage minutes per child per day ("where the time went").
    CREATE TABLE IF NOT EXISTS usage (
      child_id TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
      day      TEXT NOT NULL,
      category TEXT NOT NULL,
      minutes  INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (child_id, day, category)
    );

    -- Email-ownership proof for signup. A verified account isn't gated from
    -- anything (see server/src/routes/verification.ts) — it's informational,
    -- surfaced as a dashboard banner and a Settings row.
    CREATE TABLE IF NOT EXISTS email_verifications (
      id          TEXT PRIMARY KEY,
      parent_id   TEXT NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
      token       TEXT UNIQUE NOT NULL,
      created_at  TEXT NOT NULL,
      expires_at  TEXT NOT NULL,
      verified_at TEXT
    );

    -- Single-use, expiring password-reset tokens.
    CREATE TABLE IF NOT EXISTS password_resets (
      id         TEXT PRIMARY KEY,
      parent_id  TEXT NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
      token      TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at    TEXT
    );

    CREATE TABLE IF NOT EXISTS schedules (
      id        TEXT PRIMARY KEY,
      parent_id TEXT NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
      name      TEXT NOT NULL,
      kind      TEXT NOT NULL DEFAULT 'school',
      days      TEXT NOT NULL,        -- CSV of 0..6 (Mon..Sun)
      start_min INTEGER NOT NULL,     -- minutes from midnight
      end_min   INTEGER NOT NULL,
      scope     TEXT NOT NULL DEFAULT 'all internet'
    );

    CREATE INDEX IF NOT EXISTS idx_alerts_child ON alerts(child_id, occurred_at);
    CREATE INDEX IF NOT EXISTS idx_events_device ON events(device_id, occurred_at);
  `);

  addColumnIfMissing('parents', 'totp_secret', 'TEXT');
  addColumnIfMissing('parents', 'totp_enabled', 'INTEGER NOT NULL DEFAULT 0');
  // Bumped on password reset so any JWT minted before the reset stops
  // authenticating, even though the token itself hasn't expired yet.
  addColumnIfMissing('parents', 'token_version', 'INTEGER NOT NULL DEFAULT 1');

  const justAddedEmailVerified = addColumnIfMissing('parents', 'email_verified', 'INTEGER NOT NULL DEFAULT 0');
  if (justAddedEmailVerified) {
    // Grandfather every account that existed before this column shipped —
    // don't retroactively "unverify" people who already had working accounts.
    db.exec(`UPDATE parents SET email_verified = 1`);
  }

  migrateToHouseholds();
}

/**
 * Move an original single-parent database onto the household model without
 * losing data: every parent that isn't in a household yet gets one, and their
 * children, schedules, and settings move across. Idempotent — a database that
 * has already been migrated is left alone.
 *
 * The legacy `parent_id` columns are kept (still populated) so an older build
 * pointed at the same file keeps working; all reads now go via household_id.
 */
function migrateToHouseholds(): void {
  addColumnIfMissing('parents', 'household_id', 'TEXT');
  addColumnIfMissing('parents', 'role', "TEXT NOT NULL DEFAULT 'owner'");
  addColumnIfMissing('children', 'household_id', 'TEXT');
  addColumnIfMissing('schedules', 'household_id', 'TEXT');

  const orphans = db
    .prepare(`SELECT id, name, plan, settings_json, created_at FROM parents WHERE household_id IS NULL`)
    .all() as { id: string; name: string; plan: string; settings_json: string; created_at: string }[];

  for (const parent of orphans) {
    const householdId = `hh_${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO households (id, name, plan, settings_json, created_at) VALUES (?, ?, ?, ?, ?)`,
    ).run(householdId, `${parent.name}'s household`, parent.plan, parent.settings_json, parent.created_at);

    db.prepare(`UPDATE parents SET household_id = ?, role = 'owner' WHERE id = ?`).run(householdId, parent.id);
    db.prepare(`UPDATE children SET household_id = ? WHERE parent_id = ?`).run(householdId, parent.id);
    db.prepare(`UPDATE schedules SET household_id = ? WHERE parent_id = ?`).run(householdId, parent.id);
  }
}

/**
 * Tiny forward migration helper — SQLite has no `ADD COLUMN IF NOT EXISTS`, so
 * existing databases get new columns without being wiped.
 */
function addColumnIfMissing(table: string, column: string, definition: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (cols.some((c) => c.name === column)) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
  return true;
}
