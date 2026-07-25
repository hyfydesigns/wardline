import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';

process.env.DB_PATH = ':memory:';
process.env.WARDLINE_CLASSIFIER = 'rules';

const { buildServer } = await import('../server/src/app.ts');
const { db } = await import('../server/src/db.ts');
const { generateTotp } = await import('../server/src/totp.ts');
const { _enableTestInbox, _disableTestInbox } = await import('../server/src/mailer.ts');

let app: FastifyInstance;
let inbox: { to: string; subject: string; text: string }[];

before(async () => {
  inbox = _enableTestInbox();
  app = await buildServer({ logger: false });
  await app.ready();
});

after(async () => {
  _disableTestInbox();
  await app.close();
});

const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

/** Pull a ?param=<token> value out of an emailed link. */
function linkToken(text: string, param: string): string {
  const m = text.match(new RegExp(`[?&]${param}=(\\w+)`));
  if (!m) throw new Error(`no ${param} token found in: ${text}`);
  return m[1];
}

describe('signup → email verification', () => {
  const NEW = { name: 'Priya', email: 'priya@example.com', password: 'a-strong-password', childName: 'Zed' };
  let token: string;

  test('signup sends a verification email and starts unverified', async () => {
    const before = inbox.length;
    const res = await app.inject({ method: 'POST', url: '/auth/signup', payload: NEW });
    assert.equal(res.statusCode, 200);
    token = res.json().token;
    assert.equal(res.json().parent.emailVerified, false);

    assert.equal(inbox.length, before + 1);
    const mail = inbox[inbox.length - 1];
    assert.equal(mail.to, NEW.email);
    assert.ok(mail.text.includes('/?verify='));

    const me = (await app.inject({ method: 'GET', url: '/api/me', headers: bearer(token) })).json();
    assert.equal(me.parent.emailVerified, false);
  });

  test('verifying with the emailed token marks the account verified', async () => {
    const verifyToken = linkToken(inbox[inbox.length - 1].text, 'verify');
    const res = await app.inject({ method: 'POST', url: '/auth/verify', payload: { token: verifyToken } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().verified, true);

    const me = (await app.inject({ method: 'GET', url: '/api/me', headers: bearer(token) })).json();
    assert.equal(me.parent.emailVerified, true);
  });

  test('verifying again with the same token is idempotent', async () => {
    const verifyToken = linkToken(inbox[inbox.length - 1].text, 'verify');
    const res = await app.inject({ method: 'POST', url: '/auth/verify', payload: { token: verifyToken } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().verified, true);
  });

  test('an unknown token is rejected', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/verify', payload: { token: 'not-a-real-token' } });
    assert.equal(res.statusCode, 404);
  });

  test('resend is a no-op once verified — no new email', async () => {
    const before = inbox.length;
    const res = await app.inject({ method: 'POST', url: '/api/verify/resend', headers: bearer(token) });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().alreadyVerified, true);
    assert.equal(inbox.length, before);
  });
});

describe('email verification: expiry and resend cooldown', () => {
  const NEW = { name: 'Omar', email: 'omar@example.com', password: 'a-strong-password', childName: 'Lyra' };
  let token: string;

  before(async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/signup', payload: NEW });
    token = res.json().token;
  });

  test('an expired, never-verified token is rejected', async () => {
    const verifyToken = linkToken(inbox[inbox.length - 1].text, 'verify');
    db.prepare(`UPDATE email_verifications SET expires_at = ? WHERE token = ?`).run(new Date(Date.now() - 1000).toISOString(), verifyToken);
    const res = await app.inject({ method: 'POST', url: '/auth/verify', payload: { token: verifyToken } });
    assert.equal(res.statusCode, 410);
  });

  test('resend is rate-limited', async () => {
    // Signup already queued a verification email moments ago in before();
    // backdate it so this test's own first call isn't itself caught by that
    // cooldown — we want to test the cooldown between the two calls below.
    db.prepare(
      `UPDATE email_verifications SET created_at = ? WHERE parent_id = (SELECT id FROM parents WHERE email = ?)`,
    ).run(new Date(Date.now() - 120_000).toISOString(), NEW.email);

    const first = await app.inject({ method: 'POST', url: '/api/verify/resend', headers: bearer(token) });
    assert.equal(first.statusCode, 200);
    const second = await app.inject({ method: 'POST', url: '/api/verify/resend', headers: bearer(token) });
    assert.equal(second.statusCode, 429);
  });
});

