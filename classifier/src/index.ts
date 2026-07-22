export * from './types.js';
export { RuleBasedClassifier } from './ruleBasedClassifier.js';
export type { RuleBasedOptions } from './ruleBasedClassifier.js';
export { ClaudeClassifier, DEFAULT_CLAUDE_MODEL } from './claudeClassifier.js';
export type { ClaudeOptions } from './claudeClassifier.js';
export { HybridClassifier } from './hybridClassifier.js';
export { shouldEscalate } from './preFilter.js';
export { RULES, HOST_CATEGORIES } from './rules.js';

import { RuleBasedClassifier, type RuleBasedOptions } from './ruleBasedClassifier.js';
import { ClaudeClassifier, DEFAULT_CLAUDE_MODEL } from './claudeClassifier.js';
import { HybridClassifier } from './hybridClassifier.js';
import type { RiskClassifier } from './types.js';

/** Sensitivity presets exposed in the dashboard's Settings screen. */
export const SENSITIVITY_THRESHOLDS = {
  cautious: 0.6,
  balanced: 0.45,
  strict: 0.3,
} as const;

export type Sensitivity = keyof typeof SENSITIVITY_THRESHOLDS;

export type ClassifierMode = 'hybrid' | 'claude' | 'rules';

function hasCredentials(): boolean {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export interface ClassifierStatus {
  /** The mode that will actually run (falls back to 'rules' without a key). */
  mode: ClassifierMode;
  /** Whether the Claude model is actually engaged. */
  usingModel: boolean;
  /** The model that would be called (only meaningful when usingModel). */
  model: string;
}

/**
 * Resolve the effective classifier configuration from the environment, without
 * constructing anything. Used for startup logging.
 *
 *   WARDLINE_CLASSIFIER=rules   → rule engine only (offline, deterministic)
 *   WARDLINE_CLASSIFIER=claude  → every escalated event straight to the model
 *   WARDLINE_CLASSIFIER=hybrid  → pre-filter → Claude → rules fallback (default)
 *
 * With no mode set, hybrid runs when credentials are present, otherwise rules.
 */
export function resolveClassifierMode(): ClassifierStatus {
  const requested = (process.env.WARDLINE_CLASSIFIER as ClassifierMode | undefined) ?? (hasCredentials() ? 'hybrid' : 'rules');
  const model = process.env.WARDLINE_CLAUDE_MODEL ?? DEFAULT_CLAUDE_MODEL;
  const wantsModel = requested === 'hybrid' || requested === 'claude';
  const usingModel = wantsModel && hasCredentials();
  return { mode: usingModel ? requested : 'rules', usingModel, model };
}

/**
 * Factory the server uses. Builds the backing implementation the resolved mode
 * calls for, lighting up the model the moment ANTHROPIC_API_KEY is configured.
 */
export function createClassifier(opts?: RuleBasedOptions): RiskClassifier {
  const threshold = opts?.threshold ?? SENSITIVITY_THRESHOLDS.balanced;
  const rules = new RuleBasedClassifier(opts);

  const requested = (process.env.WARDLINE_CLASSIFIER as ClassifierMode | undefined) ?? (hasCredentials() ? 'hybrid' : 'rules');
  if (requested === 'rules') return rules;

  if (!hasCredentials()) {
    // eslint-disable-next-line no-console
    console.warn(`[classifier] WARDLINE_CLASSIFIER=${requested} but no ANTHROPIC_API_KEY set — using rule engine.`);
    return rules;
  }

  const claude = new ClaudeClassifier({ threshold });
  return requested === 'claude' ? claude : new HybridClassifier(rules, claude);
}
