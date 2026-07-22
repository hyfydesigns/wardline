# Wardline

Windows-only parental monitoring, scaled down. A lightweight agent runs on a
child's PC and streams browsing/usage signals to a cloud API, which classifies
risk and pushes **alerts** — not full transcripts — to a browser-based parent
dashboard. No native mobile apps; everything for the parent is a responsive web
app.

This repository is a **runnable MVP + scaffold**:

| Package | What it is | Status |
|---|---|---|
| `classifier/` | Pluggable risk engine (grooming, self-harm, cyberbullying, explicit, drugs, violence) | ✅ runs |
| `server/` | Fastify + built-in SQLite API: auth, ingest pipeline, alerts, reports, live WebSocket | ✅ runs |
| `agent-sim/` | Node simulator that streams events like the real agent would | ✅ runs |
| `web/` | React + Vite parent dashboard, wired to the API with live updates | ✅ runs |
| `agent-win/` | .NET 8 Windows Service agent (usage telemetry + tamper watchdog) | 🧩 compiles with the .NET SDK |
| `extension/` | Manifest V3 browser extension (on-device capture + minimisation) | 🧩 loads unpacked in Chrome/Edge |

## Requirements

- **Node.js ≥ 22.5** (uses the built-in `node:sqlite` — no native build step).
- Optional, for the native pieces: **.NET 8 SDK** (build `agent-win/`) and a
  Chromium browser (load `extension/` unpacked).

## Quick start

```bash
npm install
npm run dev
```

`npm run dev` starts three things together:

- **server** — API on http://127.0.0.1:4000 (seeds a demo family on first run)
- **web** — dashboard on http://localhost:5173
- **agent** — the simulator, streaming events (a risk event lands every few
  seconds so you can watch an alert appear live)

Open http://localhost:5173 and sign in with the pre-filled demo credentials:

```
renee@family.wardline.app  /  wardline-demo
```

Leave the tab open — new alerts arrive over a WebSocket and pop a toast without
a refresh. Reset the demo data anytime with `npm run seed`.

### Run pieces individually

```bash
npm run server   # API only
npm run web      # dashboard only (proxies to the API)
npm run agent    # simulator only (needs the API up)
npm run typecheck
```

The simulator accrues screen time against the **real clock**: an hour of uptime
reports an hour of usage, so a day can never exceed 24 hours. To make a demo
move faster, set a multiplier — knowing the numbers then stop matching the wall
clock:

```bash
USAGE_SPEED=60 npm run agent   # 1 simulated minute per real second
```

## How it fits together

```
child PC ─ browser extension ─┐
          Windows agent ──────┤→ POST /api/ingest (device token)
                              │        │
                              │        ▼
                              │   classifier  ─ flags only real risk
                              │        │
                              ▼        ▼
                         events    alerts (category, severity, snippet)
                              │        │
                              │        ▼
                              │   WebSocket ─→ parent dashboard (live)
                              └─→ usage rollups ─→ reports / screen-time
```

## Enforcement (parent → device downlink)

Monitoring flows up; **enforcement flows down.** The device polls
`GET /api/policy` (device-token auth) for the household's effective policy —
category filters, custom block/allow lists, SafeSearch, schedules, and a
server-computed `activeBlock` (is the internet supposed to be off right now,
because a schedule window is active or the screen-time limit is spent).

The [browser extension](extension/enforcement.js) applies it on every
navigation: blocks category/blocklisted hosts, redirects to a
[block page](extension/blocked.html), rewrites searches to enforce SafeSearch,
and cuts everything during a scheduled block. Each block is reported back
(`kind: "blocked"`) and surfaces as **"blocked today"** on the dashboard. The
allow-list always wins, so a parent can whitelist a site the filter would catch.

The schedule/limit logic lives in a pure, unit-tested module
([policyLogic.ts](server/src/policyLogic.ts)); enforcement decisions live in a
pure extension module tested in a sandbox against real policies. With the server
running:

```bash
npm run test:enforce
```

> Enforcement currently lives in the extension (cross-browser, per-navigation).
> The Windows agent already polls the same policy; OS-level enforcement (a
> firewall/WFP block during bedtime, independent of the browser) is the natural
> next step for tamper-resistance.

## Data minimisation

Data minimisation is structural, not a promise:

- The `events` table **never stores page or message text** — only a host and kind.
- Alerts keep a short, classifier-produced **snippet**, not the raw content.
- Screenshots are opt-in and carry a retention clock (see Settings).

