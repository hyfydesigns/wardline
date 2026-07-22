import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';

process.env.DB_PATH = ':memory:';
process.env.WARDLINE_CLASSIFIER = 'rules';

const { buildServer } = await import('../server/src/app.ts');

const OWNER = { email: 'renee@family.wardline.app', password: 'wardline-demo' };
const COPARENT_EMAIL = 'sam@example.com';
const COPARENT_PASSWORD = 'a-strong-password';

let app: FastifyInstance;
let ownerToken: string;
let coToken: string;
let inviteToken: string;
let coParentId: string;

const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

before(async () => {
  app = await buildServer({ logger: false });
  await app.ready();
  ownerToken = (await app.inject({ method: 'POST', url: '/auth/login', payload: OWNER })).json().token;
});

after(async () => {
  await app.close();
});

describe('household basics', () => {
  test('the seeded parent is the owner of a household', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/household', headers: bearer(ownerToken) });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.yourRole, 'owner');
    assert.equal(body.members.length, 1);
    assert.equal(body.members[0].isYou, true);
    assert.ok(body.household.id);
  });

  test('/api/me reports the household and role', async () => {
    const me = (await app.inject({ method: 'GET', url: '/api/me', headers: bearer(ownerToken) })).json();
    assert.equal(me.parent.role, 'owner');
    assert.ok(me.household.id);
    assert.equal(me.children.length, 2, 'children belong to the household');
  });
});

describe('invitations', () => {
  test('rejects an invalid email', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/household/invites', headers: bearer(ownerToken), payload: { email: 'not-an-email' },
    });
    assert.equal(res.statusCode, 400);
  });

  test('creates an invitation with a shareable link', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/household/invites', headers: bearer(ownerToken), payload: { email: COPARENT_EMAIL },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    inviteToken = body.token;
    assert.ok(inviteToken);
    assert.equal(body.invitePath, `/?invite=${inviteToken}`);
  });

  test('the invite preview is public and describes the household', async () => {
    const res = await app.inject({ method: 'GET', url: `/auth/invite/${inviteToken}` });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().email, COPARENT_EMAIL);
    assert.equal(res.json().invitedByName, 'Renee');
    assert.equal(res.json().usable, true);
  });

  test('an unknown invite token is rejected', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/invite/nope' });
    assert.equal(res.statusCode, 404);
  });

  test('accepting requires a reasonable password', async () => {
    const res = await app.inject({
      method: 'POST', url: '/auth/accept-invite',
      payload: { token: inviteToken, name: 'Sam', password: 'short' },
    });
    assert.equal(res.statusCode, 400);
  });

  test('accepting creates the co-parent and signs them in', async () => {
    const res = await app.inject({
      method: 'POST', url: '/auth/accept-invite',
      payload: { token: inviteToken, name: 'Sam', password: COPARENT_PASSWORD },
    });
    assert.equal(res.statusCode, 200);
    coToken = res.json().token;
    coParentId = res.json().parent.id;
    assert.equal(res.json().parent.role, 'parent');
  });

  test('the invitation is single-use', async () => {
    const res = await app.inject({
      method: 'POST', url: '/auth/accept-invite',
      payload: { token: inviteToken, name: 'Someone Else', password: COPARENT_PASSWORD },
    });
    assert.equal(res.statusCode, 410);
  });

  test('the co-parent can sign in normally afterwards', async () => {
    const res = await app.inject({
      method: 'POST', url: '/auth/login', payload: { email: COPARENT_EMAIL, password: COPARENT_PASSWORD },
    });
    assert.equal(res.statusCode, 200);
  });
});

