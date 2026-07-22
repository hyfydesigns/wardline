import type { MonitoredEvent, RiskClassifier, RiskVerdict } from './types.js';
import { RuleBasedClassifier } from './ruleBasedClassifier.js';
import { ClaudeClassifier } from './claudeClassifier.js';
import { shouldEscalate } from './preFilter.js';

/**
 * The hybrid pipeline the design doc describes:
 *
 *   event → cheap on-device pre-filter → (uncertain/risky?) → Claude → verdict
 *                                       ↘ (benign) → dropped
 *
 * The rule engine plays two roles: a fast signal that always forces escalation
 * when it already matches something, and the OFFLINE FALLBACK used when the
 * model is unreachable or unconfigured — so the system degrades gracefully
 * rather than going dark.
 */
export class HybridClassifier implements RiskClassifier {
  readonly name = 'hybrid-v1';

  constructor(
    private readonly rules: RuleBasedClassifier,
    private readonly claude: ClaudeClassifier | null,
  ) {}

  async classify(event: MonitoredEvent): Promise<RiskVerdict> {
    const rulesVerdict = await this.rules.classify(event);

    // Escalate if the pre-filter says so, OR the rules already caught something.
    const escalate = shouldEscalate(event).escalate || rulesVerdict.flagged;
    if (!escalate) return { flagged: false };

    if (!this.claude) return rulesVerdict; // no model configured → rules stand in

    try {
      return await this.claude.classify(event);
    } catch (err) {
      // API/auth/network failure: fall back to the rule verdict so nothing is
      // silently dropped. Logged once per process would be ideal; keep it quiet
      // here to avoid log spam on a missing key.
      if (process.env.WARDLINE_DEBUG) {
        // eslint-disable-next-line no-console
        console.warn('[hybrid] model call failed, using rule fallback:', (err as Error).message);
      }
      return rulesVerdict;
    }
  }
}