## The classifier (rule-based → hybrid AI)

`classifier/` exposes an async `RiskClassifier` interface and a
`createClassifier()` factory with three backings:

| Mode | Pipeline | When it's used |
|---|---|---|
| `rules` | Rule engine only — transparent, deterministic, offline | Default when no API key is set |
| `hybrid` | Cheap on-device pre-filter → **Claude** for the uncertain minority → rule fallback | Default when `ANTHROPIC_API_KEY` is set |
| `claude` | Every escalated event straight to Claude (no pre-filter) | Opt-in |

Set the backing explicitly with `WARDLINE_CLASSIFIER=rules|hybrid|claude`.

**Turn on the AI classifier** by giving the server credentials — nothing else
changes. Easiest: copy `.env.example` to `.env` in the repo root and set your
key there (`.env` is gitignored and auto-loaded on start):

```ini
# .env
ANTHROPIC_API_KEY=sk-ant-...
```

Or export it in the shell for one session (a real shell variable overrides
`.env`):

```bash
# PowerShell:  $env:ANTHROPIC_API_KEY = "sk-ant-..."
export ANTHROPIC_API_KEY="sk-ant-..."
```

On start, the server logs which classifier is active, e.g.
`Classifier: hybrid → claude-haiku-4-5` (or `rule engine (no API key …)`).

The hybrid stage matches the design doc's architecture: the
[pre-filter](classifier/src/preFilter.ts) drops the ~95% of benign, high-volume
page views on-device, and only conversational channels (messages, searches) or
pages that trip a broad concern lexicon are sent to the model. The model call
uses structured output (a JSON risk schema) at `low` effort, caches verdicts by
text hash, and gates on the same sensitivity threshold as the rule engine
(cautious / balanced / strict, set per-family from the dashboard). If the API is
unreachable or unconfigured, the hybrid **falls back to the rule engine** so
monitoring never goes dark.

**Model & cost.** The default model is `claude-haiku-4-5` — fast and low-cost,
well suited to high-volume classification. Point it at a more capable model for
harder judgement calls with one env var:

```bash
export WARDLINE_CLAUDE_MODEL="claude-opus-4-8"   # or claude-sonnet-5
```

Only the minority of events that survive the pre-filter ever reach the model, so
cost scales with *risk-adjacent* traffic, not total browsing. Set
`WARDLINE_DEBUG=1` to log model-call fallbacks.

## Building the Windows agent (`agent-win/`)

Requires the .NET 8 SDK.

```bash
cd agent-win
dotnet run                       # runs as a console app for local testing
dotnet publish -c Release -r win-x64
```

Install as a service — from an **elevated** PowerShell prompt (Run as
administrator), in the `agent-win` folder:

```powershell
.\install-service.ps1
```

The script copies `publish\` to `C:\Program Files\Wardline`, registers
`WardlineAgent` as an auto-start LocalSystem service with restart-on-failure
recovery, and starts it. Remove it with `.\uninstall-service.ps1`. Both require
elevation and refuse to run without it. Installing a service that starts as
SYSTEM and resists removal is a deliberate device-owner action, so it is never
run automatically.

Configure `ApiUrl` and `DeviceToken` in `appsettings.json` (or override with
`Wardline__ApiUrl` / `Wardline__DeviceToken` environment variables).

The tamper watchdog checks that the service auto-start entry and the browser
extension policy are intact, and sends an integrity heartbeat every cycle: a
`kind: "tamper"` event with a reason when something is wrong, or a
`kind: "integrity_ok"` event when checks pass. These **bypass the risk
classifier entirely** — integrity is never gated on matching a language rule.

The server alerts on *state changes only*, so a device doesn't spam an
identical alert every cycle:

- becoming tampered → one critical "Protection tampered with" alert, device flips to `tampered`
- the reason changing while tampered → a new alert
- still tampered after 6 h → one reminder
- integrity restored → one informational "Protection restored" alert, device flips back to `ok`

Running the agent as a plain console app (`dotnet run`) legitimately trips the
watchdog, since no service is registered; that's the expected way to see the
path work. On a dev machine with no managed extension policy the watchdog also
reports "Browser extension policy was removed" — correct, since the installer
is what deploys that policy.

## Loading the extension (`extension/`)

`chrome://extensions` → enable Developer mode → **Load unpacked** → select
`extension/`. In production the installer force-installs it via managed policy
and supplies `ApiUrl` + `DeviceToken` through `policy_schema.json`. Unpacked, it
falls back to the dev defaults and posts to the local API.

