import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { hashPassword, newToken } from '../auth.js';
import { config } from '../config.js';
import { sendMail } from '../mailer.js';

const INVITE_TTL_DAYS = 7;
const MAX_MEMBERS = 6;

interface MemberRow {
  id: string;
  name: string;
  email: string;
  role: string;
  created_at: string;
  totp_enabled: number;
}

/**
 * Co-parent management. A household has one `owner` and any number of
 * `parent` members; every member sees the same children, alerts, and settings.
 * Invitations are single-use, expiring tokens.
 */
export async function householdRoutes(app: FastifyInstance): Promise<void> {
  // ---- Public: accept an invitation (creates the co-parent's account) ------
  app.post('/auth/accept-invite', async (req, reply) => {
    const { token, name, password } = (req.body ?? {}) as { token?: string; name?: string; password?: string };
    if (!token || !name?.trim() || !password) {
      return reply.code(400).send({ error: 'Name, password, and invitation are required.' });
    }
    if (password.length < 8) {
      return reply.code(400).send({ error: 'Choose a password of at least 8 characters.' });
    }

    const invite = db
      .prepare(`SELECT id, household_id, email, role, expires_at, accepted_at FROM invitations WHERE token = ?`)
      .get(token) as
      | { id: string; household_id: string; email: string; role: string; expires_at: string; accepted_at: string | null }
      | undefined;

    if (!invite) return reply.code(404).send({ error: 'That invitation is not valid.' });
    if (invite.accepted_at) return reply.code(410).send({ error: 'That invitation has already been used.' });
    if (new Date(invite.expires_at).getTime() < Date.now()) {
      return reply.code(410).send({ error: 'That invitation has expired. Ask for a new one.' });
    }

    const taken = db.prepare(`SELECT 1 FROM parents WHERE email = ?`).get(invite.email.toLowerCase());
    if (taken) return reply.code(409).send({ error: 'An account already exists for that email.' });

    const parentId = `p_${randomUUID().slice(0, 8)}`;
    // email_verified=1: this invite was sent to (and clicked from) this exact
    // address, which is the same proof-of-ownership signup verification relies on.
    db.prepare(
      `INSERT INTO parents (id, household_id, role, email, password_hash, name, plan, settings_json, created_at, email_verified)
       VALUES (?, ?, ?, ?, ?, ?, 'family', '{}', ?, 1)`,
    ).run(parentId, invite.household_id, invite.role, invite.email.toLowerCase(), hashPassword(password), name.trim(), new Date().toISOString());

    db.prepare(`UPDATE invitations SET accepted_at = ? WHERE id = ?`).run(new Date().toISOString(), invite.id);

    const jwt = app.jwt.sign({ parentId, tokenVersion: 1 }, { expiresIn: '7d' });
    return {
      token: jwt,
      parent: { id: parentId, email: invite.email.toLowerCase(), name: name.trim(), plan: 'family', role: invite.role, emailVerified: true },
    };
  });

  /** Public preview so the accept screen can show who invited you. */
  app.get('/auth/invite/:token', async (req, reply) => {
    const { token } = req.params as { token: string };
    const invite = db
      .prepare(
        `SELECT i.email, i.expires_at, i.accepted_at, h.name AS householdName, p.name AS invitedByName
         FROM invitations i
         JOIN households h ON h.id = i.household_id
         JOIN parents p ON p.id = i.invited_by
         WHERE i.token = ?`,
      )
      .get(token) as
      | { email: string; expires_at: string; accepted_at: string | null; householdName: string; invitedByName: string }
      | undefined;
    if (!invite) return reply.code(404).send({ error: 'That invitation is not valid.' });
    const expired = !!invite.accepted_at || new Date(invite.expires_at).getTime() < Date.now();
    return {
      email: invite.email,
      householdName: invite.householdName,
      invitedByName: invite.invitedByName,
      usable: !expired,
    };
  });

  // ---- Authenticated household management ---------------------------------
  app.register(async (scoped) => {
    scoped.addHook('preHandler', scoped.authenticate);

    scoped.get('/api/household', async (req) => {
      const household = db
        .prepare(`SELECT id, name, plan FROM households WHERE id = ?`)
        .get(req.householdId) as { id: string; name: string; plan: string };

      const members = (
        db
          .prepare(
            `SELECT id, name, email, role, created_at, totp_enabled FROM parents WHERE household_id = ? ORDER BY (role = 'owner') DESC, created_at`,
          )
          .all(req.householdId) as unknown as MemberRow[]
      ).map((m) => ({
        id: m.id,
        name: m.name,
        email: m.email,
        role: m.role,
        mfaEnabled: !!m.totp_enabled,
        joinedAt: m.created_at,
        isYou: m.id === req.parentId,
      }));

      const invitations = db
        .prepare(
          `SELECT id, email, role, created_at AS createdAt, expires_at AS expiresAt FROM invitations
           WHERE household_id = ? AND accepted_at IS NULL AND expires_at > ? ORDER BY created_at DESC`,
        )
        .all(req.householdId, new Date().toISOString());

      return { household, members, invitations, yourRole: req.parentRole };
    });

    /** Invite a co-parent: emails the invite link and also returns it to share/copy. */
    scoped.post('/api/household/invites', async (req, reply) => {
      const { email } = (req.body ?? {}) as { email?: string };
      const clean = (email ?? '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
        return reply.code(400).send({ error: 'Enter a valid email address.' });
      }

      const memberCount = (db.prepare(`SELECT COUNT(*) AS n FROM parents WHERE household_id = ?`).get(req.householdId) as { n: number }).n;
      if (memberCount >= MAX_MEMBERS) {
        return reply.code(400).send({ error: `A household can have at most ${MAX_MEMBERS} parents.` });
      }
      if (db.prepare(`SELECT 1 FROM parents WHERE email = ? AND household_id = ?`).get(clean, req.householdId)) {
        return reply.code(409).send({ error: 'That person is already in your household.' });
      }

      // Replace any outstanding invite for the same address.
      db.prepare(`DELETE FROM invitations WHERE household_id = ? AND email = ? AND accepted_at IS NULL`).run(req.householdId, clean);

      const id = `inv_${randomUUID().slice(0, 8)}`;
      const token = newToken(24);
      const now = new Date();
      const expires = new Date(now.getTime() + INVITE_TTL_DAYS * 86_400_000);
      db.prepare(
        `INSERT INTO invitations (id, household_id, email, token, role, invited_by, created_at, expires_at)
         VALUES (?, ?, ?, ?, 'parent', ?, ?, ?)`,
      ).run(id, req.householdId, clean, token, req.parentId, now.toISOString(), expires.toISOString());

      const inviter = db.prepare(`SELECT name FROM parents WHERE id = ?`).get(req.parentId) as { name: string };
      const household = db.prepare(`SELECT name FROM households WHERE id = ?`).get(req.householdId) as { name: string };
      const link = `${config.appUrl}/?invite=${token}`;
      await sendMail({
        to: clean,
        subject: `${inviter.name} invited you to ${household.name} on Wardline`,
        text: `${inviter.name} invited you to help look after the children in ${household.name} on Wardline.\n\n${link}\n\nThis link works once and expires in ${INVITE_TTL_DAYS} days.`,
      });

      return { id, email: clean, token, expiresAt: expires.toISOString(), invitePath: `/?invite=${token}` };
    });

    scoped.delete('/api/household/invites/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const owned = db.prepare(`SELECT 1 FROM invitations WHERE id = ? AND household_id = ?`).get(id, req.householdId);
      if (!owned) return reply.code(404).send({ error: 'Invitation not found.' });
      db.prepare(`DELETE FROM invitations WHERE id = ?`).run(id);
      return { ok: true };
    });

    /** Remove a co-parent. Owner-only; the owner cannot be removed. */
    scoped.delete('/api/household/members/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      if (req.parentRole !== 'owner') {
        return reply.code(403).send({ error: 'Only the household owner can remove a parent.' });
      }
      if (id === req.parentId) {
        return reply.code(400).send({ error: "You can't remove yourself." });
      }
      const target = db
        .prepare(`SELECT id, role FROM parents WHERE id = ? AND household_id = ?`)
        .get(id, req.householdId) as { id: string; role: string } | undefined;
      if (!target) return reply.code(404).send({ error: 'That parent is not in your household.' });
      if (target.role === 'owner') return reply.code(400).send({ error: 'The household owner cannot be removed.' });

      // Deleting the row revokes access immediately — the auth hook re-reads
      // membership on every request, so their existing token stops working.
      db.prepare(`DELETE FROM parents WHERE id = ?`).run(id);
      return { ok: true };
    });
  });
}
