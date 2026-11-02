/**
 * 4th & Ward — Firebase Cloud Functions
 * Simplified: logo and stadium image fetching removed.
 * Only generates and verifies 5 clues via Claude web search.
 */

const { onDocumentCreated, onDocumentWritten } = require('firebase-functions/v2/firestore');
const { initializeApp }     = require('firebase-admin/app');
const { getFirestore }      = require('firebase-admin/firestore');
const Anthropic             = require('@anthropic-ai/sdk');

initializeApp();
const db = getFirestore();

// ── CONFIG ────────────────────────────────────────────────────────────────────
const LAUNCH_DATE = '2026-03-14'; // Must match wardle.html
const MODEL       = 'claude-sonnet-4-5';

// ── HELPER: Get next unoccupied puzzle number ─────────────────────────────────
async function getNextPuzzleNumber() {
  const launch = new Date(LAUNCH_DATE + 'T00:00:00Z');
  const now    = new Date();
  now.setUTCHours(0, 0, 0, 0);
  const todayNum = Math.max(1, Math.floor((now - launch) / 86400000) + 1);

  const snap = await db.collection('puzzles').get();
  let maxNum = todayNum;
  snap.forEach(d => {
    const n = parseInt(d.id);
    if (!isNaN(n) && n > maxNum) maxNum = n;
  });
  return maxNum + 1;
}

// ── HELPER: Extract the final text block from a Claude response ───────────────
// Claude with web_search returns: [tool_use, tool_result, ..., text]
// We need the LAST text block.
function extractFinalText(contentBlocks) {
  const textBlocks = (contentBlocks || []).filter(b => b.type === 'text');
  return textBlocks[textBlocks.length - 1]?.text?.trim() || '';
}

// ── CORE: Generate puzzle via Claude with web search ─────────────────────────
async function generatePuzzle(teamName, city, state, mascot, apiKey) {
  const client = new Anthropic({ apiKey });

  const prompt = `You are generating a puzzle for "4th & Wardle", a daily guessing game about high school football programs (like Wordle). Players guess the school name from 5 clues revealed one at a time.

SCHOOL: ${teamName} in ${city}, ${state} — Mascot: ${mascot || 'unknown'}

STEP 1 — Research using web search. Search for:
- "${teamName} football ${state}"
- "${teamName} famous alumni NFL"
- "${teamName} football history championships"

STEP 2 — Generate exactly 5 clues using ONLY facts verified by your searches:
- Clue 1: Vague — one interesting fact, NO location/state/mascot/colors mentioned
- Clue 2: Still hard — another fact, still no direct identifiers
- Clue 3: Medium — may include state OR region + one more interesting fact
- Clue 4: Easier — may include mascot OR colors OR stadium name
- Clue 5: Near giveaway — very direct, include city and state

RULES:
- Write for casual fans (think Friday Night Lights), not scouts
- Great clues: famous alumni, state championship years, wild traditions, unique facts
- Avoid: "they compete in District X-XA", generic win-loss records
- Each clue must stand alone without knowing the answer

Return ONLY a valid JSON object, NO markdown, NO backticks, NO explanation:
{
  "answer": "full school name with High School",
  "mascot": "mascot name",
  "city": "city",
  "state": "TX",
  "stadium": "stadium name or empty string",
  "clues": ["clue1", "clue2", "clue3", "clue4", "clue5"],
  "clueConfidence": ["high|medium|low", "high|medium|low", "high|medium|low", "high|medium|low", "high|medium|low"],
  "clueTypes": ["fact|location|colors|mascot|stadium|alumni"],
  "sources": ["source description per clue"],
  "overallConfidence": "high|medium|low",
  "type": "school"
}`;

  const res = await client.messages.create({
    model:      MODEL,
    max_tokens: 2000,
    tools:      [{ type: 'web_search_20250305', name: 'web_search' }],
    messages:   [{ role: 'user', content: prompt }]
  });

  const raw = extractFinalText(res.content);
  if (!raw) throw new Error('No text in generation response. Block types: ' + res.content.map(b => b.type).join(', '));

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON found in response: ' + raw.substring(0, 200));
  return JSON.parse(jsonMatch[0]);
}

