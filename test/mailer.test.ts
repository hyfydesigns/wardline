import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolveMailerProvider } from '../server/src/mailer.ts';

describe('mailer provider resolution', () => {
  test('defaults to console without a key', () => {
    const original = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    try {
      assert.equal(resolveMailerProvider(), 'console');
    } finally {
      if (original !== undefined) process.env.RESEND_API_KEY = original;
    }
  });

  test('resolves to resend once a key is set', () => {
    const original = process.env.RESEND_API_KEY;
    process.env.RESEND_API_KEY = 'test-key';
    try {
      assert.equal(resolveMailerProvider(), 'resend');
    } finally {
      if (original === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = original;
    }
  });
});
