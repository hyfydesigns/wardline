import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { hashPassword, verifyPassword } from '../auth.js';
import { generateSecret, otpauthUri, verifyTotp } from '../totp.js';
import { DEFAULT_SETTINGS } from '../seed.js';
import { issueEmailVerification } from './verification.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface ParentRow {
  id: string;
  email: string;
  name: string;
  plan: string;
  password_hash: string;
  totp_secret: string | null;
  totp_enabled: number;
  email_verified: number;
  token_version: number;
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Public sign-up: create a brand-new household with its owner and first
   * child, then sign the owner in. This is the only way to create a household
   * from scratch (co-parents join an existing one via invite).
   */
  app.post('/auth/signup', async (req, reply) => {
    const body = (req.body ?? {}) as {
      name?: string;
      email?: string;
      password?: string;
      householdName?: string;
      childName?: string;
      childLimitMin?: number;
    };
    const name = (body.name ?? '').trim();
    const email = (body.email ?? '').trim().toLowerCase();
    const password = body.password ?? '';
    const childName = (body.childName ?? '').trim();

    if (!name || !EMAIL_RE.test(email) || !childName) {
      return reply.code(400).send({ error: 'Your name, a valid email, and a child’s name are required.' });
    }
    if (password.length < 8) {
      return reply.code(400).send({ error: 'Choose a password of at least 8 characters.' });
    }
    if (db.prepare(`SELECT 1 FROM parents WHERE email = ?`).get(email)) {
      return reply.code(409).send({ error: 'An account already exists for that email. Try signing in.' });
    }

    const householdName = (body.householdName ?? '').trim() || `${name}’s household`;
    const limitMin = Math.min(1440, Math.max(30, Math.round(body.childLimitMin ?? 240)));
    const now = new Date().toISOString();

    const householdId = `hh_${randomUUID().slice(0, 8)}`;
    const parentId = `p_${randomUUID().slice(0, 8)}`;

    // Create household → owner → first child + starter schedules atomically.
    // (node:sqlite has no .transaction() helper, so drive BEGIN/COMMIT directly.)
    db.exec('BEGIN');
    try {
      db.prepare(
        `INSERT INTO households (id, name, plan, settings_json, created_at) VALUES (?, ?, 'family', ?, ?)`,
      ).run(householdId, householdName, JSON.stringify(DEFAULT_SETTINGS), now);

      db.prepare(
        `INSERT INTO parents (id, household_id, role, email, password_hash, name, plan, settings_json, created_at)
         VALUES (?, ?, 'owner', ?, ?, ?, 'family', '{}', ?)`,
      ).run(parentId, householdId, email, hashPassword(password), name, now);

      db.prepare(
        `INSERT INTO children (id, parent_id, household_id, name, color, screen_limit_min) VALUES (?, ?, ?, ?, 'marcus', ?)`,
      ).run(`c_${randomUUID().slice(0, 8)}`, parentId, householdId, childName, limitMin);

      const sched = db.prepare(
        `INSERT INTO schedules (id, parent_id, household_id, name, kind, days, start_min, end_min, scope)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'all internet')`,
      );
      sched.run(`s_${randomUUID().slice(0, 8)}`, parentId, householdId, 'School hours', 'school', '0,1,2,3,4', 8 * 60, 14 * 60);
      sched.run(`s_${randomUUID().slice(0, 8)}`, parentId, householdId, 'Bedtime', 'bedtime', '0,1,2,3,4,5,6', 21 * 60, 23 * 60);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    // Best-effort: a failed send shouldn't block account creation (the mailer
    // itself never throws — see server/src/mailer.ts).
    await issueEmailVerification(parentId, email);

    const token = app.jwt.sign({ parentId, tokenVersion: 1 }, { expiresIn: '7d' });
    return { token, parent: { id: parentId, email, name, plan: 'family', role: 'owner', emailVerified: false } };
  });

  app.post('/auth/login', async (req, reply) => {
    const { email, password, code } = (req.body ?? {}) as { email?: string; password?: string; code?: string };
    if (!email || !password) {
      return reply.code(400).send({ error: 'Email and password are required.' });
    }
    const parent = db
      .prepare(`SELECT id, email, name, plan, password_hash, totp_secret, totp_enabled, email_verified, token_version FROM parents WHERE email = ?`)
      .get(email.toLowerCase().trim()) as ParentRow | undefined;

    if (!parent || !verifyPassword(password, parent.password_hash)) {
      return reply.code(401).send({ error: "That email and password don't match." });
    }

    // Second factor — only enforced for accounts that have enrolled.
    if (parent.totp_enabled && parent.totp_secret) {
      if (!code) {
        return reply.code(401).send({ error: 'Authentication code required.', mfaRequired: true });
      }
      if (!verifyTotp(parent.totp_secret, code)) {
        return reply.code(401).send({ error: 'That authentication code is not valid.', mfaRequired: true });
      }
    }

    const token = app.jwt.sign({ parentId: parent.id, tokenVersion: parent.token_version }, { expiresIn: '7d' });
    return {
      token,
      parent: {
        id: parent.id,
        email: parent.email,
        name: parent.name,
        plan: parent.plan,
        mfaEnabled: !!parent.totp_enabled,
        emailVerified: !!parent.email_verified,
      },
    };
  });

  /** Tells the login screen whether to ask for a code, before password entry. */
  app.post('/auth/mfa-required', async (req) => {
    const { email } = (req.body ?? {}) as { email?: string };
    if (!email) return { mfaRequired: false };
    const row = db
      .prepare(`SELECT totp_enabled FROM parents WHERE email = ?`)
      .get(email.toLowerCase().trim()) as { totp_enabled: number } | undefined;
    return { mfaRequired: !!row?.totp_enabled };
  });

  app.get('/api/me', { preHandler: app.authenticate }, async (req) => {
    const { parentId, householdId, parentRole } = req;
    const parent = db
      .prepare(`SELECT id, email, name, totp_enabled, email_verified FROM parents WHERE id = ?`)
      .get(parentId) as { id: string; email: string; name: string; totp_enabled: number; email_verified: number } | undefined;
    const household = db
      .prepare(`SELECT id, name, plan, settings_json FROM households WHERE id = ?`)
      .get(householdId) as { id: string; name: string; plan: string; settings_json: string } | undefined;
    const children = db
      .prepare(`SELECT id, name, color, screen_limit_min FROM children WHERE household_id = ? ORDER BY rowid`)
      .all(householdId);
    return {
      parent: parent
        ? {
            id: parent.id,
            email: parent.email,
            name: parent.name,
            plan: household?.plan ?? 'family',
            role: parentRole,
            mfaEnabled: !!parent.totp_enabled,
            emailVerified: !!parent.email_verified,
          }
        : null,
      household: household ? { id: household.id, name: household.name, plan: household.plan } : null,
      settings: household ? JSON.parse(household.settings_json) : {},
      children,
    };
  });

  // ---- Two-factor enrolment ------------------------------------------------

  /** Start enrolment: mint a secret and return the otpauth URI to scan. */
  app.post('/api/2fa/setup', { preHandler: app.authenticate }, async (req) => {
    const parentId = req.parentId;
    const parent = db.prepare(`SELECT email FROM parents WHERE id = ?`).get(parentId) as { email: string };
    const secret = generateSecret();
    // Stored but NOT enabled until a valid code proves the app is configured.
    db.prepare(`UPDATE parents SET totp_secret = ?, totp_enabled = 0 WHERE id = ?`).run(secret, parentId);
    return { secret, otpauthUri: otpauthUri(secret, parent.email) };
  });

  /** Finish enrolment: a valid code proves the authenticator works. */
  app.post('/api/2fa/enable', { preHandler: app.authenticate }, async (req, reply) => {
    const parentId = req.parentId;
    const { code } = (req.body ?? {}) as { code?: string };
    const row = db.prepare(`SELECT totp_secret FROM parents WHERE id = ?`).get(parentId) as { totp_secret: string | null };
    if (!row?.totp_secret) return reply.code(400).send({ error: 'Start setup first.' });
    if (!code || !verifyTotp(row.totp_secret, code)) {
      return reply.code(400).send({ error: 'That code is not valid. Check your authenticator and try again.' });
    }
    db.prepare(`UPDATE parents SET totp_enabled = 1 WHERE id = ?`).run(parentId);
    return { mfaEnabled: true };
  });

  /** Turn 2FA off — requires a current code, so a hijacked session can't do it. */
  app.post('/api/2fa/disable', { preHandler: app.authenticate }, async (req, reply) => {
    const parentId = req.parentId;
    const { code } = (req.body ?? {}) as { code?: string };
    const row = db
      .prepare(`SELECT totp_secret, totp_enabled FROM parents WHERE id = ?`)
      .get(parentId) as { totp_secret: string | null; totp_enabled: number };
    if (!row?.totp_enabled) return { mfaEnabled: false };
    if (!code || !row.totp_secret || !verifyTotp(row.totp_secret, code)) {
      return reply.code(400).send({ error: 'A current authentication code is required to turn off 2FA.' });
    }
    db.prepare(`UPDATE parents SET totp_enabled = 0, totp_secret = NULL WHERE id = ?`).run(parentId);
    return { mfaEnabled: false };
  });
}