// ── CORE: Verify puzzle accuracy via Claude ───────────────────────────────────
async function verifyPuzzle(puzzleData, apiKey) {
  const client = new Anthropic({ apiKey });

  const prompt = `Fact-check these clues about ${puzzleData.answer} in ${puzzleData.city}, ${puzzleData.state}.

Use web search to verify each clue. For each one determine:
1. Is it factually accurate?
2. Is it useful as a guessing clue?
3. Does it give away too much too early?

Clues:
${puzzleData.clues.map((c, i) => `Clue ${i + 1}: "${c}"`).join('\n')}

Return ONLY valid JSON, NO markdown:
{
  "verified": true,
  "clueVerifications": [
    { "accurate": true, "confidence": "high|medium|low", "issue": null, "suggestedFix": null },
    { "accurate": true, "confidence": "high|medium|low", "issue": null, "suggestedFix": null },
    { "accurate": true, "confidence": "high|medium|low", "issue": null, "suggestedFix": null },
    { "accurate": true, "confidence": "high|medium|low", "issue": null, "suggestedFix": null },
    { "accurate": true, "confidence": "high|medium|low", "issue": null, "suggestedFix": null }
  ],
  "overallVerdict": "approve|fix|reject",
  "rejectionReason": null
}

Verdict rules:
- "approve": all clues are high/medium confidence, no major issues
- "fix": 1-2 clues need replacement (provide suggestedFix for those)
- "reject": school not found online, 3+ bad clues, or fundamental accuracy problem`;

  const res = await client.messages.create({
    model:      MODEL,
    max_tokens: 1500,
    tools:      [{ type: 'web_search_20250305', name: 'web_search' }],
    messages:   [{ role: 'user', content: prompt }]
  });

  const raw = extractFinalText(res.content);
  if (!raw) {
    return {
      verified:          false,
      overallVerdict:    'fix',
      clueVerifications: puzzleData.clues.map(() => ({ accurate: true, confidence: 'medium', issue: null, suggestedFix: null })),
      rejectionReason:   'Verification returned no text — manual review needed'
    };
  }

  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON');
    return JSON.parse(jsonMatch[0]);
  } catch (_) {
    return {
      verified:          false,
      overallVerdict:    'fix',
      clueVerifications: puzzleData.clues.map(() => ({ accurate: true, confidence: 'medium', issue: null, suggestedFix: null })),
      rejectionReason:   'Verification parse error — manual review needed'
    };
  }
}

// ── CORE: Apply clue fixes from verification ──────────────────────────────────
function applyVerificationFixes(puzzleData, verification) {
  const fixed = { ...puzzleData };
  fixed.clues          = [...puzzleData.clues];
  fixed.clueConfidence = [...(puzzleData.clueConfidence || ['medium','medium','medium','medium','medium'])];

  (verification.clueVerifications || []).forEach((v, i) => {
    if (v.suggestedFix && (!v.accurate || v.confidence === 'low')) {
      fixed.clues[i]          = v.suggestedFix;
      fixed.clueConfidence[i] = 'medium';
    } else {
      fixed.clueConfidence[i] = v.confidence || fixed.clueConfidence[i];
    }
  });
  return fixed;
}

