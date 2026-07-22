import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeActiveBlock, mondayIndex, type Schedule } from '../server/src/policyLogic.ts';
import { hashPassword, verifyPassword } from '../server/src/auth.ts';

const bedtime: Schedule = {
  name: 'Bedtime', kind: 'bedtime', days: [0, 1, 2, 3, 4, 5, 6],
  startMin: 21 * 60, endMin: 23 * 60, scope: 'all internet',
};
const school: Schedule = {
  name: 'School hours', kind: 'school', days: [0, 1, 2, 3, 4], // Mon–Fri
  startMin: 8 * 60, endMin: 14 * 60, scope: 'all internet',
};

// 2026-01-07 is a Wednesday; 2026-01-10 is a Saturday.
const wed = (h: number, m = 0) => new Date(`2026-01-07T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`);
const sat = (h: number) => new Date(`2026-01-10T${String(h).padStart(2, '0')}:00:00`);

describe('mondayIndex', () => {
  test('maps JS days to Monday-first indices', () => {
    assert.equal(mondayIndex(new Date('2026-01-05T12:00:00')), 0, 'Monday → 0');
    assert.equal(mondayIndex(new Date('2026-01-07T12:00:00')), 2, 'Wednesday → 2');
    assert.equal(mondayIndex(new Date('2026-01-11T12:00:00')), 6, 'Sunday → 6');
  });
});

describe('computeActiveBlock', () => {
  test('blocks inside a schedule window, naming the schedule', () => {
    const r = computeActiveBlock([bedtime], 240, 0, wed(21, 30));
    assert.equal(r.activeBlock.blocked, true);
    assert.equal(r.activeBlock.reason, 'Bedtime');
  });

  test('allows outside the window when under the limit', () => {
    assert.equal(computeActiveBlock([bedtime], 240, 100, wed(15)).activeBlock.blocked, false);
  });

  test('window boundaries are inclusive-start, exclusive-end', () => {
    assert.equal(computeActiveBlock([bedtime], 240, 0, wed(21, 0)).activeBlock.blocked, true, 'start is blocked');
    assert.equal(computeActiveBlock([bedtime], 240, 0, wed(23, 0)).activeBlock.blocked, false, 'end is free');
  });

  test('respects the days of the week', () => {
    assert.equal(computeActiveBlock([school], 240, 0, wed(10)).activeBlock.blocked, true, 'Wednesday is a school day');
    assert.equal(computeActiveBlock([school], 240, 0, sat(10)).activeBlock.blocked, false, 'Saturday is not');
  });

  test('blocks when the screen-time limit is spent', () => {
    const r = computeActiveBlock([bedtime], 240, 260, wed(15));
    assert.equal(r.activeBlock.blocked, true);
    assert.equal(r.activeBlock.reason, 'Daily screen-time limit reached');
  });

  test('limit exactly reached counts as spent', () => {
    assert.equal(computeActiveBlock([], 240, 240, wed(15)).activeBlock.blocked, true);
    assert.equal(computeActiveBlock([], 240, 239, wed(15)).activeBlock.blocked, false);
  });

  test('an active schedule takes precedence over the limit reason', () => {
    const r = computeActiveBlock([bedtime], 240, 999, wed(21, 30));
    assert.equal(r.activeBlock.reason, 'Bedtime');
  });

  test('non-"all internet" scopes do not trigger a global block', () => {
    const scoped: Schedule = { ...bedtime, scope: 'social media' };
    assert.equal(computeActiveBlock([scoped], 240, 0, wed(21, 30)).activeBlock.blocked, false);
  });
});

describe('password hashing', () => {
  test('verifies the correct password', () => {
    const stored = hashPassword('correct horse battery staple');
    assert.equal(verifyPassword('correct horse battery staple', stored), true);
  });

  test('rejects the wrong password', () => {
    const stored = hashPassword('correct horse battery staple');
    assert.equal(verifyPassword('Correct horse battery staple', stored), false);
  });

  test('salts: the same password hashes differently each time', () => {
    assert.notEqual(hashPassword('same'), hashPassword('same'));
  });

  test('tolerates malformed stored values without throwing', () => {
    assert.equal(verifyPassword('x', 'not-a-valid-hash'), false);
    assert.equal(verifyPassword('x', ''), false);
  });
});
