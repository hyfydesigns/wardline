import {
  CATEGORY_LABELS,
  CATEGORY_SEVERITY,
  type MonitoredEvent,
  type RiskCategory,
  type RiskClassifier,
  type RiskVerdict,
} from './types.js';
import { RULES, HOST_CATEGORIES } from './rules.js';
import { centeredSnippet, truncate } from './snippet.js';

export interface RuleBasedOptions {
  /**
   * Minimum aggregated confidence to raise an alert. Maps to the dashboard's
   * "detection sensitivity" control (cautious ≈ 0.6, balanced ≈ 0.45, strict ≈ 0.3).
   */
  threshold?: number;
  /** Max characters kept in the parent-facing snippet. */
  snippetLength?: number;
}

/**
 * Transparent, auditable classifier used for the MVP. Aggregates weighted
 * rule matches per category, picks the strongest category, and emits a
 * minimised snippet rather than the raw text.
 */
export class RuleBasedClassifier implements RiskClassifier {
  readonly name = 'rule-based-v1';
  private threshold: number;
  private snippetLength: number;

  constructor(opts: RuleBasedOptions = {}) {
    this.threshold = opts.threshold ?? 0.45;
    this.snippetLength = opts.snippetLength ?? 120;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async classify(event: MonitoredEvent): Promise<RiskVerdict> {
    const text = event.text ?? '';

    // 1) Host-based category match (policy) — informational unless the text
    //    also trips a linguistic rule below.
    let hostCategory: RiskCategory | undefined;
    if (event.url) {
      for (const h of HOST_CATEGORIES) {
        if (h.pattern.test(event.url)) {
          hostCategory = h.category;
          break;
        }
      }
    }

    // 2) Aggregate weighted linguistic signals per category.
    const scores = new Map<RiskCategory, number>();
    let firstMatchIndex = -1;
    for (const rule of RULES) {
      const m = rule.pattern.exec(text);
      if (m) {
        scores.set(rule.category, (scores.get(rule.category) ?? 0) + rule.weight);
        if (firstMatchIndex < 0 || m.index < firstMatchIndex) firstMatchIndex = m.index;
      }
    }

    // Pick the highest-scoring category.
    let best: RiskCategory | undefined;
    let bestScore = 0;
    for (const [cat, score] of scores) {
      if (score > bestScore) {
        best = cat;
        bestScore = score;
      }
    }

    if (best) {
      const confidence = Math.min(0.99, Number(bestScore.toFixed(2)));
      if (confidence < this.threshold) {
        return { flagged: false };
      }
      return {
        flagged: true,
        category: best,
        severity: CATEGORY_SEVERITY[best],
        confidence,
        label: CATEGORY_LABELS[best],
        snippet: centeredSnippet(text, firstMatchIndex, this.snippetLength),
      };
    }

    // 3) No linguistic risk, but a policy/host match → informational alert.
    if (hostCategory) {
      return {
        flagged: true,
        category: hostCategory,
        severity: 'informational',
        label: CATEGORY_LABELS[hostCategory],
        snippet: event.url ? truncate(event.url, this.snippetLength) : undefined,
      };
    }

    return { flagged: false };
  }
}