// ── MAIN TRIGGER ──────────────────────────────────────────────────────────────
exports.generatePuzzleOnNomination = onDocumentCreated(
  { document: 'totw_nominees/{nomineeId}', timeoutSeconds: 300, memory: '512MiB', secrets: ['ANTHROPIC_API_KEY'] },
  async (event) => {
    const nominee   = event.data.data();
    const nomineeId = event.params.nomineeId;

    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_API_KEY) {
      console.error('ANTHROPIC_API_KEY secret not set');
      return;
    }

    const teamName = nominee.teamName || '';
    const city     = nominee.city     || '';
    const state    = nominee.state    || '';
    const mascot   = nominee.mascot   || '';

    if (!teamName || !city || !state) {
      console.log('Skipping — missing required fields:', { teamName, city, state });
      return;
    }

    // Skip if puzzle already exists for this school
    const existing = await db.collection('puzzles').where('answer', '==', teamName).limit(1).get();
    if (!existing.empty) {
      console.log('Puzzle already exists for', teamName, '— skipping');
      return;
    }

    console.log('Generating puzzle for:', teamName, city, state);

    try {
      // ── Step 1: Generate ──────────────────────────────────────────────────
      let puzzleData = await generatePuzzle(teamName, city, state, mascot, ANTHROPIC_API_KEY);

      // ── Step 2: Verify ────────────────────────────────────────────────────
      const verification = await verifyPuzzle(puzzleData, ANTHROPIC_API_KEY);
      console.log('Verification verdict:', verification.overallVerdict, 'for', teamName);

      // ── Step 3: Handle verdict ────────────────────────────────────────────
      if (verification.overallVerdict === 'reject') {
        await db.collection('puzzle_queue').add({
          ...puzzleData,
          status:             'rejected',
          rejectionReason:    verification.rejectionReason,
          nomineeId,
          generatedAt:        Date.now(),
          scheduledPuzzleNum: null
        });
        console.log('Puzzle rejected for', teamName, ':', verification.rejectionReason);
        return;
      }

      if (verification.overallVerdict === 'fix') {
        puzzleData = applyVerificationFixes(puzzleData, verification);
      }

      // ── Step 4: Schedule ──────────────────────────────────────────────────
      const puzzleNum = await getNextPuzzleNumber();

      const finalPuzzle = {
        answer:              puzzleData.answer   || teamName,
        mascot:              puzzleData.mascot   || mascot,
        city:                puzzleData.city     || city,
        state:               puzzleData.state    || state,
        stadium:             puzzleData.stadium  || '',
        logoUrl:             '',
        stadiumImageUrl:     null,
        clues:               puzzleData.clues,
        clueTypes:           puzzleData.clueTypes       || [],
        clueConfidence:      puzzleData.clueConfidence  || [],
        sources:             puzzleData.sources         || [],
        type:                'school',
        autoGenerated:       true,
        verificationVerdict: verification.overallVerdict,
        nomineeId,
        generatedAt:         Date.now()
      };

      await db.collection('puzzles').doc(String(puzzleNum)).set(finalPuzzle);

      await db.collection('puzzle_queue').add({
        ...finalPuzzle,
        status:             'approved',
        scheduledPuzzleNum: puzzleNum,
        nomineeId,
        generatedAt:        Date.now()
      });

      console.log(`✓ Puzzle #${puzzleNum} generated and scheduled for ${teamName}`);

    } catch (err) {
      console.error('Puzzle generation failed for', teamName, ':', err.message);

      await db.collection('puzzle_queue').add({
        teamName, city, state, mascot,
        status:             'failed',
        error:              err.message,
        nomineeId,
        generatedAt:        Date.now(),
        scheduledPuzzleNum: null
      });
    }
  }
);


// ── FRIDAY NIGHT PULSE: aggregate recompute on rating write ───────────────────
// Triggered on any create/update/delete of a pulse_ratings doc.
// Reads all ratings for the affected stadiumSlug, computes per-category
// averages + Bayesian composite, writes to the stadiums/{slug} doc.

const PULSE_CATEGORIES = [
  'overallVibe', 'crowdNoise', 'intimidation', 'gameNightAtmosphere',
  'bandStudent', 'concessions', 'facilities', 'homeFieldAdvantage'
];
const PULSE_BAYES_C = 5;     // confidence prior — small; 8-cat composite is denser data than binary
const PULSE_BAYES_M = 7.0;   // global mean prior

exports.recomputeStadiumPulse = onDocumentWritten(
  { document: 'pulse_ratings/{ratingId}', timeoutSeconds: 30, memory: '256MiB' },
  async (event) => {
    const after  = event.data?.after?.data();
    const before = event.data?.before?.data();
    const slug = after?.stadiumSlug || before?.stadiumSlug;
    if (!slug) return;

    const stadiumRef = db.collection('stadiums').doc(slug);

    const snap = await db.collection('pulse_ratings').where('stadiumSlug', '==', slug).get();
    if (snap.empty) {
      await stadiumRef.update({
        ratingsCount:  0,
        ratingsAvg:    null,
        bayesianScore: null,
        pulseScore:    null,
        lastRatedAt:   null,
      }).catch(err => console.warn('reset stadium failed:', slug, err.message));
      return;
    }

    const ratings = [];
    snap.forEach(d => ratings.push(d.data()));

    // Per-category average
    const ratingsAvg = {};
    PULSE_CATEGORIES.forEach(cat => {
      const vals = ratings.map(r => r.scores?.[cat]).filter(v => typeof v === 'number');
      ratingsAvg[cat] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    });

    // Composite Bayesian: average each rating's mean across 8 cats, then bayesian-adjust
    const ratingMeans = ratings.map(r => {
      const vals = PULSE_CATEGORIES.map(c => r.scores?.[c]).filter(v => typeof v === 'number');
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    });
    const sumMeans = ratingMeans.reduce((a, b) => a + b, 0);
    const bayesianScore = (PULSE_BAYES_C * PULSE_BAYES_M + sumMeans) / (PULSE_BAYES_C + ratingMeans.length);

    const lastRatedAt = Math.max(...ratings.map(r => r.submittedAt || 0));

    await stadiumRef.update({
      ratingsCount:  ratings.length,
      ratingsAvg,
      bayesianScore,
      pulseScore:    bayesianScore,    // mirrored field for ordering convenience
      lastRatedAt,
    }).catch(err => console.warn('update stadium failed:', slug, err.message));

    console.log(`[pulse] recomputed ${slug}: ${ratings.length} rating${ratings.length === 1 ? '' : 's'}, score=${bayesianScore.toFixed(2)}`);
  }
);


