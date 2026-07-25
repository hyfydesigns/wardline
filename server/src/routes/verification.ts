import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { hashPassword, newToken } from '../auth.js';
import { config } from '../config.js';
import { sendMail } from '../mailer.js';

const VERIFY_TTL_HOURS = 24;
const RESET_TTL_HOURS = 1;
const RESEND_COOLDOWN_MS = 60_000;

/**
 * Create a verification token for a parent and email it. Exported so signup
 * can call it right after creating the account.
 */
export async function issueEmailVerification(parentId: string, email: string): Promise<void> {
  const token = newToken(24);
  const now = new Date();
  const expires = new Date(now.getTime() + VERIFY_TTL_HOURS * 3_600_000);
  db.prepare(
    `INSERT INTO email_verifications (id, parent_id, token, created_at, expires_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(`ev_${randomUUID().slice(0, 8)}`, parentId, token, now.toISOString(), expires.toISOString());

  const link = `${config.appUrl}/?verify=${token}`;
  await sendMail({
    to: email,
    subject: 'Verify your email for Wardline',
    text: `Confirm this is your email address to finish setting up Wardline.\n\n${link}\n\nThis link expires in ${VERIFY_TTL_HOURS} hours. If you didn't create a Wardline account, you can ignore this email.`,
  });
}

/**
 * Email verification (informational — doesn't gate any feature, just proves
 * the address is real) and password reset. Both are public flows identified
 * by a single-use, expiring token, following the same pattern as household
 * invitations.
 */
