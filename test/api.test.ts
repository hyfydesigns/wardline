import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

// Isolate this run: in-memory DB, deterministic rule engine (no API calls).
// Env must be set BEFORE the server modules load, hence the dynamic import.
process.env.DB_PATH = ':memory:';
process.env.WARDLINE_CLASSIFIER = 'rules';

const { buildServer } = await import('../server/src/app.ts');
const { generateTotp } = await import('../server/src/totp.ts');

const DEMO = { email: 'renee@family.wardline.app', password: 'wardline-demo' };
const DEVICE = 'wl-dev-marcus-pc';

let app: FastifyInstance;
let token: string;

before(async () => {
  app = await buildServer({ logger: false });
  await app.ready();
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: DEMO });
  token = res.json().token;
});

after(async () => {
  await app.close();
});

const auth = () => ({ authorization: `Bearer ${token}` });
const device = () => ({ authorization: `Bearer ${DEVICE}` });

const ingest = (events: Record<string, unknown>[]) =>
  app.inject({ method: 'POST', url: '/api/ingest', headers: device(), payload: { events } });

const evt = (over: Record<string, unknown>) => ({
  eventId: randomUUID(),
  occurredAt: new Date().toISOString(),
  source: 'test',
  kind: 'message',
  ...over,
});

describe('health & auth', () => {
  test('health responds', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().ok, true);
  });

  test('login succeeds with correct credentials', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: DEMO });
    assert.equal(res.statusCode, 200);
    assert.ok(res.json().token);
    assert.equal(res.json().parent.email, DEMO.email);
  });

  test('login rejects a wrong password', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { ...DEMO, password: 'nope' } });
    assert.equal(res.statusCode, 401);
  });

  test('login rejects an unknown email', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'no@one.com', password: 'x' } });
    assert.equal(res.statusCode, 401);
  });

  test('protected route rejects a missing token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/me' });
    assert.equal(res.statusCode, 401);
  });

  test('protected route rejects a garbage token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: 'Bearer not.a.jwt' } });
    assert.equal(res.statusCode, 401);
  });

  test('/api/me returns the parent and children', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/me', headers: auth() });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.parent.name, 'Renee');
    assert.equal(body.children.length, 2);
  });
});

describe('public signup', () => {
  const NEW = { name: 'Dana', email: 'dana@example.com', password: 'a-strong-password', childName: 'Robin', childLimitMin: 180 };
  let danaToken: string;

  test('creates a household, owner, and first child, and signs in', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/signup', payload: NEW });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    danaToken = body.token;
    assert.ok(danaToken);
    assert.equal(body.parent.role, 'owner');
    assert.equal(body.parent.email, NEW.email);
  });

  test('the new owner is in a fresh household with their child + starter schedules', async () => {
    const bearer = { authorization: `Bearer ${danaToken}` };
    const me = (await app.inject({ method: 'GET', url: '/api/me', headers: bearer })).json();
    assert.equal(me.children.length, 1);
    assert.equal(me.children[0].name, 'Robin');
    assert.equal(me.children[0].screen_limit_min, 180);
    // Distinct from the seeded demo household.
    assert.notEqual(me.household.id, 'hh_demo');

    const hh = (await app.inject({ method: 'GET', url: '/api/household', headers: bearer })).json();
    assert.equal(hh.members.length, 1);
    assert.equal(hh.yourRole, 'owner');
    const schedules = (await app.inject({ method: 'GET', url: '/api/schedules', headers: bearer })).json();
    assert.ok(schedules.length >= 1, 'starter schedules created');
  });

  test('a new owner cannot see the demo household’s children', async () => {
    const bearer = { authorization: `Bearer ${danaToken}` };
    const children = (await app.inject({ method: 'GET', url: '/api/children', headers: bearer })).json();
    assert.equal(children.some((c: { name: string }) => c.name === 'Marcus'), false);
  });

  test('the new owner can then sign in normally', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: NEW.email, password: NEW.password } });
    assert.equal(res.statusCode, 200);
  });

  test('rejects a duplicate email', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/signup', payload: NEW });
    assert.equal(res.statusCode, 409);
  });

  test('rejects a weak password and a bad email', async () => {
    assert.equal((await app.inject({ method: 'POST', url: '/auth/signup', payload: { ...NEW, email: 'x@y.com', password: 'short' } })).statusCode, 400);
    assert.equal((await app.inject({ method: 'POST', url: '/auth/signup', payload: { ...NEW, email: 'not-an-email' } })).statusCode, 400);
  });

  test('requires a child name', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/signup', payload: { ...NEW, email: 'x2@y.com', childName: '' } });
    assert.equal(res.statusCode, 400);
  });
});