// ── FRIDAY NIGHT PULSE: copy approved photo into stadium doc ─────────────────
// When a pulse_photo_submissions doc transitions approved: false → true, append
// the photo into the stadium's photos[] array so it appears immediately.

exports.copyApprovedPulsePhoto = onDocumentWritten(
  { document: 'pulse_photo_submissions/{subId}', timeoutSeconds: 30, memory: '256MiB' },
  async (event) => {
    const before = event.data?.before?.data();
    const after  = event.data?.after?.data();
    if (!after) return;
    const wasApproved = before?.approved === true;
    const isApproved  = after.approved === true;
    if (wasApproved || !isApproved) return; // only act on the false→true transition

    const slug = after.stadiumSlug;
    if (!slug) return;

    const stadiumRef = db.collection('stadiums').doc(slug);
    const snap = await stadiumRef.get();
    if (!snap.exists) return;
    const stadium = snap.data();
    const photos = Array.isArray(stadium.photos) ? stadium.photos.slice() : [];

    photos.push({
      url:          after.imageUrl,
      source:       'user',
      credit:       after.uploaderName || null,
      sourcePage:   null,
      uploaderName: after.uploaderName || null,
      caption:      after.caption || null,
      approved:     true,
      addedAt:      Date.now(),
    });

    await stadiumRef.update({ photos });
    console.log(`[pulse] approved photo copied to ${slug}`);
  }
);


// ─────────────────────────────────────────────────────────────────────
// JIMMYS & JOES — Recompute prospect rating on every rating write.
// Mirrors recomputeStadiumPulse: triggered on prospect_ratings/{ratingId}
// writes, re-aggregates all ratings for the affected prospect, and writes
// the composite J&J rating + histogram back onto the prospect doc.
//
// Component weights and accolade points are duplicated here from
// js/jj-config.js so this CommonJS function stays self-contained.
// Keep these in sync if you edit the client-side config.
// ─────────────────────────────────────────────────────────────────────

// Match SCORE_WEIGHTS in js/jj-config.js.
const JJ_WEIGHTS = { film: 0.70, production: 0.15, accolades: 0.10, measurables: 0.05 };

// Match ACCOLADES[].points in js/jj-config.js.
const JJ_ACCOLADE_POINTS = {
  'aa-1st': 30, 'aa-2nd': 22,
  'as-1st': 18, 'as-2nd': 14, 'as-hm': 8,
  'state-mvp': 25, 'state-poy': 25, 'state-opoy': 22, 'state-dpoy': 22,
  'region-mvp': 15, 'region-opoy': 12, 'region-dpoy': 12,
  'dist-mvp': 12, 'dist-opoy': 10, 'dist-dpoy': 10, 'dist-nfp': 6,
  'all-dist-1st': 8, 'all-dist-2nd': 5,
  'team-capt': 4, 'state-champ': 12, 'state-runner': 7,
  'combine-elite': 10, 'camp-mvp': 6,
};

function jjAccoladesScore(accs) {
  if (!Array.isArray(accs) || !accs.length) return 0;
  const total = accs.reduce((sum, a) => sum + (JJ_ACCOLADE_POINTS[a?.id] || 0), 0);
  return 5 * Math.tanh(total / 35);
}

