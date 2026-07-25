import { db, initSchema } from './db.js';
import { hashPassword } from './auth.js';

const DAY_MS = 86_400_000;

/** Fixed demo device tokens so the agent simulator can enrol without a UI. */
export const DEMO_TOKENS = {
  marcus: 'wl-dev-marcus-pc',
  ava: 'wl-dev-ava-laptop',
};

export const DEMO_LOGIN = {
  email: 'renee@family.wardline.app',
  // Overridable so a public deployment isn't seeded with the repo's known
  // password. Set DEMO_PASSWORD in production.
  password: process.env.DEMO_PASSWORD ?? 'wardline-demo',
};

function dayStr(offset: number): string {
  return new Date(Date.now() - offset * DAY_MS).toISOString().slice(0, 10);
}

/** Build an ISO timestamp for `offset` days ago at HH:MM local-ish. */
function at(offsetDays: number, hh: number, mm: number): string {
  const d = new Date(Date.now() - offsetDays * DAY_MS);
  d.setHours(hh, mm, 0, 0);
  return d.toISOString();
}

export const DEFAULT_SETTINGS = {
  filters: { adult: true, gambling: true, social: false, gaming: false, streaming: false },
  safeSearch: true,
  customBlocked: ['omegle.com', '4chan.org'],
  customAllowed: [],
  alerts: { sensitivity: 'balanced', email: true, push: true },
  screenshots: { enabled: false, retentionDays: 30 },
};

export function seedIfEmpty(): void {
  // Production deployments set WARDLINE_DISABLE_DEMO_SEED so the database starts
  // empty and real users sign up, instead of landing in the demo household.
  if (process.env.WARDLINE_DISABLE_DEMO_SEED) return;
  const count = (db.prepare(`SELECT COUNT(*) AS n FROM parents`).get() as { n: number }).n;
  if (count > 0) return;
  seed();
}