describe('dashboard data', () => {
  test('/api/children returns the expected shape', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/children', headers: auth() });
    assert.equal(res.statusCode, 200);
    const [marcus] = res.json();
    assert.equal(marcus.name, 'Marcus');
    assert.equal(typeof marcus.todayMin, 'number');
    assert.equal(typeof marcus.openAlerts, 'number');
    assert.equal(typeof marcus.blockedToday, 'number');
    assert.equal(marcus.spark.length, 7);
    assert.ok(marcus.device);
  });

  test('reports endpoints return series', async () => {
    const st = await app.inject({ method: 'GET', url: '/api/reports/screen-time?days=7', headers: auth() });
    assert.equal(st.json().days.length, 7);
    assert.equal(st.json().series.length, 2);

    const sev = await app.inject({ method: 'GET', url: '/api/reports/alerts-by-severity?weeks=4', headers: auth() });
    assert.equal(sev.json().length, 4);
  });

  test('settings round-trip', async () => {
    const put = await app.inject({
      method: 'PUT', url: '/api/settings', headers: auth(),
      payload: { safeSearch: false },
    });
    assert.equal(put.statusCode, 200);
    assert.equal(put.json().safeSearch, false);
    // restore
    await app.inject({ method: 'PUT', url: '/api/settings', headers: auth(), payload: { safeSearch: true } });
  });
});

describe('ingest pipeline', () => {
  test('rejects an invalid device token', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/ingest',
      headers: { authorization: 'Bearer not-a-device' },
      payload: { events: [] },
    });
    assert.equal(res.statusCode, 401);
  });

  test('rejects a malformed body', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/ingest', headers: device(), payload: { nope: 1 } });
    assert.equal(res.statusCode, 400);
  });

  test('a risky message produces an alert', async () => {
    const res = await ingest([evt({ text: "how old are you? don't tell your mom, our secret" })]);
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().alerts, 1);
  });

  test('a benign message produces none', async () => {
    const res = await ingest([evt({ text: 'want to play after homework?' })]);
    assert.equal(res.json().alerts, 0);
  });

  test('re-sending the same eventId does not duplicate an alert', async () => {
    const e = evt({ text: 'i want to kill myself' });
    const first = await ingest([e]);
    const second = await ingest([e]);
    assert.equal(first.json().alerts, 1);
    assert.equal(second.json().alerts, 0, 'idempotent on re-sync');
  });

  test('usage minutes are clamped against inflation', async () => {
    const before = (await app.inject({ method: 'GET', url: '/api/children', headers: auth() })).json()[0].todayMin;
    await ingest([evt({ kind: 'usage', category: 'Gaming', minutes: 99999 })]);
    const after = (await app.inject({ method: 'GET', url: '/api/children', headers: auth() })).json()[0].todayMin;
    assert.ok(after - before <= 120, `added ${after - before} min, must be clamped to <= 120`);
  });

  test('blocked events feed the blocked-today counter', async () => {
    const before = (await app.inject({ method: 'GET', url: '/api/children', headers: auth() })).json()[0].blockedToday;
    await ingest([evt({ kind: 'blocked', url: 'https://instagram.com/' })]);
    const after = (await app.inject({ method: 'GET', url: '/api/children', headers: auth() })).json()[0].blockedToday;
    assert.equal(after, before + 1);
  });
});

