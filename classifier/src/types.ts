/**
 * Shared risk-classification types.
 *
 * These are the contract between the ingest pipeline and any classifier
 * implementation. The rule-based classifier in this package is the MVP
 * default; a real NLP/ML model can implement the same `RiskClassifier`
 * interface and be swapped in without touching the server.
 */

/** Risk categories Wardline screens for. Keep in sync with the dashboard. */
export type RiskCategory =
  | 'grooming'
  | 'self_harm'
  | 'cyberbullying'
  | 'explicit'
  | 'drugs'
  | 'violence';

/** Severity buckets the dashboard groups alerts by. */
export type Severity = 'critical' | 'concerning' | 'informational';

/** A single browsing/system event captured on the child's device. */
export interface MonitoredEvent {
  /** Stable id generated on-device so re-syncs are idempotent. */
  eventId: string;
  deviceId: string;
  /** ISO timestamp of when the event occurred on-device. */
  occurredAt: string;
  /** e.g. "chrome", "edge", "firefox". */
  source: string;
  /** Full URL or host the event relates to. */
  url?: string;
  /** Page/search/message text already reduced on-device to a short window. */
  text: string;
  /** "search" | "message" | "page" | "download" | "system". */
  kind: string;
}

/** A classifier's verdict on a single event. */
export interface RiskVerdict {
  /** True if the event should generate an alert. */
  flagged: boolean;
  category?: RiskCategory;
  severity?: Severity;
  /** 0..1 confidence. Absent for pure category/policy matches. */
  confidence?: number;
  /**
   * Short, parent-facing context snippet — NOT the full text. Data
   * minimisation is enforced here: the pipeline stores this, not `event.text`.
   */
  snippet?: string;
  /** Human-readable category label for the UI. */
  label?: string;
}

/**
 * The pluggable contract. Swap `RuleBasedClassifier` for an ML-backed
 * implementation (local or remote) that satisfies this interface.
 */
export interface RiskClassifier {
  readonly name: string;
  /**
   * Async so an implementation can call out to an ML service. Synchronous
   * implementations (like the rule engine) just return a resolved promise.
   */
  classify(event: MonitoredEvent): Promise<RiskVerdict>;
}

export const CATEGORY_LABELS: Record<RiskCategory, string> = {
  grooming: 'Predatory / grooming language',
  self_harm: 'Self-harm / mental health',
  cyberbullying: 'Cyberbullying',
  explicit: 'Sexual / explicit content',
  drugs: 'Drugs, alcohol & harmful substances',
  violence: 'Violence or threats',
};

export const CATEGORY_SEVERITY: Record<RiskCategory, Severity> = {
  grooming: 'critical',
  self_harm: 'critical',
  cyberbullying: 'concerning',
  explicit: 'concerning',
  drugs: 'concerning',
  violence: 'concerning',
};
