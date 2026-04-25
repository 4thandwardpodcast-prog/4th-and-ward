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