export async function verificationRoutes(app: FastifyInstance): Promise<void> {
  // ---- Email verification ---------------------------------------------------

  app.post('/auth/verify', async (req, reply) => {
    const { token } = (req.body ?? {}) as { token?: string };
    if (!token) return reply.code(400).send({ error: 'Missing verification link.' });

    const row = db
      .prepare(`SELECT id, parent_id, expires_at, verified_at FROM email_verifications WHERE token = ?`)
      .get(token) as { id: string; parent_id: string; expires_at: string; verified_at: string | null } | undefined;
    if (!row) return reply.code(404).send({ error: 'That verification link is not valid.' });

    // Idempotent: a link that already succeeded keeps succeeding (mail clients
    // sometimes prefetch links, or a user clicks it twice).
    if (!row.verified_at) {
      if (new Date(row.expires_at).getTime() < Date.now()) {
        return reply.code(410).send({ error: 'That verification link has expired. Request a new one from Settings.' });
      }
      const now = new Date().toISOString();
      db.prepare(`UPDATE email_verifications SET verified_at = ? WHERE id = ?`).run(now, row.id);
      db.prepare(`UPDATE parents SET email_verified = 1 WHERE id = ?`).run(row.parent_id);
    }
    return { verified: true };
  });

  app.register(async (scoped) => {
    scoped.addHook('preHandler', scoped.authenticate);

    /** Resend the verification email, with a short cooldown against spam. */
    scoped.post('/api/verify/resend', async (req, reply) => {
      const parent = db.prepare(`SELECT email, email_verified FROM parents WHERE id = ?`).get(req.parentId) as
        | { email: string; email_verified: number }
        | undefined;
      if (!parent) return reply.code(404).send({ error: 'Account not found.' });
      if (parent.email_verified) return { ok: true, alreadyVerified: true };

      const last = db
        .prepare(`SELECT created_at FROM email_verifications WHERE parent_id = ? ORDER BY created_at DESC LIMIT 1`)
        .get(req.parentId) as { created_at: string } | undefined;
      if (last && Date.now() - new Date(last.created_at).getTime() < RESEND_COOLDOWN_MS) {
        return reply.code(429).send({ error: 'Please wait a moment before requesting another email.' });
      }

      await issueEmailVerification(req.parentId, parent.email);
      return { ok: true };
    });
  });

  // ---- Password reset --------------------------------------------------------

  /**
   * Always responds with the same generic message, whether or not the email
   * has an account — so this endpoint can't be used to discover who has one.
   */
  app.post('/auth/forgot-password', async (req, reply) => {
    const { email } = (req.body ?? {}) as { email?: string };
    const clean = (email ?? '').trim().toLowerCase();
    const generic = { message: 'If an account exists for that email, we sent a link to reset the password.' };
    if (!clean) return reply.code(400).send({ error: 'Enter your email address.' });

    const parent = db.prepare(`SELECT id FROM parents WHERE email = ?`).get(clean) as { id: string } | undefined;
    if (!parent) return generic;

    // Same cooldown idea as verification resend, but silent either way — a
    // differing response on cooldown would itself leak account existence.
    const last = db
      .prepare(`SELECT created_at FROM password_resets WHERE parent_id = ? ORDER BY created_at DESC LIMIT 1`)
      .get(parent.id) as { created_at: string } | undefined;
    if (last && Date.now() - new Date(last.created_at).getTime() < RESEND_COOLDOWN_MS) {
      return generic;
    }

    const token = newToken(24);
    const now = new Date();
    const expires = new Date(now.getTime() + RESET_TTL_HOURS * 3_600_000);
    db.prepare(
      `INSERT INTO password_resets (id, parent_id, token, created_at, expires_at) VALUES (?, ?, ?, ?, ?)`,
    ).run(`pr_${randomUUID().slice(0, 8)}`, parent.id, token, now.toISOString(), expires.toISOString());

    const link = `${config.appUrl}/?reset=${token}`;
    await sendMail({
      to: clean,
      subject: 'Reset your Wardline password',
      text: `We received a request to reset your Wardline password.\n\n${link}\n\nThis link expires in ${RESET_TTL_HOURS} hour and can only be used once. If you didn't request this, you can ignore this email — your password won't change.`,
    });

    return generic;
  });

  app.post('/auth/reset-password', async (req, reply) => {
    const { token, password } = (req.body ?? {}) as { token?: string; password?: string };
    if (!token) return reply.code(400).send({ error: 'Missing reset link.' });
    if (!password || password.length < 8) {
      return reply.code(400).send({ error: 'Choose a password of at least 8 characters.' });
    }

    const row = db
      .prepare(`SELECT id, parent_id, expires_at, used_at FROM password_resets WHERE token = ?`)
      .get(token) as { id: string; parent_id: string; expires_at: string; used_at: string | null } | undefined;
    if (!row) return reply.code(404).send({ error: 'That reset link is not valid.' });
    if (row.used_at) return reply.code(410).send({ error: 'That reset link has already been used. Request a new one.' });
    if (new Date(row.expires_at).getTime() < Date.now()) {
      return reply.code(410).send({ error: 'That reset link has expired. Request a new one.' });
    }

    const parent = db
      .prepare(`SELECT id, email, name, totp_enabled, token_version FROM parents WHERE id = ?`)
      .get(row.parent_id) as { id: string; email: string; name: string; totp_enabled: number; token_version: number };

    // Bump token_version so any session minted before this reset stops
    // authenticating right away — not just once its 7-day expiry catches up.
    const newVersion = parent.token_version + 1;
    db.prepare(`UPDATE parents SET password_hash = ?, token_version = ? WHERE id = ?`).run(hashPassword(password), newVersion, row.parent_id);
    db.prepare(`UPDATE password_resets SET used_at = ? WHERE id = ?`).run(new Date().toISOString(), row.id);

    // If 2FA is on, don't mint a session here — that would let anyone with
    // access to the inbox skip the authenticator step entirely. Send them to
    // a normal sign-in instead, which still enforces the code.
    if (parent.totp_enabled) {
      return { requiresLogin: true, email: parent.email };
    }
    const jwt = app.jwt.sign({ parentId: parent.id, tokenVersion: newVersion }, { expiresIn: '7d' });
    return { token: jwt, parent: { id: parent.id, email: parent.email, name: parent.name } };
  });
}
