import type { MonitoredEvent } from './types.js';

/**
 * On-device pre-filter — the cheap first stage of the hybrid pipeline.
 *
 * Its job is VOLUME REDUCTION, not risk scoring: drop the ~95% of benign,
 * high-volume page views before anything is sent to the (paid, slower) model,
 * while keeping recall high on the channels where risk actually lives.
 *
 * Design choice, stated plainly: conversational channels — messages and
 * searches — are ALWAYS escalated once they carry real text, because that's
 * where grooming, self-harm, and bullying show up and where novel phrasing
 * would slip past a keyword list. Page views are escalated only when they trip
 * a broad concern lexicon, since escalating every page a child loads would be
 * expensive and mostly noise. A risky page with no lexical signal is the known
 * gap of this tradeoff.
 */

/** Minimum characters before a message/search is worth a model call. */
const MIN_CONVERSATIONAL_LEN = 12;

/** Channels where risk concentrates — always escalated when they carry text. */
const CONVERSATIONAL_KINDS = new Set(['message', 'search']);

/**
 * Broad, single-token concern lexicon. Deliberately wider (and noisier) than
 * the rule engine's precise patterns — it only decides *whether to ask the
 * model*, not the verdict. Matching here never itself raises an alert.
 */
const CONCERN_LEXICON =
  /\b(kill|die|death|suicide|suicidal|self[-\s]?harm|hurt|cut(ting)?|depress\w*|worthless|hopeless|alone|hate|nude|nudes|naked|sex\w*|porn|hookup|secret|meet\s?up|runaway|weed|vape|molly|xan\w*|coke|pills|drunk|gun|knife|weapon|threat\w*|kys|loser)\b/i;

export interface PreFilterResult {
  escalate: boolean;
  reason: string;
}

/** Decide whether an event should be sent to the model. */
export function shouldEscalate(event: MonitoredEvent): PreFilterResult {
  const text = (event.text ?? '').trim();

  if (CONVERSATIONAL_KINDS.has(event.kind)) {
    if (text.length >= MIN_CONVERSATIONAL_LEN) {
      return { escalate: true, reason: `conversational (${event.kind})` };
    }
    return { escalate: false, reason: 'conversational but too short' };
  }

  // Non-conversational (page views, etc.): only ask the model when a broad
  // concern token appears.
  if (CONCERN_LEXICON.test(text)) {
    return { escalate: true, reason: 'concern lexicon hit' };
  }
  return { escalate: false, reason: 'benign page — dropped on device' };
}
