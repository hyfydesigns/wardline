import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { RuleBasedClassifier, shouldEscalate, type MonitoredEvent } from '@wardline/classifier';

const ev = (over: Partial<MonitoredEvent> & { kind: string }): MonitoredEvent => ({
  eventId: 'e1',
  deviceId: 'd1',
  occurredAt: new Date().toISOString(),
  source: 'chrome',
  text: '',
  ...over,
});

describe('rule-based classifier', () => {
  const clf = new RuleBasedClassifier({ threshold: 0.45 });

  test('flags grooming language as critical', async () => {
    const v = await clf.classify(ev({ kind: 'message', text: "how old are you? don't tell your mom, this is our secret" }));
    assert.equal(v.flagged, true);
    assert.equal(v.category, 'grooming');
    assert.equal(v.severity, 'critical');
    assert.ok((v.confidence ?? 0) >= 0.45);
  });

  test('flags self-harm ideation as critical', async () => {
    const v = await clf.classify(ev({ kind: 'search', text: 'i want to kill myself' }));
    assert.equal(v.flagged, true);
    assert.equal(v.category, 'self_harm');
    assert.equal(v.severity, 'critical');
  });

  test('flags cyberbullying as concerning', async () => {
    const v = await clf.classify(ev({ kind: 'message', text: "you're such a loser, nobody likes you" }));
    assert.equal(v.flagged, true);
    assert.equal(v.category, 'cyberbullying');
    assert.equal(v.severity, 'concerning');
  });

  test('does not flag benign content', async () => {
    for (const text of [
      'photosynthesis is how plants convert light into energy',
      'hey are you coming to practice after school?',
      'how long to boil an egg',
    ]) {
      const v = await clf.classify(ev({ kind: 'message', text }));
      assert.equal(v.flagged, false, `should not flag: ${text}`);
    }
  });

  test('snippet is minimised, never the full text', async () => {
    const long = 'x'.repeat(400) + " don't tell your mom, our secret " + 'y'.repeat(400);
    const v = await clf.classify(ev({ kind: 'message', text: long }));
    assert.equal(v.flagged, true);
    assert.ok(v.snippet!.length <= 130, `snippet ${v.snippet!.length} chars should be ~120`);
    assert.ok(v.snippet!.length < long.length);
  });

  test('sensitivity threshold gates weak matches', async () => {
    const strict = new RuleBasedClassifier({ threshold: 0.99 });
    const v = await strict.classify(ev({ kind: 'message', text: 'getting high tonight' }));
    assert.equal(v.flagged, false, 'a weak single signal is below a 0.99 threshold');
  });
});

describe('pre-filter (volume gate)', () => {
  test('always escalates conversational channels with real text', () => {
    assert.equal(shouldEscalate(ev({ kind: 'message', text: 'hey are you coming to practice today' })).escalate, true);
    assert.equal(shouldEscalate(ev({ kind: 'search', text: 'quadratic formula examples' })).escalate, true);
  });

  test('drops trivially short conversational text', () => {
    assert.equal(shouldEscalate(ev({ kind: 'message', text: 'ok' })).escalate, false);
  });

  test('drops benign page views but escalates concern-lexicon pages', () => {
    assert.equal(
      shouldEscalate(ev({ kind: 'page', url: 'https://en.wikipedia.org/wiki/Photosynthesis', text: 'Photosynthesis is the process plants use.' })).escalate,
      false,
    );
    assert.equal(
      shouldEscalate(ev({ kind: 'page', text: 'a news article discussing weed legalisation' })).escalate,
      true,
    );
  });
});
