/**
 * 4th & Ward — Firebase Cloud Functions
 * Auto-generates, verifies, and schedules Wardle puzzles
 * when a team is nominated for Team of the Week.
 */

const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { defineSecret }      = require('firebase-functions/params');
const { initializeApp }     = require('firebase-admin/app');
const { getFirestore }      = require('firebase-admin/firestore');
const Anthropic             = require('@anthropic-ai/sdk');
const fetch                 = require('node-fetch');

initializeApp();
const db = getFirestore();

// ── CONFIG ────────────────────────────────────────────────────────────────────
const ANTHROPIC_SECRET = defineSecret('ANTHROPIC_API_KEY');
const LAUNCH_DATE      = '2026-03-14'; // Must match wardle.html

// ── HELPER: Get next unoccupied puzzle number ─────────────────────────────────
async function getNextPuzzleNumber() {
  // Today's puzzle number = days since launch + 1
  const launch  = new Date(LAUNCH_DATE + 'T00:00:00Z');
  const now     = new Date();
  now.setUTCHours(0, 0, 0, 0);
  const todayNum = Math.max(1, Math.floor((now - launch) / 86400000) + 1);

  // Find the highest existing puzzle number
  const snap = await db.collection('puzzles').get();
  let maxNum = todayNum; // never schedule in the past
  snap.forEach(d => {
    const n = parseInt(d.id);
    if (!isNaN(n) && n > maxNum) maxNum = n;
  });

  return maxNum + 1;
}

// ── HELPER: Fetch MaxPreps logo ───────────────────────────────────────────────
async function fetchMaxPrepsLogo(teamName, city, state) {
  try {
    const q   = encodeURIComponent(`${teamName} ${city} ${state}`);
    const res = await fetch(`https://4thandward.com/api/maxpreps-logo?q=${q}`);
    if (!res.ok) return '';
    const data = await res.json();
    return data.logoUrl || '';
  } catch (e) {
    return '';
  }
}

// ── HELPER: Try to find a stadium image via web search ───────────────────────
async function fetchStadiumImage(stadiumName, city, state) {
  // We ask Claude to web-search for an image URL — returns empty if none found
  // This is best-effort; puzzles work fine without stadium images
  try {
    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
    const res = await client.messages.create({
      model:      'claude-opus-4-5',
      max_tokens: 200,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{
        role: 'user',
        content: `Find a direct image URL (jpg or png) of ${stadiumName} in ${city}, ${state}. 
                  Return ONLY the raw image URL, nothing else. 
                  If you cannot find a reliable direct image URL, return the word NONE.`
      }]
    });
    const text = res.content.find(b => b.type === 'text')?.text?.trim() || '';
    if (text === 'NONE' || !text.match(/^https?:\/\/.+\.(jpg|jpeg|png|webp)/i)) return '';
    return text;
  } catch (e) {
    return '';
  }
}

