import { createHash } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import {
  CATEGORY_LABELS,
  CATEGORY_SEVERITY,
  type MonitoredEvent,
  type RiskCategory,
  type RiskClassifier,
  type RiskVerdict,
  type Severity,
} from './types.js';
import { truncate } from './snippet.js';

const CATEGORIES: RiskCategory[] = ['grooming', 'self_harm', 'cyberbullying', 'explicit', 'drugs', 'violence'];

/** Fast, low-cost default model for high-volume classification. */
export const DEFAULT_CLAUDE_MODEL = 'claude-haiku-4-5';

const SYSTEM_PROMPT = `You are a child-safety content classifier for a parental-monitoring tool. You receive a short, already-minimised snippet of a child's browsing text (a message, search, or page) and decide whether it shows a genuine risk a parent should be alerted to.

Risk categories:
- grooming: predatory/grooming language from another party (secrecy pressure, age probing, moving to private channels, isolation, meeting requests)
- self_harm: suicidal ideation, self-injury, or acute mental-health crisis in the child's own words
- cyberbullying: the child being targeted with sustained insults, threats, or humiliation
- explicit: sexual/explicit content or solicitation of images
- drugs: sourcing or intent around drugs, alcohol, or other harmful substances
- violence: credible threats of violence to self or others

Be precise. Everyday teenage venting, dark humor, fiction, homework, song lyrics, and news reading are NOT risks — do not flag them. Only flag content where a reasonable parent would want to know. When unsure, do not flag. Output confidence in [0,1] reflecting how sure you are the risk is real.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    flagged: { type: 'boolean' },
    category: { type: 'string', enum: [...CATEGORIES, 'none'] },
    severity: { type: 'string', enum: ['critical', 'concerning', 'informational', 'none'] },
    confidence: { type: 'number' },
    reason: { type: 'string' },
  },
  required: ['flagged', 'category', 'severity', 'confidence', 'reason'],
} as const;

interface ClaudeResult {
  flagged: boolean;
  category: string;
  severity: string;
  confidence: number;
  reason: string;
}

export interface ClaudeOptions {
  /** Model id. Defaults to claude-haiku-4-5 (fast, low-cost for high-volume classification). */
  model?: string;
  /** Minimum confidence to raise an alert (maps to detection sensitivity). */
  threshold?: number;
  snippetLength?: number;
}

/**
 * ML-backed classifier: sends the snippet to the Anthropic API and maps the
 * structured response to a RiskVerdict. Verdicts are cached by text hash so
 * repeated identical content costs one call. `classify` throws on API/auth
 * failure — the hybrid wrapper catches and falls back to rules.
 */
export class ClaudeClassifier implements RiskClassifier {
  readonly name: string;
  private model: string;
  private threshold: number;
  private snippetLength: number;
  private client: Anthropic | null = null;
  private cache = new Map<string, RiskVerdict>();

  constructor(opts: ClaudeOptions = {}) {
    this.model = opts.model ?? process.env.WARDLINE_CLAUDE_MODEL ?? DEFAULT_CLAUDE_MODEL;
    this.threshold = opts.threshold ?? 0.45;
    this.snippetLength = opts.snippetLength ?? 120;
    this.name = `claude:${this.model}`;
  }

  private getClient(): Anthropic {
    // Lazy: constructing reads ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN from env.
    if (!this.client) this.client = new Anthropic();
    return this.client;
  }

  async classify(event: MonitoredEvent): Promise<RiskVerdict> {
    const text = (event.text ?? '').trim();
    if (!text) return { flagged: false };

    const key = createHash('sha1').update(`${event.kind}:${text}`).digest('hex');
    const cached = this.cache.get(key);
    if (cached) return cached;

    const verdict = await this.callModel(event, text);
    this.cache.set(key, verdict);
    return verdict;
  }

  private async callModel(event: MonitoredEvent, text: string): Promise<RiskVerdict> {
    const userContent = `Channel: ${event.kind}${event.source ? ` via ${event.source}` : ''}\nText: """${text}"""`;

    // `effort` is only accepted on Opus 4.6+, Sonnet 4.6/5, and Fable 5 — it
    // returns a 400 on Haiku 4.5 (the default). Include it only where supported.
    const outputConfig: Record<string, unknown> = {
      format: { type: 'json_schema', schema: SCHEMA },
    };
    if (/opus-4-(6|7|8)|sonnet-5|sonnet-4-6|fable-5/.test(this.model)) {
      outputConfig.effort = 'low';
    }

    // `any` params/response so this compiles across @anthropic-ai/sdk versions
    // regardless of whether output_config is in the installed type surface.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const params: any = {
      model: this.model,
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      output_config: outputConfig,
      messages: [{ role: 'user', content: userContent }],
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resp: any = await this.getClient().messages.create(params);
    const block = (resp.content ?? []).find((b: { type: string }) => b.type === 'text');
    if (!block?.text) return { flagged: false };

    let parsed: ClaudeResult;
    try {
      parsed = JSON.parse(block.text) as ClaudeResult;
    } catch {
      return { flagged: false };
    }

    if (!parsed.flagged || parsed.category === 'none' || !CATEGORIES.includes(parsed.category as RiskCategory)) {
      return { flagged: false };
    }
    const category = parsed.category as RiskCategory;
    const confidence = Math.max(0, Math.min(0.99, Number(parsed.confidence) || 0));
    if (confidence < this.threshold) return { flagged: false };

    const severity: Severity =
      parsed.severity === 'critical' || parsed.severity === 'concerning' || parsed.severity === 'informational'
        ? parsed.severity
        : CATEGORY_SEVERITY[category];

    return {
      flagged: true,
      category,
      severity,
      confidence: Number(confidence.toFixed(2)),
      label: CATEGORY_LABELS[category],
      snippet: truncate(text, this.snippetLength),
    };
  }
}
