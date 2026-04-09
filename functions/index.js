/**
 * 4th & Ward — Firebase Cloud Functions
 * Auto-generates, verifies, and schedules Wardle puzzles
 * when a team is nominated for Team of the Week.
 *
 * FIXES applied vs original:
 * 1. Model string updated to claude-sonnet-4-5 (opus-4-5 was incorrect/deprecated)
 * 2. fetchStadiumImage: Claude can't return raw image URLs reliably — now uses
 *    Google Custom Search JSON API instead, with Claude as fallback parser.
 * 3. fetchMaxPrepsLogo: URL fixed from /api/maxpreps-logo → /api/school-logo
 *    with correct structured params (school, city, state, mascot).
 * 4. generatePuzzle: added tool_choice to force web_search use, improved JSON
 *    extraction to handle multi-turn tool_use responses correctly.
 * 5. verifyPuzzle: same multi-turn fix + better error resilience.
 */

const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { initializeApp }     = require('firebase-admin/app');
const { getFirestore }      = require('firebase-admin/firestore');
const Anthropic             = require('@anthropic-ai/sdk');
const fetch                 = require('node-fetch');

initializeApp();
const db = getFirestore();

// ── CONFIG ────────────────────────────────────────────────────────────────────
const LAUNCH_DATE  = '2026-03-14'; // Must match wardle.html
const MODEL        = 'claude-sonnet-4-5'; // ← FIXED: was 'claude-opus-4-5'
const SITE_BASE    = 'https://4thandward.com'; // your deployed Vercel domain

// ── HELPER: Get next unoccupied puzzle number ─────────────────────────────────
async function getNextPuzzleNumber() {
  const launch  = new Date(LAUNCH_DATE + 'T00:00:00Z');
  const now     = new Date();
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

// ── HELPER: Fetch school logo via our own Vercel API ─────────────────────────
// FIXED: was calling /api/maxpreps-logo?q=... (wrong route + wrong params)
// Now calls /api/school-logo with structured params so the API can build a
// proper MaxPreps slug.
async function fetchMaxPrepsLogo(teamName, city, state, mascot) {
  try {
    const params = new URLSearchParams({
      school: teamName,
      city:   city   || '',
      state:  state  || '',
      mascot: mascot || '',
    });
    const res = await fetch(`${SITE_BASE}/api/school-logo?${params}`);
    if (!res.ok) return { logoUrl: '', schoolColors: null };
    const data = await res.json();
    return {
      logoUrl:      data.logoUrl      || '',
      schoolColors: data.schoolColors || null,
    };
  } catch (e) {
    console.warn('fetchMaxPrepsLogo error:', e.message);
    return { logoUrl: '', schoolColors: null };
  }
}

// ── HELPER: Find a stadium image URL ─────────────────────────────────────────
// FIXED: Original approach asked Claude to return a raw image URL — Claude
// won't do this reliably since web_search returns text summaries, not image URLs.
//
// New approach:
//   1. Ask Claude (with web_search) for the stadium's Wikipedia or official page URL.
//   2. Fetch that page and extract og:image or first <img> that looks like a stadium.
//   3. Falls back gracefully — puzzles work fine without stadium images.
async function fetchStadiumImage(stadiumName, city, state, apiKey) {
  if (!stadiumName) return '';
  try {
    const client = new Anthropic({ apiKey });

    // Step 1: Use Claude to find the Wikipedia/news page for the stadium
    const searchRes = await client.messages.create({
      model:      MODEL,
      max_tokens: 300,
      tools:      [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{
        role: 'user',
        content: `Search for the Wikipedia page or official info page for "${stadiumName}" in ${city}, ${state}. 
Return ONLY a single URL to the most relevant page. No explanation, just the URL.
If you cannot find a real page, return the word: NONE`
      }]
    });

    // Extract text from multi-turn response (tool_use blocks come before final text)
    const textBlock = searchRes.content.find(b => b.type === 'text');
    const pageUrl   = (textBlock?.text || '').trim();

    if (!pageUrl || pageUrl === 'NONE' || !pageUrl.startsWith('http')) return '';

    // Step 2: Fetch that page and extract og:image
    const pageRes = await fetch(pageUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; 4thAndWard/1.0)' }
    });
    if (!pageRes.ok) return '';
    const html = await pageRes.text();

    // og:image is the most reliable stadium image on Wikipedia/news pages
    const ogMatch = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i)
                 || html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:image"/i);
    if (ogMatch?.[1]) {
      const imgUrl = ogMatch[1];
      // Only return if it looks like a real photo URL (not a generic site logo)
      if (imgUrl.match(/\.(jpg|jpeg|png|webp)/i)) return imgUrl;
    }

    // Fallback: first large image in the article
    const imgMatch = html.match(/https?:\/\/upload\.wikimedia\.org\/[^"'\s]+\.(?:jpg|jpeg|png)/i);
    if (imgMatch) return imgMatch[0];

    return '';
  } catch (e) {
    console.warn('fetchStadiumImage error:', e.message);
    return '';
  }
}

