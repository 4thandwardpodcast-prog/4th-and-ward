// Jimmys & Joes — central config for positions, traits, accolades, scoring.
// Edit this single file to add/rename positions, traits, or accolade types.

// ── POSITIONS ────────────────────────────────────────────────────────
// `code` is stored in Firestore. `label` is what users see in dropdowns.
export const POSITIONS = [
  { code: 'QB',  label: 'Quarterback' },
  { code: 'RB',  label: 'Running Back' },
  { code: 'WR',  label: 'Wide Receiver' },
  { code: 'TE',  label: 'Tight End' },
  { code: 'OL',  label: 'Offensive Line' },
  { code: 'DL',  label: 'Defensive Line' },
  { code: 'EDGE',label: 'Edge / DE' },
  { code: 'LB',  label: 'Linebacker' },
  { code: 'CB',  label: 'Cornerback' },
  { code: 'S',   label: 'Safety' },
  { code: 'ATH', label: 'Athlete' },
  { code: 'K',   label: 'Kicker' },
  { code: 'P',   label: 'Punter' },
  { code: 'LS',  label: 'Long Snapper' },
];

export const POSITION_LABEL = Object.fromEntries(POSITIONS.map(p => [p.code, p.label]));

// ── TRAITS PER POSITION ──────────────────────────────────────────────
// 4–6 traits per position. Each trait is rated 1–5 in the rating modal.
// Edit freely; raters' submitted traits will be matched to whatever's here
// at the time of submission, so older ratings with stale trait keys still
// average correctly within the keys present.
export const TRAITS_BY_POSITION = {
  QB:   ['Arm Strength', 'Accuracy', 'Decision Making', 'Mobility', 'Pocket Presence', 'Leadership'],
  RB:   ['Vision', 'Burst', 'Contact Balance', 'Speed', 'Hands', 'Pass Pro'],
  WR:   ['Route Running', 'Hands', 'Speed / Separation', 'YAC', 'Ball Tracking', 'Blocking'],
  TE:   ['Hands', 'Route Running', 'Inline Blocking', 'YAC', 'Mismatch / Size'],
  OL:   ['Power at POA', 'Leverage', 'Hand Usage', 'Pass Pro', 'Motor', 'Pulling / Mobility'],
  DL:   ['Power', 'Hand Usage', 'First Step', 'Run Defense', 'Motor', 'Pass Rush'],
  EDGE: ['First Step', 'Bend', 'Hand Usage', 'Run Defense', 'Pass Rush Plan', 'Motor'],
  LB:   ['Instincts', 'Tackling', 'Range', 'Coverage', 'Block Shedding', 'Motor'],
  CB:   ['Hips / Fluidity', 'Recovery Speed', 'Press / Physicality', 'Ball Skills', 'Tackling'],
  S:    ['Range', 'Tackling', 'Ball Skills', 'Coverage', 'Run Support', 'Communication'],
  ATH:  ['Athleticism', 'Speed', 'Versatility', 'Football IQ', 'Playmaking'],
  K:    ['Leg Strength', 'Accuracy', 'Consistency', 'Kickoffs'],
  P:    ['Leg Strength', 'Hang Time', 'Directional', 'Consistency'],
  LS:   ['Snap Speed', 'Snap Accuracy', 'Athleticism'],
};

export function traitsFor(positionCode) {
  return TRAITS_BY_POSITION[positionCode] || TRAITS_BY_POSITION.ATH;
}

// ── CLASS YEARS ──────────────────────────────────────────────────────
// Rolling window: current class year through 3 years ahead, plus JUCO / Transfer.
export function classYearOptions(now = new Date()) {
  const y = now.getFullYear();
  // If we're past July, advance baseline (recruiting class flips mid-year).
  const baseline = (now.getMonth() >= 6) ? y + 1 : y;
  return [
    String(baseline),
    String(baseline + 1),
    String(baseline + 2),
    String(baseline + 3),
    'JUCO',
    'Transfer',
  ];
}

