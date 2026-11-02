// Run: node scripts/test-drip-states.mjs
import assert from 'node:assert';
import { scoreStates, rankChanges, stateName } from '../js/drip-states.js';

const schools = (state, count, drip, drown) => Array.from({ length: count }, () => ({ state, drip, drown }));

// Vote-weighted: pools votes instead of averaging school percentages
const pooled = scoreStates([...schools('TX', 4, 10, 10), { state: 'tx', drip: 900, drown: 100 }]);
assert.strictEqual(pooled[0].state, 'TX');
assert.strictEqual(pooled[0].pct, Math.round(940 / 1080 * 100));

// Schools under the vote minimum don't count
const thin = scoreStates([...schools('OH', 5, 15, 4), { state: 'OH', drip: 60, drown: 40 }]);
assert.strictEqual(thin.length, 1);
assert.strictEqual(thin[0].schools, 1);
assert.strictEqual(thin[0].total, 100);

// A state needs 5 counting schools to rank, whatever its score
const mixed = scoreStates([...schools('NM', 3, 99, 1), ...schools('TX', 5, 60, 40), ...schools('KY', 5, 30, 70)]);
assert.deepStrictEqual(mixed.map(r => [r.state, r.rank]), [['TX', 1], ['KY', 2], ['NM', null]]);

// Confidence beats a thin lead: 61% on 5,000 votes outranks 65% on 100
const conf = scoreStates([...schools('AA', 5, 13, 7), ...schools('BB', 5, 610, 390)]);
assert.strictEqual(conf[0].state, 'BB');

// Blank states are ignored
assert.deepStrictEqual(scoreStates([{ state: ' ', drip: 50, drown: 50 }]), []);

// Movers: only ranked states present in both, biggest move first
const before = [{ state: 'TX', rank: 1 }, { state: 'OH', rank: 2 }, { state: 'KY', rank: 3 }, { state: 'NY', rank: null }];
const after = [{ state: 'KY', rank: 1 }, { state: 'TX', rank: 2 }, { state: 'OH', rank: 3 }, { state: 'FL', rank: 4 }];
assert.deepStrictEqual(rankChanges(after, before).map(c => [c.state, c.delta]), [['KY', 2], ['TX', -1], ['OH', -1]]);

// Names fall back to the code
assert.strictEqual(stateName('TX'), 'Texas');
assert.strictEqual(stateName('ON'), 'Ontario');
assert.strictEqual(stateName('ZZ'), 'ZZ');

console.log('drip states ok');
