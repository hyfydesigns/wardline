import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  base32Encode,
  base32Decode,
  generateSecret,
  generateTotp,
  verifyTotp,
  otpauthUri,
  TOTP_STEP_SECONDS,
} from '../server/src/totp.ts';

describe('TOTP', () => {
  test('base32 round-trips', () => {
    const buf = Buffer.from('Wardline test vector!');
    assert.equal(base32Decode(base32Encode(buf)).toString(), buf.toString());
  });

  test('matches RFC 6238 reference vectors (SHA-1)', () => {
    // RFC 6238 uses ASCII secret "12345678901234567890".
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    // Known SHA-1 TOTP values at the RFC's sample timestamps.
    assert.equal(generateTotp(secret, 59 * 1000), '287082');
    assert.equal(generateTotp(secret, 1111111109 * 1000), '081804');
    assert.equal(generateTotp(secret, 1234567890 * 1000), '005924');
  });

  test('generated secrets verify against their own current code', () => {
    const secret = generateSecret();
    const now = Date.now();
    assert.equal(verifyTotp(secret, generateTotp(secret, now), now), true);
  });

  test('rejects a wrong code', () => {
    const secret = generateSecret();
    const now = Date.now();
    const wrong = generateTotp(secret, now) === '000000' ? '111111' : '000000';
    assert.equal(verifyTotp(secret, wrong, now), false);
  });

  test('tolerates one step of clock drift, rejects two', () => {
    const secret = generateSecret();
    const now = Date.now();
    const stepMs = TOTP_STEP_SECONDS * 1000;
    const prev = generateTotp(secret, now - stepMs);
    const twoBack = generateTotp(secret, now - 2 * stepMs);
    assert.equal(verifyTotp(secret, prev, now), true, 'previous step accepted');
    assert.equal(verifyTotp(secret, twoBack, now), false, 'two steps back rejected');
  });

  test('rejects malformed input', () => {
    const secret = generateSecret();
    for (const bad of ['', '12345', '1234567', 'abcdef', '  ']) {
      assert.equal(verifyTotp(secret, bad), false, `rejects ${JSON.stringify(bad)}`);
    }
  });

  test('otpauth URI carries the secret and issuer', () => {
    const uri = otpauthUri('JBSWY3DPEHPK3PXP', 'renee@example.com');
    assert.ok(uri.startsWith('otpauth://totp/'));
    assert.ok(uri.includes('secret=JBSWY3DPEHPK3PXP'));
    assert.ok(uri.includes('issuer=Wardline'));
  });
});