describe('password reset', () => {
  const NEW = { name: 'Farah', email: 'farah@example.com', password: 'original-password', childName: 'Nova' };
  let preResetToken: string;

  before(async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/signup', payload: NEW });
    preResetToken = res.json().token;
  });

  test('forgot-password gives a generic response and sends nothing for an unknown email', async () => {
    const before = inbox.length;
    const res = await app.inject({ method: 'POST', url: '/auth/forgot-password', payload: { email: 'nobody@example.com' } });
    assert.equal(res.statusCode, 200);
    assert.ok(res.json().message);
    assert.equal(inbox.length, before, "doesn't reveal whether the account exists by sending mail");
  });

  test('forgot-password sends a reset email for a real account', async () => {
    const before = inbox.length;
    const res = await app.inject({ method: 'POST', url: '/auth/forgot-password', payload: { email: NEW.email } });
    assert.equal(res.statusCode, 200);
    assert.equal(inbox.length, before + 1);
    assert.ok(inbox[inbox.length - 1].text.includes('/?reset='));
  });

  test('a second request within the cooldown sends nothing, but still looks the same', async () => {
    const before = inbox.length;
    const res = await app.inject({ method: 'POST', url: '/auth/forgot-password', payload: { email: NEW.email } });
    assert.equal(res.statusCode, 200);
    assert.equal(inbox.length, before, 'cooldown suppresses the second email');
  });

  test('resetting rejects a weak password', async () => {
    const resetToken = linkToken(inbox[inbox.length - 1].text, 'reset');
    const res = await app.inject({ method: 'POST', url: '/auth/reset-password', payload: { token: resetToken, password: 'short' } });
    assert.equal(res.statusCode, 400);
  });

  test('resetting signs the account in and invalidates the pre-reset session', async () => {
    const resetToken = linkToken(inbox[inbox.length - 1].text, 'reset');

    const before = await app.inject({ method: 'GET', url: '/api/me', headers: bearer(preResetToken) });
    assert.equal(before.statusCode, 200, 'the pre-reset session still works right up until the reset');

    const res = await app.inject({ method: 'POST', url: '/auth/reset-password', payload: { token: resetToken, password: 'brand-new-password' } });
    assert.equal(res.statusCode, 200);
    const freshToken = res.json().token as string;
    assert.ok(freshToken);

    const after = await app.inject({ method: 'GET', url: '/api/me', headers: bearer(preResetToken) });
    assert.equal(after.statusCode, 401, 'the pre-reset session is invalidated the instant the reset succeeds');

    const withFresh = await app.inject({ method: 'GET', url: '/api/me', headers: bearer(freshToken) });
    assert.equal(withFresh.statusCode, 200, 'the freshly issued session works');

    const oldLogin = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: NEW.email, password: NEW.password } });
    assert.equal(oldLogin.statusCode, 401, 'the old password no longer works');
    const newLogin = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: NEW.email, password: 'brand-new-password' } });
    assert.equal(newLogin.statusCode, 200, 'the new password works');
  });

  test('the reset token is single-use', async () => {
    const resetToken = linkToken(inbox[inbox.length - 1].text, 'reset');
    const res = await app.inject({ method: 'POST', url: '/auth/reset-password', payload: { token: resetToken, password: 'another-password-1' } });
    assert.equal(res.statusCode, 410);
  });

  test('an unknown reset token is rejected', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/reset-password', payload: { token: 'nope', password: 'whatever12345' } });
    assert.equal(res.statusCode, 404);
  });

  test('an expired reset token is rejected', async () => {
    const parent = db.prepare(`SELECT id FROM parents WHERE email = ?`).get(NEW.email) as { id: string };
    const expiredToken = 'expired-test-token-1234567890';
    db.prepare(
      `INSERT INTO password_resets (id, parent_id, token, created_at, expires_at) VALUES (?, ?, ?, ?, ?)`,
    ).run('pr_expired_test', parent.id, expiredToken, new Date(Date.now() - 7_200_000).toISOString(), new Date(Date.now() - 3_600_000).toISOString());
    const res = await app.inject({ method: 'POST', url: '/auth/reset-password', payload: { token: expiredToken, password: 'whatever12345' } });
    assert.equal(res.statusCode, 410);
  });
});