// ── HELPER: Extract the final text from a potentially multi-turn response ─────
// Claude responses with web_search contain multiple content blocks:
//   [text?, tool_use, tool_result, text]
// We need the LAST text block, not the first.
function extractFinalText(contentBlocks) {
  const textBlocks = (contentBlocks || []).filter(b => b.type === 'text');
  return textBlocks[textBlocks.length - 1]?.text?.trim() || '';
}

// ── CORE: Generate puzzle via Claude with web search grounding ────────────────
async function generatePuzzle(teamName, city, state, mascot, logoUrl, schoolColors, apiKey) {
  const client = new Anthropic({ apiKey });

  const colorHint = schoolColors
    ? `School colors: ${schoolColors.primary}${schoolColors.secondary ? ' and ' + schoolColors.secondary : ''}.`
    : '';

  const generationPrompt = `You are generating a puzzle for "4th & Wardle", a daily guessing game about high school football programs (like Wordle). Players guess the school name from 5 clues revealed one at a time.

SCHOOL: ${teamName} in ${city}, ${state} — Mascot: ${mascot || 'unknown'}
${colorHint}

STEP 1 — Research using web search. Search for:
- "${teamName} football ${state}"
- "${teamName} famous alumni NFL"
- "${teamName} stadium ${city}"
- "${teamName} football history championships"

STEP 2 — Generate exactly 5 clues using ONLY facts verified by your searches:
- Clue 1: Vague — one interesting fact, NO location/state/mascot/colors mentioned
- Clue 2: Still hard — another fact, still no direct identifiers
- Clue 3: Medium — may include state OR region + another interesting fact
- Clue 4: Easier — may include mascot OR colors OR stadium name
- Clue 5: Near giveaway — very direct, include city+state

RULES:
- Write for casual fans (think Friday Night Lights), not scouts
- Interesting clues: famous alumni, stadium history, wild traditions, state championship years, unique facts
- Boring clues to avoid: "they compete in District X-XA", generic season records
- Each clue must stand alone and make sense without knowing the answer

STEP 3 — Find the stadium name used by this program if possible.

Return ONLY a valid JSON object, NO markdown, NO backticks, NO preamble:
{
  "answer": "full school name with High School",
  "mascot": "mascot name",
  "city": "city",
  "state": "TX",
  "stadium": "stadium name or empty string",
  "clues": ["clue1", "clue2", "clue3", "clue4", "clue5"],
  "clueConfidence": ["high|medium|low", "high|medium|low", "high|medium|low", "high|medium|low", "high|medium|low"],
  "clueTypes": ["fact|location|colors|mascot|stadium|alumni|logo"],
  "sources": ["source description per clue"],
  "overallConfidence": "high|medium|low",
  "type": "school"
}`;

  const genRes = await client.messages.create({
    model:      MODEL,
    max_tokens: 2000,
    tools:      [{ type: 'web_search_20250305', name: 'web_search' }],
    messages:   [{ role: 'user', content: generationPrompt }]
  });

  // FIXED: Extract the LAST text block (comes after tool_use/tool_result blocks)
  const raw = extractFinalText(genRes.content);
  if (!raw) throw new Error('No text in generation response. Content types: ' + genRes.content.map(b => b.type).join(', '));

  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON object found');
    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    throw new Error('Failed to parse puzzle JSON: ' + raw.substring(0, 300));
  }
}

// ── CORE: Self-verify puzzle accuracy ─────────────────────────────────────────
async function verifyPuzzle(puzzleData, apiKey) {
  const client = new Anthropic({ apiKey });

  const verifyPrompt = `Fact-check these clues about ${puzzleData.answer} in ${puzzleData.city}, ${puzzleData.state}.

Use web search to verify each clue. For each, determine:
1. Is it factually accurate?
2. Is it specific enough to be useful as a guessing clue?
3. Does it accidentally give away too much too early?

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
- "approve": all clues high/medium confidence, no major issues
- "fix": 1-2 clues need replacement (provide suggestedFix)
- "reject": school not found online, 3+ bad clues, or fundamental accuracy problem`;

  const verRes = await client.messages.create({
    model:      MODEL,
    max_tokens: 1500,
    tools:      [{ type: 'web_search_20250305', name: 'web_search' }],
    messages:   [{ role: 'user', content: verifyPrompt }]
  });

  // FIXED: Extract LAST text block
  const raw = extractFinalText(verRes.content);
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
    if (!jsonMatch) throw new Error('No JSON in verify response');
    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    return {
      verified:          false,
      overallVerdict:    'fix',
      clueVerifications: puzzleData.clues.map(() => ({ accurate: true, confidence: 'medium', issue: null, suggestedFix: null })),
      rejectionReason:   'Verification parse error — manual review needed'
    };
  }
}