describe('co-parents share the household', () => {
  test('both parents appear as members', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/household', headers: bearer(coToken) });
    assert.equal(res.json().members.length, 2);
    assert.equal(res.json().yourRole, 'parent');
  });

  test('the co-parent sees the same children', async () => {
    const owner = (await app.inject({ method: 'GET', url: '/api/children', headers: bearer(ownerToken) })).json();
    const co = (await app.inject({ method: 'GET', url: '/api/children', headers: bearer(coToken) })).json();
    assert.deepEqual(co.map((c: { id: string }) => c.id), owner.map((c: { id: string }) => c.id));
    assert.equal(co.length, 2);
  });

  test('the co-parent sees the same alerts', async () => {
    const owner = (await app.inject({ method: 'GET', url: '/api/alerts', headers: bearer(ownerToken) })).json();
    const co = (await app.inject({ method: 'GET', url: '/api/alerts', headers: bearer(coToken) })).json();
    assert.equal(co.alerts.length, owner.alerts.length);
    assert.ok(co.alerts.length > 0);
  });

  test('a settings change by one parent is visible to the other', async () => {
    await app.inject({
      method: 'PUT', url: '/api/settings', headers: bearer(coToken), payload: { safeSearch: false },
    });
    const asOwner = (await app.inject({ method: 'GET', url: '/api/settings', headers: bearer(ownerToken) })).json();
    assert.equal(asOwner.safeSearch, false, 'settings are household-wide');
    await app.inject({ method: 'PUT', url: '/api/settings', headers: bearer(ownerToken), payload: { safeSearch: true } });
  });

  test('the device policy reflects a co-parent edit', async () => {
    await app.inject({
      method: 'PUT', url: '/api/settings', headers: bearer(coToken),
      payload: { customBlocked: ['omegle.com', 'coparent-added.com'] },
    });
    const policy = (await app.inject({
      method: 'GET', url: '/api/policy', headers: { authorization: 'Bearer wl-dev-marcus-pc' },
    })).json();
    assert.ok(policy.blocked.includes('coparent-added.com'), 'co-parent edits reach the device');
  });
});

describe('roles and revocation', () => {
  test('a co-parent cannot remove members', async () => {
    const res = await app.inject({
      method: 'DELETE', url: `/api/household/members/p_renee`, headers: bearer(coToken),
    });
    assert.equal(res.statusCode, 403);
  });

  test('the owner cannot be removed', async () => {
    const res = await app.inject({
      method: 'DELETE', url: `/api/household/members/p_renee`, headers: bearer(ownerToken),
    });
    assert.equal(res.statusCode, 400);
  });

  test('the owner cannot remove themselves', async () => {
    const me = (await app.inject({ method: 'GET', url: '/api/me', headers: bearer(ownerToken) })).json();
    const res = await app.inject({
      method: 'DELETE', url: `/api/household/members/${me.parent.id}`, headers: bearer(ownerToken),
    });
    assert.equal(res.statusCode, 400);
  });

  test('the owner can remove a co-parent, and access is revoked immediately', async () => {
    const before = await app.inject({ method: 'GET', url: '/api/children', headers: bearer(coToken) });
    assert.equal(before.statusCode, 200, 'co-parent had access');

    const del = await app.inject({
      method: 'DELETE', url: `/api/household/members/${coParentId}`, headers: bearer(ownerToken),
    });
    assert.equal(del.statusCode, 200);

    // Same (still unexpired) token — must now be rejected.
    const after = await app.inject({ method: 'GET', url: '/api/children', headers: bearer(coToken) });
    assert.equal(after.statusCode, 401, 'existing token stops working right away');

    const members = (await app.inject({ method: 'GET', url: '/api/household', headers: bearer(ownerToken) })).json();
    assert.equal(members.members.length, 1);
  });

  test('a removed co-parent can no longer sign in', async () => {
    const res = await app.inject({
      method: 'POST', url: '/auth/login', payload: { email: COPARENT_EMAIL, password: COPARENT_PASSWORD },
    });
    assert.equal(res.statusCode, 401);
  });
});

describe('pending invitations', () => {
  test('are listed and can be revoked', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/household/invites', headers: bearer(ownerToken), payload: { email: 'pending@example.com' },
    });
    const id = created.json().id;

    const listed = (await app.inject({ method: 'GET', url: '/api/household', headers: bearer(ownerToken) })).json();
    assert.ok(listed.invitations.some((i: { id: string }) => i.id === id));

    const revoked = await app.inject({ method: 'DELETE', url: `/api/household/invites/${id}`, headers: bearer(ownerToken) });
    assert.equal(revoked.statusCode, 200);

    const after = (await app.inject({ method: 'GET', url: '/api/household', headers: bearer(ownerToken) })).json();
    assert.equal(after.invitations.some((i: { id: string }) => i.id === id), false);
  });

  test('inviting someone already in the household is rejected', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/household/invites', headers: bearer(ownerToken), payload: { email: OWNER.email },
    });
    assert.equal(res.statusCode, 409);
  });
});