// ── CORE: Generate puzzle via Claude with web search grounding ────────────────
async function generatePuzzle(teamName, city, state, mascot, logoUrl) {
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  const generationPrompt = `You are generating a puzzle for "4th & Wardle", a daily guessing game about high school football programs, similar to Wordle. Players guess the school name from 5 clues revealed one at a time.

SCHOOL TO RESEARCH: ${teamName} in ${city}, ${state} — Mascot: ${mascot || 'unknown'}

STEP 1 — Research: Use web search to find real, verifiable facts about this program. Search for:
- "${teamName} football" 
- "${teamName} famous alumni NFL"
- "${teamName} stadium"
- "${teamName} football history championships"

STEP 2 — Generate exactly 5 clues using ONLY facts you found in your search results. Follow these rules:
- Clue 1: Most vague — one interesting fact, NO location/state/mascot/colors mentioned
- Clue 2: Still hard — one more fact, still no direct identifiers
- Clue 3: Medium — may include state OR a general region, one more interesting fact
- Clue 4: Easier — may include mascot OR colors OR stadium name
- Clue 5: Near giveaway — logo image if available, or very direct clue including city+state

CLUE QUALITY RULES:
- Write for casual fans who watch Friday Night Lights, NOT recruiting scouts
- Make clues interesting and surprising, not dry statistics
- Geographic clues are OK but don't use them as the ONLY type
- Avoid: "they compete in District X-XA", "their record was X-X last season"
- Great clues: famous alumni, wild stadium facts, historic moments, unique traditions, surprising facts
- Each clue must stand alone and be understandable without knowing the answer

STEP 3 — For each clue, rate your confidence: "high" (verified in search), "medium" (likely true), "low" (uncertain)

STEP 4 — Determine available visual clues:
- isLogoAvailable: ${logoUrl ? 'true' : 'false'} (logo URL was ${logoUrl ? 'found' : 'not found'})
- isStadiumImageAvailable: search for a stadium image and include the URL if found, otherwise null

Return ONLY a valid JSON object with NO markdown, NO backticks, NO explanation:
{
  "answer": "full school name with High School",
  "mascot": "mascot name",
  "city": "city",
  "state": "TX",
  "stadium": "stadium name or empty string",
  "stadiumImageUrl": "direct image URL or null",
  "clues": ["clue1", "clue2", "clue3", "clue4", "clue5"],
  "clueConfidence": ["high|medium|low", "high|medium|low", "high|medium|low", "high|medium|low", "high|medium|low"],
  "clueTypes": ["fact|location|colors|mascot|stadium|alumni|logo", ...],
  "sources": ["url or description of source per clue"],
  "overallConfidence": "high|medium|low",
  "type": "school"
}`;

  const genRes = await client.messages.create({
    model:      'claude-opus-4-5',
    max_tokens: 2000,
    tools:      [{ type: 'web_search_20250305', name: 'web_search' }],
    messages:   [{ role: 'user', content: generationPrompt }]
  });

  // Extract the JSON text block
  const textBlock = genRes.content.find(b => b.type === 'text');
  if (!textBlock) throw new Error('No text block in generation response');

  let puzzleData;
  try {
    const clean = textBlock.text.replace(/```json|```/g, '').trim();
    puzzleData = JSON.parse(clean);
  } catch (e) {
    throw new Error('Failed to parse puzzle JSON: ' + textBlock.text.substring(0, 200));
  }

  return puzzleData;
}