describe('password reset cannot bypass 2FA', () => {
  const NEW = { name: 'Toma', email: 'toma@example.com', password: 'first-password-123', childName: 'Kai' };
  let token: string;
  let totpSecret: string;

  before(async () => {
    const signup = await app.inject({ method: 'POST', url: '/auth/signup', payload: NEW });
    token = signup.json().token;
    const setup = await app.inject({ method: 'POST', url: '/api/2fa/setup', headers: bearer(token) });
    totpSecret = setup.json().secret;
    const enable = await app.inject({
      method: 'POST', url: '/api/2fa/enable', headers: bearer(token), payload: { code: generateTotp(totpSecret) },
    });
    assert.equal(enable.statusCode, 200);
  });

  test('a successful reset does not return a session when 2FA is on', async () => {
    const before = inbox.length;
    await app.inject({ method: 'POST', url: '/auth/forgot-password', payload: { email: NEW.email } });
    assert.equal(inbox.length, before + 1);
    const resetToken = linkToken(inbox[inbox.length - 1].text, 'reset');

    const res = await app.inject({ method: 'POST', url: '/auth/reset-password', payload: { token: resetToken, password: 'second-password-456' } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().requiresLogin, true);
    assert.equal(res.json().token, undefined, 'no session minted — that would let an inbox compromise skip the authenticator step');
  });

  test('signing in with the new password still requires the TOTP code', async () => {
    const noCode = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: NEW.email, password: 'second-password-456' } });
    assert.equal(noCode.statusCode, 401);
    assert.equal(noCode.json().mfaRequired, true);

    const withCode = await app.inject({
      method: 'POST', url: '/auth/login', payload: { email: NEW.email, password: 'second-password-456', code: generateTotp(totpSecret) },
    });
    assert.equal(withCode.statusCode, 200);
  });
});

describe('household invites are emailed and auto-verify the co-parent', () => {
  const OWNER = { name: 'Wren', email: 'wren@example.com', password: 'owner-password-1', childName: 'Sol' };
  let ownerToken: string;

  before(async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/signup', payload: OWNER });
    ownerToken = res.json().token;
  });

  test('creating an invite emails the invite link', async () => {
    const before = inbox.length;
    const res = await app.inject({
      method: 'POST', url: '/api/household/invites', headers: bearer(ownerToken), payload: { email: 'newcoparent@example.com' },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(inbox.length, before + 1);
    const mail = inbox[inbox.length - 1];
    assert.equal(mail.to, 'newcoparent@example.com');
    assert.ok(mail.text.includes('/?invite='));
  });

  test('accepting the invite creates an already-verified co-parent', async () => {
    const inviteToken = linkToken(inbox[inbox.length - 1].text, 'invite');
    const res = await app.inject({
      method: 'POST', url: '/auth/accept-invite', payload: { token: inviteToken, name: 'New Co-parent', password: 'co-parent-password' },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().parent.emailVerified, true);

    const me = (await app.inject({ method: 'GET', url: '/api/me', headers: bearer(res.json().token) })).json();
    assert.equal(me.parent.emailVerified, true);
  });
});
