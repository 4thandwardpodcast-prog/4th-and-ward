// Pairing logic for Drip or Drown Free-Play. Pure, so scripts/test-drip-pairing.mjs can run it.

export const MIN_VOTES = 20;
const SCORE_BANDS = [0.05, 0.1, 0.2, 1]; // widen until a pair is found

const votes = s => (s.dripVotes || 0) + (s.drownVotes || 0);
const score = s => (s.dripVotes || 0) / votes(s);

// Same id for a pair in either order, so a visitor sees each matchup once.
export const pairKey = (a, b) => (a < b ? `${a}__${b}` : `${b}__${a}`);

function shuffled(list, random) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ponytail: O(n²) only when nearly every pair is played; fine at a few thousand uniforms.
export function pickPair(subs, { played = new Set(), excludeSchools = new Set(), avoidIds = new Set(), random = Math.random } = {}) {
  const pool = shuffled(
    subs.filter(s => votes(s) >= MIN_VOTES && !excludeSchools.has(s.schoolKey)),
    random
  );
  // First try for two uniforms the player didn't just see, then allow repeats.
  for (const fresh of [pool.filter(s => !avoidIds.has(s.id)), pool]) {
    for (const band of SCORE_BANDS) {
      for (const a of fresh) {
        const b = fresh.find(o =>
          o.id !== a.id &&
          o.schoolKey !== a.schoolKey &&
          Math.abs(score(o) - score(a)) <= band &&
          !played.has(pairKey(a.id, o.id))
        );
        if (b) return [a, b];
      }
    }
  }
  return null;
}