// ── CORE: Self-verify puzzle accuracy ─────────────────────────────────────────
async function verifyPuzzle(puzzleData) {
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  const verifyPrompt = `You are a fact-checker for a trivia game. Verify these clues about ${puzzleData.answer} in ${puzzleData.city}, ${puzzleData.state}.

Use web search to verify each clue. For each clue, determine:
1. Is it factually accurate?
2. Is it specific enough to be useful?
3. Does it accidentally give away too much too early?

Clues to verify:
${puzzleData.clues.map((c, i) => `Clue ${i + 1}: "${c}"`).join('\n')}

Return ONLY valid JSON with NO markdown:
{
  "verified": true|false,
  "clueVerifications": [
    { "accurate": true|false, "confidence": "high|medium|low", "issue": "description or null", "suggestedFix": "replacement clue or null" },
    ...5 items...
  ],
  "overallVerdict": "approve|fix|reject",
  "rejectionReason": "reason if reject, otherwise null"
}

Verdict rules:
- "approve": all clues high/medium confidence, no major issues
- "fix": 1-2 clues need replacement (use suggestedFix)
- "reject": school not found, 3+ bad clues, or fundamental accuracy problem`;

  const verRes = await client.messages.create({
    model:      'claude-opus-4-5',
    max_tokens: 1500,
    tools:      [{ type: 'web_search_20250305', name: 'web_search' }],
    messages:   [{ role: 'user', content: verifyPrompt }]
  });

  const textBlock = verRes.content.find(b => b.type === 'text');
  if (!textBlock) throw new Error('No text block in verification response');

  try {
    const clean = textBlock.text.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch (e) {
    // If verification JSON fails to parse, default to requiring review
    return {
      verified:         false,
      overallVerdict:   'fix',
      clueVerifications: puzzleData.clues.map(() => ({ accurate: true, confidence: 'medium', issue: null, suggestedFix: null })),
      rejectionReason:  'Verification parse error — manual review needed'
    };
  }
}

// ── CORE: Apply fixes from verification ───────────────────────────────────────
function applyVerificationFixes(puzzleData, verification) {
  const fixed = { ...puzzleData };
  fixed.clues = [...puzzleData.clues];
  fixed.clueConfidence = [...(puzzleData.clueConfidence || ['medium','medium','medium','medium','medium'])];

  verification.clueVerifications.forEach((v, i) => {
    if (v.suggestedFix && (!v.accurate || v.confidence === 'low')) {
      fixed.clues[i]           = v.suggestedFix;
      fixed.clueConfidence[i]  = 'medium'; // fixed clues get medium until re-verified
    } else {
      fixed.clueConfidence[i] = v.confidence || fixed.clueConfidence[i];
    }
  });

  return fixed;
}

// ── MAIN TRIGGER: New nomination added ───────────────────────────────────────
exports.generatePuzzleOnNomination = onDocumentCreated(
  { document: 'totw_nominees/{nomineeId}', timeoutSeconds: 300, memory: '512MiB', secrets: [ANTHROPIC_SECRET] },
  async (event) => {
    const nominee   = event.data.data();
    const nomineeId = event.params.nomineeId;

    const ANTHROPIC_API_KEY = ANTHROPIC_SECRET.value();
    const teamName = nominee.teamName || '';
    const city     = nominee.city     || '';
    const state    = nominee.state    || '';
    const mascot   = nominee.mascot   || '';
    const logoUrl  = nominee.logoUrl  || '';

    if (!teamName || !city || !state) {
      console.log('Skipping — missing required fields:', { teamName, city, state });
      return;
    }

    // Check if a puzzle already exists for this school
    const existing = await db.collection('puzzles')
      .where('answer', '==', teamName).limit(1).get();
    if (!existing.empty) {
      console.log('Puzzle already exists for', teamName, '— skipping');
      return;
    }

    console.log('Generating puzzle for:', teamName, city, state);

    try {
      // ── Step 1: Generate ──────────────────────────────────────────────────
      let puzzleData = await generatePuzzle(teamName, city, state, mascot, logoUrl);
      puzzleData.logoUrl = logoUrl; // attach logo from MaxPreps fetch already done at nomination

      // ── Step 2: Verify ────────────────────────────────────────────────────
      const verification = await verifyPuzzle(puzzleData);
      console.log('Verification verdict:', verification.overallVerdict, 'for', teamName);

      // ── Step 3: Handle verdict ────────────────────────────────────────────
      if (verification.overallVerdict === 'reject') {
        // Write as rejected — won't go live, visible in admin for manual handling
        await db.collection('puzzle_queue').add({
          ...puzzleData,
          logoUrl,
          status:           'rejected',
          rejectionReason:  verification.rejectionReason,
          nomineeId,
          generatedAt:      Date.now(),
          scheduledPuzzleNum: null
        });
        console.log('Puzzle rejected for', teamName, ':', verification.rejectionReason);
        return;
      }

      // Apply any fixes from verification
      if (verification.overallVerdict === 'fix') {
        puzzleData = applyVerificationFixes(puzzleData, verification);
      }

      // ── Step 4: Get next puzzle number and schedule ───────────────────────
      const puzzleNum = await getNextPuzzleNumber();

      // ── Step 5: Write to puzzles collection (goes live automatically) ─────
      const finalPuzzle = {
        answer:           puzzleData.answer     || teamName,
        mascot:           puzzleData.mascot     || mascot,
        city:             puzzleData.city       || city,
        state:            puzzleData.state      || state,
        stadium:          puzzleData.stadium    || '',
        logoUrl:          logoUrl,
        stadiumImageUrl:  puzzleData.stadiumImageUrl || null,
        clues:            puzzleData.clues,
        clueTypes:        puzzleData.clueTypes  || [],
        clueConfidence:   puzzleData.clueConfidence || [],
        sources:          puzzleData.sources    || [],
        type:             puzzleData.type       || 'school',
        autoGenerated:    true,
        verificationVerdict: verification.overallVerdict,
        nomineeId,
        generatedAt:      Date.now()
      };

      await db.collection('puzzles').doc(String(puzzleNum)).set(finalPuzzle);

      // Also write to queue log for admin visibility
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

      // Write failure to queue so admin can see it and handle manually
      await db.collection('puzzle_queue').add({
        teamName, city, state, mascot, logoUrl,
        status:         'failed',
        error:          err.message,
        nomineeId,
        generatedAt:    Date.now(),
        scheduledPuzzleNum: null
      });
    }
  }
);