describe('tamper transitions', () => {
  test('alerts on becoming tampered, stays quiet on repeats, alerts on restore', async () => {
    const reason = 'Browser extension policy was removed';
    const first = await ingest([evt({ kind: 'tamper', source: 'watchdog', text: reason })]);
    assert.equal(first.json().alerts, 1, 'transition into tampered alerts');

    const repeat = await ingest([evt({ kind: 'tamper', source: 'watchdog', text: reason })]);
    assert.equal(repeat.json().alerts, 0, 'identical repeat is suppressed');

    const restored = await ingest([evt({ kind: 'integrity_ok', source: 'watchdog' })]);
    assert.equal(restored.json().alerts, 1, 'restore raises one informational alert');

    const stillOk = await ingest([evt({ kind: 'integrity_ok', source: 'watchdog' })]);
    assert.equal(stillOk.json().alerts, 0, 'already-ok is quiet');
  });
});

describe('alerts', () => {
  test('lists alerts with severity counts and updates status', async () => {
    const list = await app.inject({ method: 'GET', url: '/api/alerts', headers: auth() });
    assert.equal(list.statusCode, 200);
    const { alerts, counts } = list.json();
    assert.ok(alerts.length > 0);
    assert.equal(typeof counts.critical, 'number');

    const target = alerts[0];
    const upd = await app.inject({
      method: 'POST', url: `/api/alerts/${target.id}/status`, headers: auth(),
      payload: { status: 'reviewed' },
    });
    assert.equal(upd.statusCode, 200);
    assert.equal(upd.json().status, 'reviewed');
  });

  test('rejects an invalid status value', async () => {
    const list = await app.inject({ method: 'GET', url: '/api/alerts', headers: auth() });
    const id = list.json().alerts[0].id;
    const res = await app.inject({
      method: 'POST', url: `/api/alerts/${id}/status`, headers: auth(), payload: { status: 'banana' },
    });
    assert.equal(res.statusCode, 400);
  });

  test('cannot touch an alert that is not yours', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/alerts/does-not-exist/status', headers: auth(), payload: { status: 'reviewed' },
    });
    assert.equal(res.statusCode, 404);
  });
});

