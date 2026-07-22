import { config, DEV_JWT_SECRET } from './config.js';
import { db } from './db.js';
import { buildServer } from './app.js';
import { resolveClassifierMode } from '@wardline/classifier';

/**
 * Refuse to run in production with the built-in development JWT secret — a
 * signing key everyone can read from the repo would let anyone mint a valid
 * parent session. Set JWT_SECRET (or NODE_ENV=development to acknowledge).
 */
function assertSecretIsSafe(): void {
  if (process.env.NODE_ENV !== 'production') return;
  const secret = config.jwtSecret;
  // Reject the built-in dev key, an empty value, and anything too short to be
  // a real signing key — any of these would let sessions be forged.
  if (secret === DEV_JWT_SECRET || secret.length < 16) {
    // eslint-disable-next-line no-console
    console.error(
      'FATAL: JWT_SECRET must be set to a strong random value (at least 16 characters)\n' +
        '       when NODE_ENV=production. Set it before starting the server.',
    );
    process.exit(1);
  }
}

async function main() {
  assertSecretIsSafe();

  const clf = resolveClassifierMode();
  const clfLabel =
    clf.mode === 'rules'
      ? 'rule engine (no API key — set ANTHROPIC_API_KEY to enable AI)'
      : `${clf.mode} → ${clf.model}`;

  const app = await buildServer();

  try {
    await app.listen({ port: config.port, host: config.host });
    app.log.info(`Wardline server on http://${config.host}:${config.port}`);
    app.log.info(`Classifier: ${clfLabel}`);
    if (config.jwtSecret === DEV_JWT_SECRET) {
      app.log.warn('Using the development JWT secret — set JWT_SECRET before deploying.');
    }
  } catch (err) {
    app.log.error(err);
    db.close();
    process.exit(1);
  }
}

main();