// ── ACCOLADES ────────────────────────────────────────────────────────
// `points` feed the 10% Accolades Score. Edit weights freely.
export const ACCOLADES = [
  { id: 'aa-1st',         label: 'All-American (1st Team)',           points: 30 },
  { id: 'aa-2nd',         label: 'All-American (2nd Team)',           points: 22 },
  { id: 'as-1st',         label: 'All-State (1st Team)',              points: 18 },
  { id: 'as-2nd',         label: 'All-State (2nd Team)',              points: 14 },
  { id: 'as-hm',          label: 'All-State (Honorable Mention)',     points: 8  },
  { id: 'state-mvp',      label: 'State MVP',                         points: 25 },
  { id: 'state-poy',      label: 'State Player of the Year',          points: 25 },
  { id: 'state-opoy',     label: 'State Offensive Player of the Year',points: 22 },
  { id: 'state-dpoy',     label: 'State Defensive Player of the Year',points: 22 },
  { id: 'region-mvp',     label: 'Region/Area MVP',                   points: 15 },
  { id: 'region-opoy',    label: 'Region/Area OPOY',                  points: 12 },
  { id: 'region-dpoy',    label: 'Region/Area DPOY',                  points: 12 },
  { id: 'dist-mvp',       label: 'District MVP',                      points: 12 },
  { id: 'dist-opoy',      label: 'District OPOY',                     points: 10 },
  { id: 'dist-dpoy',      label: 'District DPOY',                     points: 10 },
  { id: 'dist-nfp',       label: 'District Newcomer of the Year',     points: 6  },
  { id: 'all-dist-1st',   label: 'All-District (1st Team)',           points: 8  },
  { id: 'all-dist-2nd',   label: 'All-District (2nd Team)',           points: 5  },
  { id: 'team-capt',      label: 'Team Captain',                      points: 4  },
  { id: 'state-champ',    label: 'State Championship',                points: 12 },
  { id: 'state-runner',   label: 'State Runner-Up',                   points: 7  },
  { id: 'combine-elite',  label: 'Elite Combine Invite (Rivals/Nike/UA)', points: 10 },
  { id: 'camp-mvp',       label: 'Camp / 7v7 MVP',                    points: 6  },
];

export const ACCOLADE_BY_ID = Object.fromEntries(ACCOLADES.map(a => [a.id, a]));

// ── SCORING WEIGHTS ──────────────────────────────────────────────────
// Sum to 1.0. The final J&J rating is a weighted combination of these four
// component scores (each normalized to 0–5). Editable but verify they sum to 1.
export const SCORE_WEIGHTS = {
  film:         0.70,
  production:   0.15,
  accolades:    0.10,
  measurables:  0.05,
};

// Minimum ratings before stars are displayed (per plan: 15–20).
export const MIN_RATINGS_FOR_STARS = 15;

// Below this, show "0 stars — needs more film" instead of fractional stars.
export const MIN_FINAL_FOR_STARS = 1.0;

// Star bucketing for histogram (1–5 stars, integer overall rating buckets).
export const HISTOGRAM_BUCKETS = [1, 2, 3, 4, 5];

// ── ACCOLADE → 0–5 NORMALIZATION ─────────────────────────────────────
// We sum the points of the player's accolades and map onto 0–5 using a
// soft cap so a handful of mid-tier accolades + one big one feels right.
export function normalizeAccoladesScore(totalPoints) {
  // 60+ points = 5.0 stars contribution (e.g. State MVP + All-State 1st).
  // Below that, scales sub-linearly so volume alone can't max it out.
  if (!totalPoints || totalPoints <= 0) return 0;
  const score = 5 * Math.tanh(totalPoints / 35);
  return Math.round(score * 100) / 100;
}