export function seed(): void {
  const now = new Date().toISOString();

  // The household owns the children, schedules, and settings; parents belong to it.
  db.prepare(
    `INSERT INTO households (id, name, plan, settings_json, created_at) VALUES (?, ?, 'family', ?, ?)`,
  ).run('hh_demo', "Renee's household", JSON.stringify(DEFAULT_SETTINGS), now);

  db.prepare(
    `INSERT INTO parents (id, household_id, role, email, password_hash, name, plan, settings_json, created_at, email_verified)
     VALUES (?, 'hh_demo', 'owner', ?, ?, ?, 'family', '{}', ?, 1)`,
  ).run('p_renee', DEMO_LOGIN.email, hashPassword(DEMO_LOGIN.password), 'Renee', now);

  const insChild = db.prepare(
    `INSERT INTO children (id, parent_id, household_id, name, color, screen_limit_min) VALUES (?, 'p_renee', 'hh_demo', ?, ?, ?)`,
  );
  insChild.run('c_marcus', 'Marcus', 'marcus', 240);
  insChild.run('c_ava', 'Ava', 'ava', 120);

  db.prepare(
    `INSERT INTO devices (id, child_id, name, agent_version, device_token, browser_coverage, tamper_status, last_seen)
     VALUES (?, ?, ?, 'v1.4.2', ?, ?, 'ok', ?)`,
  ).run('d_marcus', 'c_marcus', 'Marcus-PC', DEMO_TOKENS.marcus, 'Chrome, Edge — active', new Date(Date.now() - 2 * 60_000).toISOString());
  db.prepare(
    `INSERT INTO devices (id, child_id, name, agent_version, device_token, browser_coverage, tamper_status, last_seen)
     VALUES (?, ?, ?, 'v1.4.2', ?, ?, 'ok', ?)`,
  ).run('d_ava', 'c_ava', 'Ava-Laptop', DEMO_TOKENS.ava, 'Chrome active · Edge pending approval', new Date(Date.now() - 14 * 60_000).toISOString());

  // ---- Historical screen time + usage (last 7 days) ----
  const marcusDaily = [210, 245, 198, 260, 305, 340, 222]; // index 6 = today
  const avaDaily = [70, 95, 60, 110, 130, 150, 70];
  const marcusMix: [string, number][] = [['Social', 0.38], ['Gaming', 0.27], ['Streaming', 0.18], ['Homework', 0.12], ['Other', 0.05]];
  const avaMix: [string, number][] = [['Streaming', 0.4], ['Homework', 0.3], ['Social', 0.2], ['Gaming', 0.1]];

  const insScreen = db.prepare(`INSERT OR REPLACE INTO screen_time (child_id, day, minutes) VALUES (?, ?, ?)`);
  const insUsage = db.prepare(`INSERT OR REPLACE INTO usage (child_id, day, category, minutes) VALUES (?, ?, ?, ?)`);
  const fill = (childId: string, daily: number[], mix: [string, number][]) => {
    daily.forEach((minutes, i) => {
      const day = dayStr(daily.length - 1 - i);
      insScreen.run(childId, day, minutes);
      for (const [cat, ratio] of mix) insUsage.run(childId, day, cat, Math.round(minutes * ratio));
    });
  };
  fill('c_marcus', marcusDaily, marcusMix);
  fill('c_ava', avaDaily, avaMix);

  // ---- Seed alerts (mirrors the walkthrough scenario) ----
  const insAlert = db.prepare(
    `INSERT INTO alerts (id, child_id, device_id, event_id, category, severity, confidence, label, snippet, source, occurred_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insAlert.run('al_1', 'c_marcus', 'd_marcus', 'seed_1', 'grooming', 'critical', 0.91, 'Predatory / grooming language', "…don't tell your mom we talked, ok? this can be our secret…", 'Discord (web)', at(0, 10, 42), 'open');
  insAlert.run('al_2', 'c_marcus', 'd_marcus', 'seed_2', 'self_harm', 'critical', 0.74, 'Self-harm / mental health', 'Search included phrasing associated with self-harm.', 'Google Search', at(1, 21, 15), 'reviewed');
  insAlert.run('al_3', 'c_marcus', 'd_marcus', 'seed_3', 'cyberbullying', 'concerning', 0.68, 'Cyberbullying', 'Repeated insults from another user in a group conversation.', 'Group chat', at(2, 16, 30), 'reviewed');
  insAlert.run('al_4', 'c_ava', 'd_ava', 'seed_4', 'explicit', 'informational', null, 'Gambling-adjacent content', 'A prize-wheel game site was visited briefly, no purchase detected.', 'Chrome', at(3, 15, 10), 'reviewed');
  insAlert.run('al_5', 'c_marcus', 'd_marcus', 'seed_5', 'explicit', 'informational', null, 'Policy enforcement', 'Wardline restored the enforced SafeSearch setting automatically.', 'Chrome settings', at(5, 9, 5), 'reviewed');

  // ---- Household schedule ----
  const insSched = db.prepare(
    `INSERT INTO schedules (id, parent_id, household_id, name, kind, days, start_min, end_min, scope) VALUES (?, 'p_renee', 'hh_demo', ?, ?, ?, ?, ?, ?)`,
  );
  insSched.run('s_school', 'School hours', 'school', '0,1,2,3,4', 8 * 60, 14 * 60, 'all internet');
  insSched.run('s_dinner', 'Dinner', 'dinner', '0,1,2,3,4,5,6', 18 * 60, 19 * 60, 'all internet');
  insSched.run('s_bed', 'Bedtime', 'bedtime', '0,1,2,3,4,5,6', 21 * 60, 23 * 60, 'all internet');

  // eslint-disable-next-line no-console
  console.log('Seeded demo data. Login:', DEMO_LOGIN.email, '/', DEMO_LOGIN.password);
}

/** `npm run seed` — reset all data and reseed. */
function resetAndSeed(): void {
  initSchema();
  for (const t of ['alerts', 'usage', 'screen_time', 'events', 'schedules', 'devices', 'children', 'invitations', 'parents', 'households']) {
    db.exec(`DELETE FROM ${t};`);
  }
  seed();
}

// Run reset when invoked directly (tsx src/seed.ts).
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('seed.ts')) {
  resetAndSeed();
  db.close();
}
