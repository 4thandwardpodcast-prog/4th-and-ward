// Run: node scripts/test-drip-pairing.mjs
import assert from 'node:assert';
import { pickPair, pairKey } from '../js/drip-freeplay.js';

const sub = (id, schoolKey, dripVotes, drownVotes = 100 - dripVotes) => ({ id, schoolKey, dripVotes, drownVotes });

// Pairs similar scores when one is available
const subs = [sub('a', 'one', 90), sub('b', 'two', 88), sub('c', 'three', 20), sub('d', 'four', 22)];
for (let i = 0; i < 50; i++) {
  const [x, y] = pickPair(subs);
  assert.ok(Math.abs(x.dripVotes - y.dripVotes) <= 5, 'similar scores');
}

// Never pairs a school with itself
assert.strictEqual(pickPair([sub('a', 'one', 50), sub('b', 'one', 50)]), null);

// Skips uniforms under the vote minimum
assert.strictEqual(pickPair([sub('a', 'one', 5, 5), sub('b', 'two', 50)]), null);

// Leaves out Versus of the Week schools
const pair = pickPair(subs, { excludeSchools: new Set(['one', 'two']) });
assert.deepStrictEqual(pair.map(s => s.id).sort(), ['c', 'd']);

// Widens the score band before giving up
assert.ok(pickPair([sub('a', 'one', 95), sub('b', 'two', 5)]));

// Never replays a pair, and reports when none are left
const played = new Set();
const trio = [sub('a', 'one', 50), sub('b', 'two', 50), sub('c', 'three', 50)];
for (let i = 0; i < 3; i++) {
  const [x, y] = pickPair(trio, { played });
  assert.ok(!played.has(pairKey(x.id, y.id)), 'no replay');
  played.add(pairKey(x.id, y.id));
}
assert.strictEqual(pickPair(trio, { played }), null);

// Avoids the last pair's uniforms, unless that's all that's left
const next = pickPair(subs, { avoidIds: new Set(['a', 'b']) });
assert.deepStrictEqual(next.map(s => s.id).sort(), ['c', 'd']);
assert.ok(pickPair(subs.slice(0, 2), { avoidIds: new Set(['a', 'b']) }));

// Key is the same in either order
assert.strictEqual(pairKey('x', 'y'), pairKey('y', 'x'));

console.log('drip pairing ok');