describe('device enrolment', () => {
  let issuedToken: string;

  test('issues a working device token for a child in the household', async () => {
    const children = (await app.inject({ method: 'GET', url: '/api/children', headers: auth() })).json();
    const res = await app.inject({
      method: 'POST', url: '/api/devices', headers: auth(),
      payload: { childId: children[0].id, name: 'Marcus-Laptop' },
    });
    assert.equal(res.statusCode, 200);
    const { deviceToken } = res.json();
    assert.ok(deviceToken.startsWith('wl-'));
    issuedToken = deviceToken;

    // The freshly minted token must actually work against the device APIs.
    const policy = await app.inject({ method: 'GET', url: '/api/policy', headers: { authorization: `Bearer ${deviceToken}` } });
    assert.equal(policy.statusCode, 200, 'new token authenticates for policy');

    const push = await app.inject({
      method: 'POST', url: '/api/ingest', headers: { authorization: `Bearer ${deviceToken}` },
      payload: { events: [evt({ kind: 'usage', category: 'Homework', minutes: 1 })] },
    });
    assert.equal(push.statusCode, 200, 'new token authenticates for ingest');
  });

  test('appears in the device list as "not yet installed" until the agent reports a version', async () => {
    const before = (await app.inject({ method: 'GET', url: '/api/devices', headers: auth() })).json();
    const entry = before.find((d: { name: string }) => d.name === 'Marcus-Laptop');
    assert.ok(entry);
    assert.equal(entry.agentVersion, 'not yet installed', 'unchanged by the plain usage ingest above, which sent no agentVersion');

    const push = await app.inject({
      method: 'POST', url: '/api/ingest', headers: { authorization: `Bearer ${issuedToken}` },
      payload: { events: [evt({ kind: 'usage', category: 'Homework', minutes: 1 })], agentVersion: '1.0.1' },
    });
    assert.equal(push.statusCode, 200);

    const after = (await app.inject({ method: 'GET', url: '/api/devices', headers: auth() })).json();
    assert.equal(after.find((d: { name: string }) => d.name === 'Marcus-Laptop').agentVersion, 'v1.0.1');
  });

  test('rejects a duplicate name, bad name, or unknown child', async () => {
    const children = (await app.inject({ method: 'GET', url: '/api/children', headers: auth() })).json();
    const dup = await app.inject({
      method: 'POST', url: '/api/devices', headers: auth(), payload: { childId: children[0].id, name: 'Marcus-Laptop' },
    });
    assert.equal(dup.statusCode, 409);

    const bad = await app.inject({
      method: 'POST', url: '/api/devices', headers: auth(), payload: { childId: children[0].id, name: 'x' },
    });
    assert.equal(bad.statusCode, 400);

    const unknown = await app.inject({
      method: 'POST', url: '/api/devices', headers: auth(), payload: { childId: 'c_not_yours', name: 'Some-PC' },
    });
    assert.equal(unknown.statusCode, 404);
  });

  test('regenerating replaces the device key, invalidating the old one', async () => {
    const list = (await app.inject({ method: 'GET', url: '/api/devices', headers: auth() })).json();
    const entry = list.find((d: { name: string }) => d.name === 'Marcus-Laptop');

    const regen = await app.inject({ method: 'POST', url: `/api/devices/${entry.id}/regenerate`, headers: auth() });
    assert.equal(regen.statusCode, 200);
    const { deviceToken } = regen.json();
    assert.ok(deviceToken.startsWith('wl-'));
    assert.notEqual(deviceToken, issuedToken);

    const fresh = await app.inject({ method: 'GET', url: '/api/policy', headers: { authorization: `Bearer ${deviceToken}` } });
    assert.equal(fresh.statusCode, 200, 'the new token authenticates');

    const stale = await app.inject({ method: 'GET', url: '/api/policy', headers: { authorization: `Bearer ${issuedToken}` } });
    assert.equal(stale.statusCode, 401, 'the old token no longer authenticates');
  });

  test('regenerating an unknown or foreign device id is rejected', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/devices/d_not_yours/regenerate', headers: auth() });
    assert.equal(res.statusCode, 404);
  });

  test('removing a device deletes it, its key, and its alerts', async () => {
    const children = (await app.inject({ method: 'GET', url: '/api/children', headers: auth() })).json();
    const created = await app.inject({
      method: 'POST', url: '/api/devices', headers: auth(),
      payload: { childId: children[0].id, name: 'Temp-Delete-PC' },
    });
    const { id, deviceToken } = created.json();

    const push = await app.inject({
      method: 'POST', url: '/api/ingest', headers: { authorization: `Bearer ${deviceToken}` },
      payload: { events: [evt({ text: "how old are you? don't tell your mom, our secret" })] },
    });
    assert.equal(push.statusCode, 200);

    const before = (await app.inject({ method: 'GET', url: '/api/alerts', headers: auth() })).json();
    assert.ok(before.alerts.some((a: { deviceName: string }) => a.deviceName === 'Temp-Delete-PC'), 'alert recorded before deletion');

    const del = await app.inject({ method: 'DELETE', url: `/api/devices/${id}`, headers: auth() });
    assert.equal(del.statusCode, 200);

    const list = (await app.inject({ method: 'GET', url: '/api/devices', headers: auth() })).json();
    assert.ok(!list.some((d: { id: string }) => d.id === id), 'device gone from the list');

    const revoked = await app.inject({ method: 'GET', url: '/api/policy', headers: { authorization: `Bearer ${deviceToken}` } });
    assert.equal(revoked.statusCode, 401, "the deleted device's key no longer authenticates");

    const after = (await app.inject({ method: 'GET', url: '/api/alerts', headers: auth() })).json();
    assert.ok(!after.alerts.some((a: { deviceName: string }) => a.deviceName === 'Temp-Delete-PC'), 'its alert is gone too');
  });

  test('removing an unknown or foreign device id is rejected', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/devices/d_not_yours', headers: auth() });
    assert.equal(res.statusCode, 404);
  });
});