> **Note:** Chrome 137+ removed the `--load-extension` command-line switch (an
> anti-malware measure), so the extension can only be side-loaded through the
> **Load unpacked** UI or deployed via managed policy — not from a launch
> script. The extension's own logic is covered by an automated integration test
> that runs the real `content.js` and `background.js` against the live server.
> With the server running (`npm run server`):
>
> ```bash
> npm run test:ext
> ```
>
> It verifies DOM extraction + minimisation → the session-backed queue → a
> debounced flush → a real POST → the classifier producing a grooming alert.

## Tests

```bash
npm test             # unit + API integration (node:test, no deps)
npm run test:ext     # browser-extension capture pipeline
npm run test:enforce # policy + enforcement decisions
```

All three are **self-contained** — each spins up its own server on an ephemeral
port with an in-memory database and the deterministic rule engine, so they never
touch your dev server (or your API budget) and don't depend on model output.

`npm test` covers the classifier rules and pre-filter, schedule/screen-time
policy logic, password hashing, TOTP (against the RFC 6238 reference vectors),
and the HTTP surface end-to-end via Fastify's `inject` — auth, dashboard data,
ingest (alerting, idempotent re-sync, usage clamping, blocked counters), tamper
state transitions, alert status changes, the policy downlink, and the full 2FA
enrolment/enforcement flow.

## Packaging & distribution

```bash
npm run package:ext    # store-ready extension zip → dist/
npm run build:release  # agent + extension + installer (+ signing)
```

`build:release` runs four steps and **skips any step whose tool is missing**
rather than failing, so you always get the artifacts that can be produced:

