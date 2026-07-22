/**
 * Synthetic browsing/usage events that stand in for what the real Windows
 * agent + browser extensions would capture. The mix is mostly benign, with a
 * few events that trip the risk classifier so the live alert loop is visible.
 */
export interface SimEvent {
  source: string;
  kind: string; // 'search' | 'message' | 'page' | 'usage'
  text?: string;
  url?: string;
  category?: string; // for kind='usage'
  minutes?: number; // for kind='usage'
}

/** Benign, high-frequency traffic — the ~95% the on-device pre-filter drops. */
export const BENIGN: SimEvent[] = [
  { source: 'chrome', kind: 'page', url: 'https://en.wikipedia.org/wiki/Photosynthesis', text: 'Photosynthesis is the process used by plants to convert light energy into chemical energy.' },
  { source: 'chrome', kind: 'search', url: 'https://www.google.com/search?q=quadratic+formula', text: 'quadratic formula worked examples' },
  { source: 'edge', kind: 'page', url: 'https://www.khanacademy.org/math/algebra', text: 'Algebra basics: solving linear equations and inequalities.' },
  { source: 'chrome', kind: 'message', text: 'hey are you coming to practice after school today?' },
  { source: 'chrome', kind: 'page', url: 'https://www.youtube.com/watch?v=minecraft-build', text: 'How to build a redstone elevator in survival mode' },
  { source: 'chrome', kind: 'search', url: 'https://www.google.com/search?q=how+long+to+boil+an+egg', text: 'how long to boil an egg soft vs hard' },
  { source: 'edge', kind: 'message', text: 'gg that match was so close, rematch tomorrow?' },
];

/**
 * Categories simulated foreground activity falls into. Minutes are NOT baked
 * in here — the simulator derives them from real elapsed time so today's
 * screen-time total can never exceed the wall clock.
 */
export const USAGE_CATEGORIES = ['Social', 'Gaming', 'Streaming', 'Homework'];

/**
 * Risk events. Each trips a classifier category. These fire occasionally so a
 * fresh alert lands on the dashboard while you watch. Marker language only —
 * no explicit content.
 */
export const RISKY: SimEvent[] = [
  { source: 'Discord (web)', kind: 'message', text: "hey, you seem really cool. how old are you? don't tell your mom we talked ok, this can be our secret" },
  { source: 'Google Search', kind: 'search', url: 'https://www.google.com/search', text: 'i feel like nobody would miss me and i want to end it' },
  { source: 'Group chat', kind: 'message', text: "you're such a loser, nobody likes you, just go away" },
  { source: 'chrome', kind: 'message', text: 'do you know where to buy weed near school' },
  { source: 'Snapchat (web)', kind: 'message', text: "you're so mature for your age, let's move this to snap" },
];
