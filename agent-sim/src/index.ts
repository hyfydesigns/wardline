import { randomUUID } from 'node:crypto';
import { BENIGN, RISKY, USAGE_CATEGORIES, type SimEvent } from './scenarios.js';

/**
 * Wardline agent simulator.
 *
 * Stands in for the real Windows service + browser extensions: it enrols as a
 * device (using a demo token) and streams events to the ingest API. Benign
 * traffic and usage rollups flow constantly; a risk event is injected every
 * few ticks so you can watch an alert appear on the dashboard in real time.
 *
 *   npm run agent           # continuous
 *   npm run once -w agent-sim   # one burst then exit (used by verification)
 */

const API = process.env.API_URL ?? 'http://127.0.0.1:4000';
const TICK_MS = Number(process.env.TICK_MS ?? 4000);
const ONCE = process.argv.includes('--once');

/**
 * Screen-time accrual multiplier. 1 = real time, which is the honest default:
 * an hour of simulator uptime reports an hour of screen time. Raise it only to
 * make a demo move faster, knowing the numbers stop matching the wall clock.
 */
const USAGE_SPEED = Number(process.env.USAGE_SPEED ?? 1);

// Fractional minutes carried between ticks, per device. Ticks are far shorter
// than a minute, so we bank the remainder instead of rounding up every tick —
// that rounding is what previously inflated a day past 24 hours.
const usageDebt = new Map<string, number>();
let lastTickAt = Date.now();

const DEVICES = [
  { name: 'Marcus-PC', token: process.env.MARCUS_TOKEN ?? 'wl-dev-marcus-pc', risky: true },
  { name: 'Ava-Laptop', token: process.env.AVA_TOKEN ?? 'wl-dev-ava-laptop', risky: false },
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function toIngest(ev: SimEvent) {
  return {
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    source: ev.source,
    kind: ev.kind,
    text: ev.text,
    url: ev.url,
    category: ev.category,
    minutes: ev.minutes,
  };
}

async function send(token: string, events: SimEvent[]): Promise<void> {
  try {
    const res = await fetch(`${API}/api/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ events: events.map(toIngest) }),
    });
    if (!res.ok) {
      console.error(`  ✗ ingest ${res.status}: ${await res.text()}`);
      return;
    }
    const body = (await res.json()) as { accepted: number; alerts: number };
    const flag = body.alerts > 0 ? `  ⚠ ${body.alerts} alert(s)` : '';
    console.log(`  → sent ${body.accepted} event(s)${flag}`);
  } catch (err) {
    console.error('  ✗ could not reach ingest API:', (err as Error).message);
  }
}

/**
 * Convert time actually elapsed since the last tick into whole usage minutes,
 * banking the remainder. Returns null when less than a minute has accrued.
 */
function accrueUsage(deviceName: string, elapsedMin: number): SimEvent | null {
  const banked = (usageDebt.get(deviceName) ?? 0) + elapsedMin;
  const whole = Math.floor(banked);
  usageDebt.set(deviceName, banked - whole);
  if (whole < 1) return null;
  return { source: 'system', kind: 'usage', category: pick(USAGE_CATEGORIES), minutes: whole };
}

let tick = 0;
async function runTick(): Promise<void> {
  tick++;
  const now = Date.now();
  const elapsedMin = ((now - lastTickAt) / 60_000) * USAGE_SPEED;
  lastTickAt = now;

  for (const device of DEVICES) {
    const batch: SimEvent[] = [pick(BENIGN)];
    const usage = accrueUsage(device.name, elapsedMin);
    if (usage) batch.push(usage);
    // Inject a risk event on Marcus's device every 5th tick.
    if (device.risky && tick % 5 === 0) batch.push(pick(RISKY));
    console.log(`[tick ${tick}] ${device.name}`);
    await send(device.token, batch);
  }
}

async function main(): Promise<void> {
  console.log(`Wardline agent simulator → ${API}`);
  if (ONCE) {
    // Deterministic burst for verification: one benign + one risky per device.
    const oneMinute: SimEvent = { source: 'system', kind: 'usage', category: 'Homework', minutes: 1 };
    await send(DEVICES[0].token, [BENIGN[0], oneMinute, RISKY[0], RISKY[1]]);
    await send(DEVICES[1].token, [BENIGN[1], oneMinute]);
    console.log('Done (--once).');
    return;
  }
  await runTick();
  setInterval(runTick, TICK_MS);
}

main();