1. `dotnet publish` → `dist/agent/` (outside the project dir, so repeat builds
   don't nest the previous output inside themselves)
2. extension package → `dist/wardline-extension-vX.Y.Z.zip` (validates the
   manifest, excludes tests, warns about dev defaults)
3. [`installer/wardline.iss`](installer/wardline.iss) → `dist/WardlineSetup.exe`
   — needs Inno Setup 6 (`winget install -e --id JRSoftware.InnoSetup`)
4. Authenticode signing — pass `-CertThumbprint <sha1>` or `-PfxPath <file>`

### Enrolling a PC

1. In the dashboard: **Devices → Add a device**, pick the child, name the PC.
   Wardline issues a device key and shows the install command.
2. On the child's PC, run the installer once as administrator:

   ```
   WardlineSetup.exe /DeviceToken=wl-xxxxxxxx
   ```

   Run it with no arguments and it asks for the key on a wizard page instead.

That single elevated run installs the agent to Program Files, registers it as an
auto-starting service with restart-on-failure recovery, writes its config with
the device key, and deploys the browser extension by **managed policy** —
force-installing it in Chrome and Edge and passing `ApiUrl`/`DeviceToken`
through `chrome.storage.managed`, so nothing is typed into the browser. Uninstall
stops and removes the service and reverses the policy keys.

> **Before a real release:** publish the extension to the Chrome Web Store and
> Edge Add-ons, then put the assigned extension ID into `ExtensionId` in
> `installer/wardline.iss` (the browser-policy keys are skipped while it's still
> the placeholder). Sign the build — unsigned installers trip SmartScreen.

## Deploying

The dashboard (`web/`) is a static build; the server (`server/`) is a
long-running Node process. They deploy separately and live on different origins:

| Part | Origin | Host |
|---|---|---|
| Dashboard | `wardline.app` | Cloudflare Pages (static) |
| API | `api.wardline.app` | any always-on Node host (Railway / Render / Fly / VPS) |

The dashboard learns where the API is from `VITE_API_URL`, baked in at build
time. Leave it unset for local dev (Vite proxies to `:4000`); set it to the API
origin for production.

### Dashboard → Cloudflare Pages

Project settings:

- **Build command:** `npm install && npm run build -w web`
- **Build output directory:** `web/dist`
- **Environment variable:** `VITE_API_URL = https://api.wardline.app`
- Node version comes from `.node-version` (22).

`web/public/_headers` (security headers) is copied into the build automatically; SPA fallback is handled by `not_found_handling` in `wrangler.jsonc`. Add `wardline.app` as a custom
domain in the Pages project — since DNS is already on Cloudflare, it configures
itself.

No Git repo yet? Build locally and drag `web/dist` into the Pages dashboard, or
`npx wrangler pages deploy web/dist`.

### The two things the dashboard depends on

1. **The API must be reachable at `api.wardline.app`** — point that subdomain at
   wherever the server runs.
2. **The server must allow the dashboard's origin (CORS).** Set
   `CORS_ORIGINS=https://wardline.app` in the server's environment, plus a strong
   `JWT_SECRET` and `NODE_ENV=production`. Auth uses a bearer token (not cookies),
   so there are no cross-site cookie issues to configure.

### API → Railway

The repo ships a [`Dockerfile`](Dockerfile) and [`railway.json`](railway.json),
so Railway builds and runs the server deterministically (health-checked at
`/health`).

1. **New Project → Deploy from GitHub repo →** `hyfydesigns/wardline`. Railway
   detects the Dockerfile.
2. **Add a Volume** (service → Variables/Settings → Volumes) mounted at **`/data`**
   — this is where the SQLite database lives so it survives restarts.
3. **Set service variables** (see [`server/.env.production.example`](server/.env.production.example)):
   - `NODE_ENV=production`
   - `JWT_SECRET=` a long random string (the server refuses to boot without one)
   - `DB_PATH=/data/wardline.db`
   - `CORS_ORIGINS=https://wardline.app`
   - `DEMO_PASSWORD=` a private password for the seeded demo account
   - `ANTHROPIC_API_KEY=` *(optional — turns on the hybrid AI classifier)*
   - Leave `PORT` alone; Railway sets it. `HOST=0.0.0.0` is baked into the image.
4. **Custom domain:** service → Settings → Networking → **Custom Domain** →
   `api.wardline.app`. Railway shows a CNAME target.
5. **In Cloudflare DNS**, add a `CNAME` record: `api` → *(the Railway target)*,
   set to **DNS only (grey cloud)** — Railway terminates TLS itself, and `.app`
   requires valid HTTPS, which Railway provides. (Proxying it orange-cloud needs
   Cloudflare SSL mode "Full (strict)"; DNS-only is simpler.)

Once `https://api.wardline.app/health` returns `{"ok":true}`, log into
`wardline.app` with `renee@family.wardline.app` and your `DEMO_PASSWORD`.

> **Scaling note:** SQLite on a single volume is perfect for one instance. If you
> ever run multiple API instances, move to Postgres and swap the live-alert
> broadcast (currently an in-process map) for Redis pub/sub — both are isolated
> behind small modules (`db.ts`, `realtime.ts`).

## Households & co-parents

Children, schedules, and settings belong to a **household**, not to one login.
Several parent accounts share it, so both parents see the same alerts, the same
dashboard, and the same controls — and a live alert fans out to every co-parent
watching, not just whoever's device reported it.

- **Invite** from **Settings → Household**: enter an email, get a single-use
  link that expires in 7 days (a real deployment emails it). The invitee lands
  on `/?invite=<token>`, sets a name and password, and is signed straight in.
- **Roles** — the `owner` (whoever created the household) can remove parents;
  co-parents cannot, and the owner can't be removed or remove themselves.
- **Revocation is immediate.** Membership is re-read from the database on every
  request, so removing a co-parent kills their existing session at once rather
  than waiting for their token to expire.

Existing single-parent databases migrate automatically on first boot: each
parent gets a household, and their children, schedules, and settings move across
with no data loss.

## Security

- **Two-factor authentication** — real TOTP (RFC 6238), compatible with any
  authenticator app. Enrol from **Settings → Two-factor authentication**: scan
  or paste the key, confirm with a code. Once on, sign-in requires a code, and
  turning it back off requires a current code (so a hijacked session can't
  silently disable it). Accounts without it enrolled are unaffected.
- **Passwords** are salted and hashed with scrypt; verification is constant-time.
- **JWT secret** — the server refuses to start with the built-in dev secret when
  `NODE_ENV=production`, and warns otherwise. Set `JWT_SECRET` before deploying.
- **Device tokens** authenticate the agent/extension separately from parent
  sessions; the ingest and policy endpoints never accept a parent JWT.

## Notes

- The 2FA code field on login is illustrative; wiring a TOTP/SMS provider is the
  one auth step left stubbed.
- SQLite (`server/wardline.db`) is gitignored and recreated/seeded on first boot.
```
