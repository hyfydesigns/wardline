// Enforcement verification.
//
// 1) Pure schedule/limit logic (server/src/policyLogic.ts) — deterministic.
// 2) The REAL extension/enforcement.js run in a vm sandbox against policies.
// 3) Live /api/policy shape + activeBlock, if a server is running on :4000.

import vm from 'node:vm';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { computeActiveBlock } from '../../server/src/policyLogic.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Self-contained: our own server, in-memory DB, deterministic rule engine.
process.env.DB_PATH = ':memory:';
process.env.WARDLINE_CLASSIFIER = 'rules';
const { buildServer } = await import('../../server/src/app.ts');
const server = await buildServer({ logger: false });
await server.listen({ port: 0, host: '127.0.0.1' });
const API = `http://127.0.0.1:${server.server.address().port}`;

let ok = true;
const assert = (cond, msg) => { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) ok = false; };

// ---- 1) pure schedule / screen-time logic ---------------------------------
console.log('1) policyLogic.computeActiveBlock — schedule + limit');
const bedtime = { name: 'Bedtime', kind: 'bedtime', days: [0, 1, 2, 3, 4, 5, 6], startMin: 21 * 60, endMin: 23 * 60, scope: 'all internet' };
// A Wednesday at 21:30 → inside bedtime.
const wed2130 = new Date('2026-01-07T21:30:00'); // 2026-01-07 is a Wednesday
assert(computeActiveBlock([bedtime], 240, 0, wed2130).activeBlock.blocked, 'inside a bedtime window → blocked');
assert(computeActiveBlock([bedtime], 240, 0, wed2130).activeBlock.reason === 'Bedtime', 'reason is the schedule name');
// Same day at 15:00 → outside bedtime, under limit → not blocked.
const wed1500 = new Date('2026-01-07T15:00:00');
assert(!computeActiveBlock([bedtime], 240, 100, wed1500).activeBlock.blocked, 'outside window + under limit → not blocked');
// Over the screen-time limit → blocked with the limit reason.
const overLimit = computeActiveBlock([bedtime], 240, 260, wed1500).activeBlock;
assert(overLimit.blocked && overLimit.reason === 'Daily screen-time limit reached', 'over screen-time limit → blocked');

// ---- 2) enforcement.js decision logic -------------------------------------
console.log('\n2) enforcement.js — evaluate() + SafeSearch (real extension source)');
const sandbox = { URL, console };
vm.runInNewContext(fs.readFileSync(join(__dirname, '..', 'enforcement.js'), 'utf8'), sandbox);
const E = sandbox.WardlineEnforce;

const basePolicy = {
  filters: { adult: true, gambling: true, social: true, gaming: false, streaming: false },
  safeSearch: true,
  blocked: ['omegle.com'],
  allowed: ['reddit.com'],
  activeBlock: { blocked: false, reason: null },
};

assert(E.evaluate(basePolicy, 'https://www.instagram.com/feed').block, 'social filter on → instagram blocked');
assert(!E.evaluate(basePolicy, 'https://store.steampowered.com/').block, 'gaming filter off → steam allowed');
assert(E.evaluate(basePolicy, 'https://omegle.com/chat').block, 'custom block-list → omegle blocked');
assert(!E.evaluate(basePolicy, 'https://old.reddit.com/r/x').block, 'allow-list overrides the social filter → reddit allowed');
assert(!E.evaluate(basePolicy, 'https://en.wikipedia.org/wiki/X').block, 'benign site → allowed');

const bedtimePolicy = { ...basePolicy, activeBlock: { blocked: true, reason: 'Bedtime' } };
const dinnerVerdict = E.evaluate(bedtimePolicy, 'https://en.wikipedia.org/wiki/X');
assert(dinnerVerdict.block && dinnerVerdict.reason === 'Bedtime', 'active schedule block → even benign sites blocked');
assert(!E.evaluate(bedtimePolicy, 'https://reddit.com/').block, 'allow-list still wins during a scheduled block');

const rewrite = E.enforceSafeSearch(basePolicy, 'https://www.google.com/search?q=puppies');
assert(rewrite && rewrite.includes('safe=active'), `SafeSearch rewrites google search → ${rewrite ? 'safe=active added' : 'no rewrite'}`);
assert(E.enforceSafeSearch(basePolicy, 'https://www.google.com/search?q=x&safe=active') === null, 'already-safe search → no rewrite');

// ---- 3) live /api/policy --------------------------------------------------
console.log('\n3) live /api/policy (device-authed)');
try {
  const res = await fetch(`${API}/api/policy`, { headers: { authorization: 'Bearer wl-dev-marcus-pc' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const p = await res.json();
  assert(typeof p.policyVersion === 'string' && p.policyVersion.length > 0, 'returns a policyVersion');
  assert(p.filters && p.filters.gambling === true && p.filters.social === false, 'filters reflect seeded settings');
  assert(Array.isArray(p.blocked) && p.blocked.includes('omegle.com'), 'custom block-list present');
  assert(Array.isArray(p.schedules) && p.schedules.length === 3, 'three household schedules');
  assert(p.screenTime && p.screenTime.limitMin === 240, 'screen-time limit present');
  assert(p.activeBlock && typeof p.activeBlock.blocked === 'boolean', 'activeBlock computed');
  console.log(`     → activeBlock right now: ${JSON.stringify(p.activeBlock)}`);
} catch (e) {
  assert(false, `could not reach ${API}/api/policy — is the server running? (${e.message})`);
}

await server.close();
console.log('\n' + (ok ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'));
process.exitCode = ok ? 0 : 1;