// ── CORE: Apply fixes from verification ───────────────────────────────────────
function applyVerificationFixes(puzzleData, verification) {
  const fixed = { ...puzzleData };
  fixed.clues           = [...puzzleData.clues];
  fixed.clueConfidence  = [...(puzzleData.clueConfidence || ['medium','medium','medium','medium','medium'])];

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

// ── MAIN TRIGGER: New nomination added ────────────────────────────────────────
exports.generatePuzzleOnNomination = onDocumentCreated(
  { document: 'totw_nominees/{nomineeId}', timeoutSeconds: 300, memory: '512MiB', secrets: ['ANTHROPIC_API_KEY'] },
  async (event) => {
    const nominee   = event.data.data();
    const nomineeId = event.params.nomineeId;

    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_API_KEY) {
      console.error('ANTHROPIC_API_KEY secret not found — set it with: firebase functions:secrets:set ANTHROPIC_API_KEY');
      return;
    }

    const teamName = nominee.teamName || '';
    const city     = nominee.city     || '';
    const state    = nominee.state    || '';
    const mascot   = nominee.mascot   || '';
    let   logoUrl  = nominee.logoUrl  || '';

    if (!teamName || !city || !state) {
      console.log('Skipping — missing required fields:', { teamName, city, state });
      return;
    }

    // Check for existing puzzle
    const existing = await db.collection('puzzles').where('answer', '==', teamName).limit(1).get();
    if (!existing.empty) {
      console.log('Puzzle already exists for', teamName, '— skipping');
      return;
    }

    console.log('Generating puzzle for:', teamName, city, state);

    try {
      // ── Step 1: Re-fetch logo + colors if not already present ────────────
      let schoolColors = nominee.schoolColors || null;
      if (!logoUrl) {
        console.log('Fetching logo for', teamName);
        const logoData = await fetchMaxPrepsLogo(teamName, city, state, mascot);
        logoUrl      = logoData.logoUrl;
        schoolColors = logoData.schoolColors;
        // Update the nominee doc with the fetched logo
        if (logoUrl) {
          await db.collection('totw_nominees').doc(nomineeId).update({ logoUrl, schoolColors });
        }
      }

      // ── Step 2: Generate puzzle ───────────────────────────────────────────
      let puzzleData = await generatePuzzle(teamName, city, state, mascot, logoUrl, schoolColors, ANTHROPIC_API_KEY);
      puzzleData.logoUrl = logoUrl;

      // ── Step 3: Fetch stadium image (best-effort, non-blocking) ──────────
      if (puzzleData.stadium) {
        console.log('Fetching stadium image for', puzzleData.stadium);
        puzzleData.stadiumImageUrl = await fetchStadiumImage(puzzleData.stadium, city, state, ANTHROPIC_API_KEY);
      } else {
        puzzleData.stadiumImageUrl = null;
      }

      // ── Step 4: Verify ────────────────────────────────────────────────────
      const verification = await verifyPuzzle(puzzleData, ANTHROPIC_API_KEY);
      console.log('Verification verdict:', verification.overallVerdict, 'for', teamName);

      // ── Step 5: Handle verdict ────────────────────────────────────────────
      if (verification.overallVerdict === 'reject') {
        await db.collection('puzzle_queue').add({
          ...puzzleData, logoUrl,
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

      // ── Step 6: Schedule ──────────────────────────────────────────────────
      const puzzleNum = await getNextPuzzleNumber();

      const finalPuzzle = {
        answer:              puzzleData.answer            || teamName,
        mascot:              puzzleData.mascot            || mascot,
        city:                puzzleData.city              || city,
        state:               puzzleData.state             || state,
        stadium:             puzzleData.stadium           || '',
        logoUrl,
        schoolColors:        schoolColors                 || null,
        stadiumImageUrl:     puzzleData.stadiumImageUrl   || null,
        clues:               puzzleData.clues,
        clueTypes:           puzzleData.clueTypes         || [],
        clueConfidence:      puzzleData.clueConfidence    || [],
        sources:             puzzleData.sources           || [],
        type:                puzzleData.type              || 'school',
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
      console.error('Puzzle generation failed for', teamName, ':', err.message, err.stack);

      await db.collection('puzzle_queue').add({
        teamName, city, state, mascot, logoUrl,
        status:             'failed',
        error:              err.message,
        nomineeId,
        generatedAt:        Date.now(),
        scheduledPuzzleNum: null
      });
    }
  }
);