function jjMeasurablesScore({ testing, heightInches, weightLbs }) {
  const pieces = [];
  const forty = testing?.fortyElectronic ?? testing?.fortyHand;
  if (typeof forty === 'number' && forty > 0) {
    const s = 5 - ((forty - 4.4) / 0.80) * 4;
    pieces.push(Math.max(1, Math.min(5, s)));
  }
  if (typeof heightInches === 'number' && typeof weightLbs === 'number') {
    const surplus = Math.max(0, heightInches - 70) + Math.max(0, (weightLbs - 170) / 10);
    pieces.push(Math.min(5, 1 + surplus / 8));
  }
  if (!pieces.length) return 0;
  return pieces.reduce((a, b) => a + b, 0) / pieces.length;
}

// Match STATS_BY_POSITION in js/jj-config.js.
const JJ_STATS_BY_POSITION = {
  QB:   [{ key:'passYards',bench:3000},{ key:'passTDs',bench:35},{ key:'completionPct',bench:65},{ key:'rushYards',bench:800}],
  RB:   [{ key:'rushYards',bench:1800},{ key:'rushTDs',bench:25},{ key:'yardsPerCarry',bench:8},{ key:'recYards',bench:500}],
  WR:   [{ key:'receptions',bench:70},{ key:'recYards',bench:1200},{ key:'recTDs',bench:15},{ key:'yardsPerRec',bench:18}],
  TE:   [{ key:'receptions',bench:50},{ key:'recYards',bench:700},{ key:'recTDs',bench:10}],
  OL:   [{ key:'pancakes',bench:60},{ key:'gamesStarted',bench:14},{ key:'sacksAllowed',inverse:true,hardCap:8}],
  DL:   [{ key:'tackles',bench:70},{ key:'tfl',bench:20},{ key:'sacks',bench:12}],
  EDGE: [{ key:'tackles',bench:60},{ key:'tfl',bench:22},{ key:'sacks',bench:15},{ key:'forcedFumbles',bench:5}],
  LB:   [{ key:'tackles',bench:120},{ key:'tfl',bench:18},{ key:'sacks',bench:8},{ key:'interceptions',bench:3}],
  CB:   [{ key:'interceptions',bench:5},{ key:'passBreakups',bench:12},{ key:'tackles',bench:50}],
  S:    [{ key:'tackles',bench:80},{ key:'interceptions',bench:5},{ key:'passBreakups',bench:10},{ key:'forcedFumbles',bench:3}],
};

function jjProductionScore(stats, positionCode) {
  if (!stats || !positionCode) return 0;
  const schema = JJ_STATS_BY_POSITION[positionCode];
  if (!schema || !schema.length) return 0;
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
  return sum / count;
}