// ── MEASURABLES → 0–5 NORMALIZATION ──────────────────────────────────
// Lightweight first pass — uses 40 time and height/weight when present.
// Tuned for HS football benchmarks; refine later when more data is in.
export function normalizeMeasurablesScore({ fortySec, heightInches, weightLbs }) {
  let pieces = [];
  if (typeof fortySec === 'number' && fortySec > 0) {
    // 4.40 = 5.0, 5.20 = 1.0, linear between
    const s = 5 - ((fortySec - 4.4) / 0.80) * 4;
    pieces.push(Math.max(1, Math.min(5, s)));
  }
  if (typeof heightInches === 'number' && typeof weightLbs === 'number') {
    // Crude "size index" — 0 to ~70 lb-in surplus over 5'10" / 170 lbs.
    const surplus = Math.max(0, (heightInches - 70)) + Math.max(0, (weightLbs - 170) / 10);
    const s = Math.min(5, 1 + surplus / 8);
    pieces.push(s);
  }
  if (!pieces.length) return 0;
  const avg = pieces.reduce((a, b) => a + b, 0) / pieces.length;
  return Math.round(avg * 100) / 100;
}

// ── PRODUCTION STATS PER POSITION ────────────────────────────────────
// `bench` = the stat value worth 5.0 stars (top-tier high-school season).
// `inverse: true` means lower is better (e.g. sacks allowed); `hardCap` is
// the value at which the score floors to 0. Editable; tune with field data.
export const STATS_BY_POSITION = {
  QB: [
    { key: 'passYards',     label: 'Passing Yards',     bench: 3000 },
    { key: 'passTDs',       label: 'Passing TDs',       bench: 35   },
    { key: 'completionPct', label: 'Completion %',      bench: 65,  suffix: '%' },
    { key: 'rushYards',     label: 'Rushing Yards',     bench: 800  },
  ],
  RB: [
    { key: 'rushYards',     label: 'Rushing Yards',     bench: 1800 },
    { key: 'rushTDs',       label: 'Rushing TDs',       bench: 25   },
    { key: 'yardsPerCarry', label: 'Yards / Carry',     bench: 8    },
    { key: 'recYards',      label: 'Receiving Yards',   bench: 500  },
  ],
  WR: [
    { key: 'receptions',    label: 'Receptions',        bench: 70   },
    { key: 'recYards',      label: 'Receiving Yards',   bench: 1200 },
    { key: 'recTDs',        label: 'Receiving TDs',     bench: 15   },
    { key: 'yardsPerRec',   label: 'Yards / Reception', bench: 18   },
  ],
  TE: [
    { key: 'receptions',    label: 'Receptions',        bench: 50   },
    { key: 'recYards',      label: 'Receiving Yards',   bench: 700  },
    { key: 'recTDs',        label: 'Receiving TDs',     bench: 10   },
  ],
  OL: [
    { key: 'pancakes',      label: 'Pancakes',          bench: 60   },
    { key: 'gamesStarted',  label: 'Games Started',     bench: 14   },
    { key: 'sacksAllowed',  label: 'Sacks Allowed',     bench: 0, inverse: true, hardCap: 8 },
  ],
  DL: [
    { key: 'tackles',       label: 'Tackles',           bench: 70   },
    { key: 'tfl',           label: 'TFL',               bench: 20   },
    { key: 'sacks',         label: 'Sacks',             bench: 12   },
  ],
  EDGE: [
    { key: 'tackles',       label: 'Tackles',           bench: 60   },
    { key: 'tfl',           label: 'TFL',               bench: 22   },
    { key: 'sacks',         label: 'Sacks',             bench: 15   },
    { key: 'forcedFumbles', label: 'Forced Fumbles',    bench: 5    },
  ],
  LB: [
    { key: 'tackles',       label: 'Tackles',           bench: 120  },
    { key: 'tfl',           label: 'TFL',               bench: 18   },
    { key: 'sacks',         label: 'Sacks',             bench: 8    },
    { key: 'interceptions', label: 'INTs',              bench: 3    },
  ],
  CB: [
    { key: 'interceptions', label: 'INTs',              bench: 5    },
    { key: 'passBreakups',  label: 'Pass Breakups',     bench: 12   },
    { key: 'tackles',       label: 'Tackles',           bench: 50   },
  ],
  S: [
    { key: 'tackles',       label: 'Tackles',           bench: 80   },
    { key: 'interceptions', label: 'INTs',              bench: 5    },
    { key: 'passBreakups',  label: 'Pass Breakups',     bench: 10   },
    { key: 'forcedFumbles', label: 'Forced Fumbles',    bench: 3    },
  ],
  // ATH/K/P/LS: production score is intentionally skipped — film + measurables carry.
  ATH: [], K: [], P: [], LS: [],
};

