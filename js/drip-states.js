// State Drip Score logic. Pure, so scripts/test-drip-states.mjs can run it.

export const MIN_SCHOOL_VOTES = 20; // a school counts toward its state at this many votes
export const MIN_STATE_SCHOOLS = 5; // a state is ranked at this many counting schools

export const STATE_NAMES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
  CT: 'Connecticut', DE: 'Delaware', DC: 'Washington, D.C.', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii',
  ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi',
  MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma',
  OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  AB: 'Alberta', BC: 'British Columbia', MB: 'Manitoba', NB: 'New Brunswick', NL: 'Newfoundland and Labrador',
  NS: 'Nova Scotia', NT: 'Northwest Territories', NU: 'Nunavut', ON: 'Ontario', PE: 'Prince Edward Island',
  QC: 'Quebec', SK: 'Saskatchewan', YT: 'Yukon',
};

export const stateName = code => STATE_NAMES[code] || code;

// Wilson score interval (lower bound): rewards a strong percentage backed by many votes.
export function wilsonLowerBound(success, total) {
  if (!total || total <= 0) return 0;
  const z = 1.96; // 95% CI
  const p = (success || 0) / total;
  const z2 = z * z;
  const center = p + z2 / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total);
  return (center - margin) / (1 + z2 / total);
}

// schools: [{ state, drip, drown }]. Pooling votes makes this the vote-weighted average.
// Returns ranked states first (with rank), then unranked ones (rank: null).
export function scoreStates(schools) {
  const byState = new Map();
  for (const s of schools) {
    const state = String(s.state || '').trim().toUpperCase();
    const drip = s.drip || 0, total = drip + (s.drown || 0);
    if (!state || total < MIN_SCHOOL_VOTES) continue;
    const row = byState.get(state) || { state, drip: 0, total: 0, schools: 0 };
    row.drip += drip;
    row.total += total;
    row.schools += 1;
    byState.set(state, row);
  }
  const all = [...byState.values()].map(r => ({
    ...r,
    pct: Math.round(r.drip / r.total * 100),
    score: wilsonLowerBound(r.drip, r.total),
  }));
  const ranked = all.filter(r => r.schools >= MIN_STATE_SCHOOLS)
    .sort((a, b) => b.score - a.score)
    .map((r, i) => ({ ...r, rank: i + 1 }));
  const unranked = all.filter(r => r.schools < MIN_STATE_SCHOOLS)
    .sort((a, b) => b.schools - a.schools || b.total - a.total)
    .map(r => ({ ...r, rank: null }));
  return [...ranked, ...unranked];
}

// Ranked states whose rank moved since an earlier scoreStates() result, biggest moves first.
export function rankChanges(current, previous) {
  const before = new Map(previous.filter(r => r.rank).map(r => [r.state, r.rank]));
  return current
    .filter(r => r.rank && before.has(r.state) && before.get(r.state) !== r.rank)
    .map(r => ({ state: r.state, rank: r.rank, delta: before.get(r.state) - r.rank }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}
