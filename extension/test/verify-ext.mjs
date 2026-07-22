// Integration test for the browser extension's own source.
//
// Chrome 137+ removed the --load-extension command-line switch, so the unpacked
// extension can't be side-loaded from a script. This test instead executes the
// REAL content.js and background.js in a node:vm sandbox with the chrome.* APIs
// stubbed but a REAL fetch to the running server. It covers the genuine paths:
// DOM extraction + minimisation → message → session-backed queue + debounced
// flush → POST → the server classifier producing an alert.
//
// Prereq: the API server must be running (npm run server). Then:
//   node extension/test/verify-ext.mjs

import vm from 'node:vm';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXT_DIR = join(__dirname, '..');
const PAGE = fs.readFileSync(join(__dirname, 'risky-page.html'), 'utf8');

// Spin up our own server on an ephemeral port with an in-memory database and
// the deterministic rule engine. Self-contained: no external server needed, and
// no dependence on whichever classifier the developer has configured.
process.env.DB_PATH = ':memory:';
process.env.WARDLINE_CLASSIFIER = 'rules';
const { buildServer } = await import('../../server/src/app.ts');
const server = await buildServer({ logger: false });
await server.listen({ port: 0, host: '127.0.0.1' });
const API = `http://127.0.0.1:${server.server.address().port}`;

const title = /<title>(.*?)<\/title>/s.exec(PAGE)?.[1] ?? '';
const mainText = /<main>(.*?)<\/main>/s.exec(PAGE)?.[1].replace(/<[^>]+>/g, ' ') ?? '';

let ok = true;
const assert = (cond, msg) => { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) ok = false; };

// 1) content.js — DOM extraction + minimisation ------------------------------
console.log('1) content.js — DOM extraction + minimisation');
let captured = null;
const loadHandlers = [];
vm.runInNewContext(fs.readFileSync(join(EXT_DIR, 'content.js'), 'utf8'), {
  document: {
    title,
    querySelector: (sel) => (/main|article|role/.test(sel) ? { innerText: mainText } : null),
    body: { innerText: mainText },
  },
  location: { href: 'http://127.0.0.1:4555/risky.html' },
  navigator: { userAgent: 'Mozilla/5.0 Chrome/131.0.0.0 Safari/537.36' },
  window: { addEventListener: (evt, cb) => { if (evt === 'load') loadHandlers.push(cb); } },
  setInterval: () => 0,
  chrome: { runtime: { sendMessage: (m) => { captured = m; return Promise.resolve(); } } },
  console,
});
loadHandlers.forEach((cb) => cb());

const ev = captured?.event;
assert(!!ev, 'content script emitted an event');
assert(ev?.kind === 'page', `event.kind is "page" (got "${ev?.kind}")`);
assert(ev?.source === 'chrome', `browser detected as "chrome" (got "${ev?.source}")`);
assert(ev?.text?.includes('WARDLINE-EXT-TEST-7f3a'), 'extracted text carries the page token');
assert(ev?.text?.includes("don't tell") && ev?.text?.includes('secret'), 'extracted text carries the grooming markers');
assert((ev?.text?.length ?? 999) <= 280, `text minimised to ≤ 280 chars (got ${ev?.text?.length})`);

// 2) background.js — queue + debounced flush + POST --------------------------
console.log('\n2) background.js — queue + debounced flush + POST (real HTTP)');
const store = { session: new Map(), local: new Map(), managed: new Map() };
// The extension reads its endpoint from storage; point it at our test server.
store.local.set('ApiUrl', API);
const area = (m) => ({
  get: async (keys) => {
    if (keys == null) return Object.fromEntries(m);
    const list = Array.isArray(keys) ? keys : [keys];
    const out = {}; for (const k of list) if (m.has(k)) out[k] = m.get(k); return out;
  },
  set: async (obj) => { for (const [k, v] of Object.entries(obj)) m.set(k, v); },
});
let messageHandler = null;
let navHandler = null;
const bgSandbox = {
  chrome: {
    storage: { session: area(store.session), local: area(store.local), managed: area(store.managed) },
    runtime: {
      onMessage: { addListener: (fn) => { messageHandler = fn; } },
      onInstalled: { addListener: () => {} },
      onStartup: { addListener: () => {} },
      getURL: (p) => `chrome-extension://test/${p}`,
    },
    alarms: { create: () => {}, onAlarm: { addListener: () => {} } },
    webNavigation: { onBeforeNavigate: { addListener: (fn) => { navHandler = fn; } } },
    tabs: { update: async () => {} },
  },
  fetch: (...a) => fetch(...a),
  crypto: { randomUUID },
  setTimeout,
  URL,
  console,
};
// The service worker pulls in enforcement.js via importScripts; emulate that by
// evaluating it in the same context.
bgSandbox.importScripts = (file) => {
  vm.runInContext(fs.readFileSync(join(EXT_DIR, file), 'utf8'), ctx);
};
const ctx = vm.createContext(bgSandbox);
vm.runInContext(fs.readFileSync(join(EXT_DIR, 'background.js'), 'utf8'), ctx);
assert(!!messageHandler, 'background registered an onMessage listener');
assert(!!navHandler, 'background registered a webNavigation listener (enforcement)');
assert(!!bgSandbox.WardlineEnforce, 'enforcement.js loaded via importScripts');
messageHandler({ type: 'wardline:event', event: ev });
await new Promise((r) => setTimeout(r, 3000));

const local = Object.fromEntries(store.local);
assert(!store.session.get('queue')?.length, 'queue drained after flush');
assert(local.lastOk === true, `POST succeeded (lastOk=${local.lastOk}${local.lastError ? ', err=' + local.lastError : ''})`);
assert((local.sent ?? 0) >= 1, `sent counter incremented (sent=${local.sent})`);

// 3) live server — classifier produced an alert -----------------------------
console.log('\n3) live server — classifier produced an alert from the POST');
try {
  const token = (await (await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'renee@family.wardline.app', password: 'wardline-demo' }),
  })).json()).token;
  const alerts = (await (await fetch(`${API}/api/alerts`, { headers: { authorization: `Bearer ${token}` } })).json()).alerts;
  const hit = alerts.find((a) => (a.snippet || '').includes('WARDLINE-EXT-TEST-7f3a'));
  assert(!!hit, 'alert created from the extension POST');
  if (hit) {
    console.log(`     → ${hit.severity} | ${hit.label} | confidence ${hit.confidence} | source: ${hit.source}`);
    assert(hit.category === 'grooming', `classified as grooming (got "${hit.category}")`);
    assert(hit.source === 'chrome', 'attributed to the browser extension (source: chrome)');
  }
} catch (e) {
  assert(false, `could not reach the server at ${API} — is it running? (${e.message})`);
}

await server.close();
console.log('\n' + (ok ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'));
process.exitCode = ok ? 0 : 1; // let node exit cleanly instead of a hard process.exit