exports.recomputeProspectRating = onDocumentWritten(
  { document: 'prospect_ratings/{ratingId}', timeoutSeconds: 30, memory: '256MiB' },
  async (event) => {
    const after  = event.data?.after?.data();
    const before = event.data?.before?.data();
    const prospectId = after?.prospectId || before?.prospectId;
    if (!prospectId) return;

    const prospectRef = db.collection('prospects').doc(prospectId);
    const prospectSnap = await prospectRef.get();
    if (!prospectSnap.exists) return;
    const prospect = prospectSnap.data();

    const snap = await db.collection('prospect_ratings')
      .where('prospectId', '==', prospectId)
      .get();

    if (snap.empty) {
      await prospectRef.update({
        ratingCount: 0,
        ratingAvg: null,
        filmTraitsAvg: 0,
        productionScore: 0,
        accoladesScore: 0,
        measurablesScore: 0,
        jjRating: 0,
        ratingDistribution: [0, 0, 0, 0, 0],
        trendingScore: 0,
        lastRatedAt: null,
      }).catch(err => console.warn('[jj] reset prospect failed:', prospectId, err.message));
      return;
    }

    const ratings = [];
    snap.forEach(d => ratings.push(d.data()));

    // Per-rating combined score = mean of overall + all trait values present.
    const perRater = ratings.map(r => {
      const vals = [r.overall];
      if (r.traits && typeof r.traits === 'object') {
        Object.values(r.traits).forEach(v => { if (typeof v === 'number') vals.push(v); });
      }
      return vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length);
    });

    const filmTraitsAvg = perRater.reduce((a, b) => a + b, 0) / perRater.length;
    const accoladesScore = jjAccoladesScore(prospect.accolades);
    const measurablesScore = jjMeasurablesScore({
      testing: prospect.testing,
      heightInches: prospect.heightInches,
      weightLbs: prospect.weightLbs,
    });
    const productionScore = jjProductionScore(prospect.stats, prospect.primaryPosition);

    // Weighted composite, re-normalizing across components that actually
    // contributed (so missing production/measurables don't drag the score).
    const components = [
      { w: JJ_WEIGHTS.film,        v: filmTraitsAvg   },
      { w: JJ_WEIGHTS.production,  v: productionScore },
      { w: JJ_WEIGHTS.accolades,   v: accoladesScore  },
      { w: JJ_WEIGHTS.measurables, v: measurablesScore},
    ];
    const active = components.filter(c => c.v > 0);
    const totalW = active.reduce((s, c) => s + c.w, 0) || 1;
    const jjRating = active.reduce((s, c) => s + (c.v * c.w / totalW), 0);

    // Histogram by integer overall bucket (1–5).
    const dist = [0, 0, 0, 0, 0];
    ratings.forEach(r => {
      const b = Math.max(1, Math.min(5, Math.round(r.overall)));
      dist[b - 1] += 1;
    });

    // Trending score = ratings + comments-like activity in the last 48h.
    const now = Date.now();
    const recent = ratings.filter(r => (now - (r.ratedAt || 0)) < 48 * 3600 * 1000).length;
    const trendingScore = recent * 3 + ratings.length;   // weighted toward recency

    const lastRatedAt = Math.max(...ratings.map(r => r.ratedAt || 0));

    await prospectRef.update({
      ratingCount:       ratings.length,
      ratingAvg:         ratings.reduce((s, r) => s + r.overall, 0) / ratings.length,
      filmTraitsAvg:     round2(filmTraitsAvg),
      productionScore:   round2(productionScore),
      accoladesScore:    round2(accoladesScore),
      measurablesScore:  round2(measurablesScore),
      jjRating:          round2(jjRating),
      ratingDistribution: dist,
      trendingScore,
      lastRatedAt,
    }).catch(err => console.warn('[jj] update prospect failed:', prospectId, err.message));

    console.log(`[jj] recomputed ${prospectId}: ${ratings.length} rating(s), jj=${jjRating.toFixed(2)}`);
  }
);

function round2(n) {
  if (typeof n !== 'number' || isNaN(n)) return 0;
  return Math.round(n * 100) / 100;
}


// ─────────────────────────────────────────────────────────────────────
// JIMMYS & JOES — GAMIFICATION (points, streaks, badges, public mirror)
//
// Hard rule: clients cannot write points/badges/streak directly (enforced
// by Firestore rules). All writes happen here via the Admin SDK.
//
// Three triggers:
//  1. awardRatingPoints      — on prospect_ratings/{id} create
//  2. awardCommentVotePoints — on comment_votes/{id} create
//  3. mirrorUserPublic       — on users/{uid} write (sync to users_public)
//
// Badge thresholds + points-per-event are duplicated here from
// js/jj-config.js. Keep in sync if you change either.
// ─────────────────────────────────────────────────────────────────────

const { FieldValue } = require('firebase-admin/firestore');

const JJ_POINTS = {
  ratingBase:         1,
  ratingDetailBonus:  2,
  ratingRandomBonus:  1,   // awarded when the rater landed via "Rate a Random Jimmy"
  commentUpvote:      1,
};

// Sorted highest-tier-first so the "top badge" is just badges[0] after sort.
const JJ_BADGES = [
  { id: 'rater-500',   tier: 6, check: u => (u.ratingsCount || 0) >= 500 },
  { id: 'helpful-100', tier: 6, check: u => (u.helpfulVotesReceived || 0) >= 100 },
  { id: 'streak-30',   tier: 5, check: u => (u.streak || 0) >= 30 },
  { id: 'rater-100',   tier: 4, check: u => (u.ratingsCount || 0) >= 100 },
  { id: 'helpful-25',  tier: 4, check: u => (u.helpfulVotesReceived || 0) >= 25 },
  { id: 'rater-50',    tier: 3, check: u => (u.ratingsCount || 0) >= 50 },
  { id: 'streak-7',    tier: 3, check: u => (u.streak || 0) >= 7 },
  { id: 'rater-10',    tier: 2, check: u => (u.ratingsCount || 0) >= 10 },
  { id: 'streak-3',    tier: 2, check: u => (u.streak || 0) >= 3 },
  { id: 'helpful-5',   tier: 2, check: u => (u.helpfulVotesReceived || 0) >= 5 },
  { id: 'first-rating',tier: 1, check: u => (u.ratingsCount || 0) >= 1 },
];

