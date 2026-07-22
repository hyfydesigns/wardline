import type { RiskCategory } from './types.js';

/**
 * A weighted signal. `weight` contributes to the category's confidence when
 * the pattern matches. Patterns are intentionally conservative — this is a
 * transparent, auditable stand-in for a trained model, not a real one.
 */
export interface Rule {
  category: RiskCategory;
  pattern: RegExp;
  weight: number;
  /** Short description of what this signal represents (for auditing). */
  note: string;
}

/**
 * Rule set. Deliberately small and readable. Real deployments would replace
 * this with fine-tuned classifiers; the weights here are illustrative.
 *
 * NOTE: patterns are matched case-insensitively against an on-device-reduced
 * text window, never the full page. This file contains no explicit content —
 * only the linguistic *markers* used to detect risk.
 */
export const RULES: Rule[] = [
  // --- Grooming (critical) ---------------------------------------------------
  { category: 'grooming', weight: 0.55, note: 'secrecy pressure', pattern: /\b(don'?t|do not) tell (your )?(mom|dad|mum|parents|anyone)\b/i },
  { category: 'grooming', weight: 0.45, note: 'secret framing', pattern: /\b(our|keep this a?) secret\b/i },
  { category: 'grooming', weight: 0.4, note: 'move to private channel', pattern: /\b(let'?s )?(move|talk|chat) (this )?(to|on) (snap|kik|whatsapp|telegram|dms?|private)\b/i },
  { category: 'grooming', weight: 0.4, note: 'age probing', pattern: /\bhow old are you\b|\bwhat'?s your age\b/i },
  { category: 'grooming', weight: 0.35, note: 'meeting request', pattern: /\b(meet|see) (up|you) (in person|irl|alone)\b/i },
  { category: 'grooming', weight: 0.3, note: 'isolation flattery', pattern: /\byou'?re so mature for your age\b/i },

  // --- Self-harm / mental health (critical) ---------------------------------
  { category: 'self_harm', weight: 0.6, note: 'suicidal ideation', pattern: /\b(want to|wanna|going to) (die|kill myself|end it)\b/i },
  { category: 'self_harm', weight: 0.55, note: 'method seeking', pattern: /\bhow (to|do i) (kill myself|end my life|hurt myself)\b/i },
  { category: 'self_harm', weight: 0.45, note: 'hopelessness', pattern: /\b(no reason to|can'?t) (live|go on)\b|\bnobody would miss me\b/i },
  { category: 'self_harm', weight: 0.4, note: 'self-injury reference', pattern: /\b(cutting|self[-\s]?harm|hurt myself)\b/i },

  // --- Cyberbullying (concerning) -------------------------------------------
  { category: 'cyberbullying', weight: 0.4, note: 'targeted insult', pattern: /\b(you'?re|ur) (a )?(loser|worthless|pathetic|ugly|stupid|freak)\b/i },
  { category: 'cyberbullying', weight: 0.45, note: 'exclusion / hostility', pattern: /\b(nobody likes you|kill yourself|kys|go away and die)\b/i },
  { category: 'cyberbullying', weight: 0.35, note: 'threat to spread', pattern: /\b(i'?ll|going to) (tell everyone|expose you|screenshot this)\b/i },

  // --- Explicit content (concerning) ----------------------------------------
  { category: 'explicit', weight: 0.5, note: 'adult site host', pattern: /\b(porn|xxx|nsfw|onlyfans)\b/i },
  { category: 'explicit', weight: 0.4, note: 'solicitation', pattern: /\bsend (me )?(nudes|pics|a pic)\b/i },

  // --- Drugs / alcohol (concerning) -----------------------------------------
  { category: 'drugs', weight: 0.4, note: 'sourcing', pattern: /\b(where (can|to) (buy|get)|hook me up with) (weed|coke|molly|xanax|vape|pills)\b/i },
  { category: 'drugs', weight: 0.3, note: 'substance reference', pattern: /\b(getting high|drunk tonight|score some (weed|pills))\b/i },

  // --- Violence / threats (concerning) --------------------------------------
  { category: 'violence', weight: 0.5, note: 'threat of harm', pattern: /\b(i'?ll|going to|gonna) (beat|hurt|kill) (you|him|her|them)\b/i },
  { category: 'violence', weight: 0.4, note: 'weapon reference', pattern: /\bbring (a|my) (knife|gun) to school\b/i },
];

/** Host-based category matches (policy/informational, not linguistic risk). */
export const HOST_CATEGORIES: { pattern: RegExp; category: RiskCategory; note: string }[] = [
  { pattern: /(^|\.)(pornhub|xvideos|xnxx|onlyfans)\.(com|net)/i, category: 'explicit', note: 'known adult host' },
];