describe('policy downlink', () => {
  test('requires a device token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/policy' });
    assert.equal(res.statusCode, 401);
  });

  test('returns the effective policy', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/policy', headers: device() });
    assert.equal(res.statusCode, 200);
    const p = res.json();
    assert.ok(p.policyVersion);
    assert.equal(p.filters.gambling, true);
    assert.ok(p.blocked.includes('omegle.com'));
    assert.equal(p.schedules.length, 3);
    assert.equal(p.screenTime.limitMin, 240);
    assert.equal(typeof p.activeBlock.blocked, 'boolean');
  });

  test('policyVersion changes when the parent edits settings', async () => {
    const v1 = (await app.inject({ method: 'GET', url: '/api/policy', headers: device() })).json().policyVersion;
    await app.inject({
      method: 'PUT', url: '/api/settings', headers: auth(),
      payload: { customBlocked: ['omegle.com', '4chan.org', 'example-block.com'] },
    });
    const v2 = (await app.inject({ method: 'GET', url: '/api/policy', headers: device() })).json().policyVersion;
    assert.notEqual(v1, v2);
  });
});

// Kept last: enabling 2FA changes how login behaves for the rest of the file.
describe('two-factor authentication', () => {
  let secret: string;

  test('setup returns a secret and otpauth URI, but does not enable yet', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/2fa/setup', headers: auth() });
    assert.equal(res.statusCode, 200);
    secret = res.json().secret;
    assert.ok(secret.length >= 16);
    assert.ok(res.json().otpauthUri.startsWith('otpauth://totp/'));

    const me = await app.inject({ method: 'GET', url: '/api/me', headers: auth() });
    assert.equal(me.json().parent.mfaEnabled, false, 'not enabled until a code is proven');
  });

  test('enable rejects a wrong code', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/2fa/enable', headers: auth(), payload: { code: '000000' } });
    assert.equal(res.statusCode, 400);
  });

  test('enable accepts a valid code', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/2fa/enable', headers: auth(), payload: { code: generateTotp(secret) },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().mfaEnabled, true);
  });

  test('login now demands a code', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: DEMO });
    assert.equal(res.statusCode, 401);
    assert.equal(res.json().mfaRequired, true);
  });

  test('login rejects a wrong code', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { ...DEMO, code: '000000' } });
    assert.equal(res.statusCode, 401);
  });

  test('login succeeds with a valid code', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { ...DEMO, code: generateTotp(secret) } });
    assert.equal(res.statusCode, 200);
    assert.ok(res.json().token);
  });

  test('mfa-required probe reports the enrolment state', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/mfa-required', payload: { email: DEMO.email } });
    assert.equal(res.json().mfaRequired, true);
  });

  test('disable requires a current code, then turns it off', async () => {
    const bad = await app.inject({ method: 'POST', url: '/api/2fa/disable', headers: auth(), payload: { code: '000000' } });
    assert.equal(bad.statusCode, 400);

    const good = await app.inject({
      method: 'POST', url: '/api/2fa/disable', headers: auth(), payload: { code: generateTotp(secret) },
    });
    assert.equal(good.statusCode, 200);
    assert.equal(good.json().mfaEnabled, false);

    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: DEMO });
    assert.equal(login.statusCode, 200, 'password-only login works again');
  });
});