function jjEarnedBadges(userStats) {
  const earned = [];
  for (const b of JJ_BADGES) {
    if (b.check(userStats)) earned.push(b.id);
  }
  return earned;
}

function jjIsDetailedRating(rating) {
  if (!rating) return false;
  const text = (rating.comment || '').trim();
  if (text.length >= 20) return true;
  const traits = rating.traits || {};
  return Object.values(traits).some(v => typeof v === 'number' && Math.abs(v - 3) > 0.01);
}

// YYYY-MM-DD in UTC (rater could be anywhere; UTC is fine for streak math
// and keeps the function deterministic regardless of server timezone).
function jjDayKey(tsMillis) {
  const d = new Date(tsMillis);
  return d.getUTCFullYear() + '-' +
         String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
         String(d.getUTCDate()).padStart(2, '0');
}

// 1 if same day, 2 if next day, > 2 if streak broke, 0 if first ever.
function jjDayDelta(prevKey, newKey) {
  if (!prevKey) return 0;
  if (prevKey === newKey) return 1;
  const p = new Date(prevKey + 'T00:00:00Z').getTime();
  const n = new Date(newKey + 'T00:00:00Z').getTime();
  return Math.round((n - p) / 86400000) + 1;   // 2 = next day, 3+ = broke
}

// ── Trigger 1: rating points ────────────────────────────────────────
exports.awardRatingPoints = onDocumentCreated(
  { document: 'prospect_ratings/{ratingId}', timeoutSeconds: 30, memory: '256MiB' },
  async (event) => {
    const rating = event.data?.data();
    if (!rating?.raterUid) return;           // anonymous ratings don't earn points
    const uid = rating.raterUid;

    const ratingId = event.params.ratingId;
    const ratingTime = rating.ratedAt || Date.now();

    const userRef = db.collection('users').doc(uid);
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      if (!snap.exists) return { skipped: 'no user doc' };

      const prev = snap.data();
      const newDayKey = jjDayKey(ratingTime);
      const prevDayKey = prev.lastRatedDate || null;
      const delta = jjDayDelta(prevDayKey, newDayKey);

      // Idempotency: track which rating IDs we've credited so re-running
      // the function (cold start, etc.) doesn't double-pay.
      const credited = Array.isArray(prev.creditedRatingIds) ? prev.creditedRatingIds : [];
      if (credited.includes(ratingId)) return { skipped: 'already credited' };

      const pointsEarned = JJ_POINTS.ratingBase
        + (jjIsDetailedRating(rating) ? JJ_POINTS.ratingDetailBonus : 0)
        + (rating.viaRandom === true   ? JJ_POINTS.ratingRandomBonus : 0);

      // Streak: 1 if first ever or broken; ++ if next day; unchanged if same day.
      let streak;
      if (delta === 0)      streak = 1;                   // first ever
      else if (delta === 1) streak = prev.streak || 1;    // same day
      else if (delta === 2) streak = (prev.streak || 0) + 1; // next day
      else                  streak = 1;                   // broke

      const newRatingsCount = (prev.ratingsCount || 0) + 1;
      const newPoints       = (prev.points || 0) + pointsEarned;

      // Compute badges using the updated stats (keep helpfulVotesReceived as-is).
      const newBadges = jjEarnedBadges({
        ratingsCount: newRatingsCount,
        helpfulVotesReceived: prev.helpfulVotesReceived || 0,
        streak,
      });

      // Trim creditedRatingIds to last 200 to bound the user doc size.
      const newCredited = credited.concat([ratingId]).slice(-200);

      tx.update(userRef, {
        points: newPoints,
        ratingsCount: newRatingsCount,
        streak,
        badges: newBadges,
        lastRatedAt: ratingTime,
        lastRatedDate: newDayKey,
        creditedRatingIds: newCredited,
      });
      return { uid, pointsEarned, streak, badges: newBadges, newRatingsCount };
    });

    if (result?.skipped) {
      console.log(`[jj-points] rating ${ratingId}: ${result.skipped}`);
      return;
    }
    console.log(`[jj-points] +${result.pointsEarned} to ${result.uid} ` +
                `(ratings=${result.newRatingsCount}, streak=${result.streak}d)`);
  }
);