export function statsFor(positionCode) {
  return STATS_BY_POSITION[positionCode] || [];
}

// Normalize season-stat totals into a 0–5 production score for a given position.
// Each defined stat scales linearly toward its `bench` (= 5.0). Missing stats are
// skipped (don't drag the average). Inverse fields (e.g. sacks-allowed) flip the
// scale so lower values score higher.
export function normalizeProductionScore(stats, positionCode) {
  if (!stats || !positionCode) return 0;
  const schema = STATS_BY_POSITION[positionCode] || [];
  if (!schema.length) return 0;
  let sum = 0, count = 0;
  for (const f of schema) {
    const v = Number(stats[f.key]);
    if (!Number.isFinite(v) || v < 0) continue;
    let s;
    if (f.inverse) {
      const cap = f.hardCap || 10;
      s = Math.max(0, 5 - (v / cap) * 5);
    } else {
      s = Math.min(5, 5 * (v / (f.bench || 1)));
    }
    sum += s;
    count++;
  }
  if (count === 0) return 0;
  return Math.round((sum / count) * 100) / 100;
}

// ── BADGES (gamification) ────────────────────────────────────────────
// `condition` is evaluated in the Cloud Function against the user's mirror
// stats. Mirror those checks in functions/index.js (keep in sync).
// `tier` orders badges from highest-to-lowest priority; the top badge in
// a user's collection is what shows next to their name in comments.
export const BADGES = [
  // Rating volume
  { id: 'first-rating', label: 'First Rating',    icon: '🎯', desc: 'Submitted your first rating',  tier: 1 },
  { id: 'rater-10',     label: 'Active Rater',    icon: '⭐',  desc: '10 ratings',                  tier: 2 },
  { id: 'rater-50',     label: 'Veteran Rater',   icon: '🌟', desc: '50 ratings',                  tier: 3 },
  { id: 'rater-100',    label: 'Power Rater',     icon: '💯', desc: '100 ratings',                 tier: 4 },
  { id: 'rater-500',    label: 'Hall of Scouts',  icon: '🏆', desc: '500 ratings',                 tier: 6 },
  // Streaks
  { id: 'streak-3',     label: 'On a Roll',       icon: '🔥', desc: '3-day rating streak',         tier: 2 },
  { id: 'streak-7',     label: 'Week Warrior',    icon: '🔥', desc: '7-day rating streak',         tier: 3 },
  { id: 'streak-30',    label: 'Month Marathon',  icon: '⚡', desc: '30-day rating streak',        tier: 5 },
  // Helpful votes received
  { id: 'helpful-5',    label: 'Trusted Eye',     icon: '👁️', desc: '5 helpful votes on comments', tier: 2 },
  { id: 'helpful-25',   label: 'Crowd Favorite',  icon: '🎖️', desc: '25 helpful votes',            tier: 4 },
  { id: 'helpful-100',  label: 'Authority',       icon: '📜', desc: '100 helpful votes',           tier: 6 },
];

export const BADGE_BY_ID = Object.fromEntries(BADGES.map(b => [b.id, b]));

export const POINTS = {
  ratingBase:        1,
  ratingDetailBonus: 2,    // when the rater attaches a comment + adjusts traits
  ratingRandomBonus: 1,    // when the rater landed via "Rate a Random Jimmy"
  commentUpvote:     1,
};

// "Detailed rating" definition (mirrored in functions/index.js):
// — comment ≥ 20 chars, or at least one trait moved from the default 3.0.
export function isDetailedRating(rating) {
  if (!rating) return false;
  const text = (rating.comment || '').trim();
  if (text.length >= 20) return true;
  const traits = rating.traits || {};
  return Object.values(traits).some(v => typeof v === 'number' && Math.abs(v - 3) > 0.01);
}
