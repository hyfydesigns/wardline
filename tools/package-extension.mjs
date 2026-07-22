// Build a store-ready extension package.
//
//   npm run package:ext
//
// Validates the manifest, refuses to ship development defaults, copies only the
// files a store listing should contain (no tests), and emits a zip to dist/.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extDir = path.join(root, 'extension');
const distDir = path.join(root, 'dist');
const stageDir = path.join(distDir, 'extension-pkg');

/** Files that belong in the published extension. Everything else is excluded. */
const SHIP = [
  'manifest.json',
  'policy_schema.json',
  'background.js',
  'content.js',
  'enforcement.js',
  'blocked.html',
  'blocked.js',
  'popup.html',
  'popup.js',
];

const problems = [];
const warn = [];

// ---- validate the manifest -------------------------------------------------
const manifestPath = path.join(extDir, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

if (manifest.manifest_version !== 3) problems.push('manifest_version must be 3');
for (const field of ['name', 'version', 'description']) {
  if (!manifest[field]) problems.push(`manifest.${field} is required for a store listing`);
}
if (!/^\d+(\.\d+){0,3}$/.test(manifest.version ?? '')) {
  problems.push(`manifest.version "${manifest.version}" must be 1–4 dot-separated integers`);
}
if ((manifest.description ?? '').length > 132) {
  problems.push('manifest.description must be 132 characters or fewer (store limit)');
}
if (manifest.host_permissions?.includes('<all_urls>')) {
  warn.push('host_permissions uses <all_urls> — expect extended store review; justify it in the listing');
}

// ---- every shipped file must exist, and nothing may reference a dev default -
for (const file of SHIP) {
  if (!fs.existsSync(path.join(extDir, file))) problems.push(`missing file: ${file}`);
}

const background = fs.readFileSync(path.join(extDir, 'background.js'), 'utf8');
if (/DeviceToken:\s*'wl-dev-/.test(background)) {
  warn.push("background.js still carries the dev DeviceToken fallback — harmless (managed policy overrides it) but consider stripping for release");
}
if (/ApiUrl:\s*'http:\/\/127\.0\.0\.1/.test(background) && process.env.WARDLINE_RELEASE === '1') {
  problems.push('background.js points at localhost while WARDLINE_RELEASE=1 — set a production ApiUrl default');
}

if (problems.length) {
  console.error('Cannot package the extension:\n' + problems.map((p) => `  ✗ ${p}`).join('\n'));
  process.exit(1);
}

// ---- stage and zip ---------------------------------------------------------
fs.rmSync(stageDir, { recursive: true, force: true });
fs.mkdirSync(stageDir, { recursive: true });
for (const file of SHIP) fs.copyFileSync(path.join(extDir, file), path.join(stageDir, file));

const zipPath = path.join(distDir, `wardline-extension-v${manifest.version}.zip`);
fs.rmSync(zipPath, { force: true });

// Node has no zip built in; PowerShell ships with Windows.
execFileSync(
  'powershell',
  ['-NoProfile', '-Command', `Compress-Archive -Path '${stageDir}\\*' -DestinationPath '${zipPath}' -Force`],
  { stdio: 'inherit' },
);
fs.rmSync(stageDir, { recursive: true, force: true });

const sizeKb = (fs.statSync(zipPath).size / 1024).toFixed(1);
for (const w of warn) console.warn(`  ! ${w}`);
console.log(`\n✓ ${manifest.name} v${manifest.version} → ${path.relative(root, zipPath)} (${sizeKb} KB, ${SHIP.length} files)`);
console.log('  Upload to the Chrome Web Store / Edge Add-ons dashboard.');
console.log('  After publishing, put the assigned extension ID in installer/wardline.iss (ExtensionId).');