// ── Trigger 2: upvote a comment → bump comment helpful + author points ──
exports.awardCommentVotePoints = onDocumentWritten(
  { document: 'comment_votes/{voteId}', timeoutSeconds: 30, memory: '256MiB' },
  async (event) => {
    const before = event.data?.before?.data();
    const after  = event.data?.after?.data();
    const data   = after || before;
    if (!data?.commentId) return;

    const wasCounted = !!before;
    const isCounted  = !!after;
    if (wasCounted === isCounted) return;

    const direction = isCounted ? 1 : -1;     // +1 on create, -1 on delete
    const commentRef = db.collection('prospect_comments').doc(data.commentId);
    const commentSnap = await commentRef.get();
    if (!commentSnap.exists) return;

    const comment = commentSnap.data();
    const authorUid = comment.authorUid;

    // Bump the helpful counter on the comment doc itself.
    await commentRef.update({
      helpful: FieldValue.increment(direction),
    }).catch(err => console.warn('[jj-vote] comment update failed:', err.message));

    if (!authorUid) return;

    // Award/refund a point on the author's user doc.
    const userRef = db.collection('users').doc(authorUid);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      if (!snap.exists) return;
      const prev = snap.data();
      const newPoints    = Math.max(0, (prev.points || 0) + direction * JJ_POINTS.commentUpvote);
      const newHelpful   = Math.max(0, (prev.helpfulVotesReceived || 0) + direction);
      const badges = jjEarnedBadges({
        ratingsCount: prev.ratingsCount || 0,
        helpfulVotesReceived: newHelpful,
        streak: prev.streak || 0,
      });
      tx.update(userRef, {
        points: newPoints,
        helpfulVotesReceived: newHelpful,
        badges,
      });
    }).catch(err => console.warn('[jj-vote] author point update failed:', err.message));

    console.log(`[jj-vote] comment ${data.commentId}: ${direction > 0 ? '+' : '−'}1 helpful → author ${authorUid}`);
  }
);

// ── Trigger 3: mirror safe fields from users/{uid} to users_public/{uid} ──
exports.mirrorUserPublic = onDocumentWritten(
  { document: 'users/{uid}', timeoutSeconds: 20, memory: '256MiB' },
  async (event) => {
    const uid = event.params.uid;
    const after = event.data?.after?.data();
    if (!after) {
      await db.collection('users_public').doc(uid).delete().catch(() => {});
      return;
    }
    await db.collection('users_public').doc(uid).set({
      uid,
      displayName: after.displayName || null,
      photoURL:    after.photoURL    || null,
      role:        after.role        || 'member',
      points:                after.points || 0,
      streak:                after.streak || 0,
      badges:                Array.isArray(after.badges) ? after.badges : [],
      ratingsCount:          after.ratingsCount || 0,
      helpfulVotesReceived:  after.helpfulVotesReceived || 0,
      lastRatedDate:         after.lastRatedDate || null,
      updatedAt:             Date.now(),
    }, { merge: true }).catch(err => console.warn('[jj-mirror] failed:', uid, err.message));
  }
);

// ── Trigger 4: profile claim approved → stamp prospect doc ───────────
// Admin flips prospect_claims/{id}.status to 'approved'. This function
// then writes coachUid + coachSchool + coachName + claimedAt onto the
// referenced prospect, which the rules allow for the Admin SDK only.
exports.awardProfileClaim = onDocumentWritten(
  { document: 'prospect_claims/{claimId}', timeoutSeconds: 30, memory: '256MiB' },
  async (event) => {
    const before = event.data?.before?.data();
    const after  = event.data?.after?.data();
    if (!after) return;
    const wasApproved = before?.status === 'approved';
    const isApproved  = after.status   === 'approved';
    if (wasApproved || !isApproved) return;        // only fire on the transition

    const prospectId = after.prospectId;
    if (!prospectId) return;
    try {
      await db.collection('prospects').doc(prospectId).update({
        coachUid:    after.coachUid    || null,
        coachName:   after.coachName   || null,
        coachSchool: after.coachSchool || null,
        claimedAt:   after.decidedAt   || Date.now(),
      });
      console.log(`[jj-claim] stamped ${prospectId} → coach ${after.coachUid}`);
    } catch (err) {
      console.warn(`[jj-claim] failed to stamp ${prospectId}:`, err.message);
    }
  }
);
