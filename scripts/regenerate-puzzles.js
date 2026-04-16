#!/usr/bin/env node
/**
 * Puzzle Regeneration Script for 4th & Wardle V2
 *
 * Reads deduped school data, generates trivia-style clues via Claude API with web search,
 * verifies them, and outputs a JSON file ready for Firestore upload.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... node scripts/regenerate-puzzles.js
 *   ANTHROPIC_API_KEY=sk-... node scripts/regenerate-puzzles.js --upload  (also writes to Firestore)
 *   ANTHROPIC_API_KEY=sk-... node scripts/regenerate-puzzles.js --start=50 --end=100  (range)
 */

const fs = require('fs');
const path = require('path');

const INPUT  = path.join(__dirname, 'puzzles-deduped.json');
const OUTPUT = path.join(__dirname, 'puzzles-v2-generated.json');
const MODEL  = 'claude-sonnet-4-5';
const DELAY  = 12000; // 12s between schools (~5/min)

async function main() {
  const Anthropic = require('@anthropic-ai/sdk');
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { console.error('Set ANTHROPIC_API_KEY env var'); process.exit(1); }

  const client = new Anthropic({ apiKey });
  const schools = JSON.parse(fs.readFileSync(INPUT, 'utf8'));

  const args = process.argv.slice(2);
  const doUpload = args.includes('--upload');
  const startArg = args.find(a => a.startsWith('--start='));
  const endArg   = args.find(a => a.startsWith('--end='));
  const startIdx = startArg ? parseInt(startArg.split('=')[1]) - 1 : 0;
  const endIdx   = endArg   ? parseInt(endArg.split('=')[1])       : schools.length;

  // Load existing progress if any
  let results = [];
  if (fs.existsSync(OUTPUT)) {
    results = JSON.parse(fs.readFileSync(OUTPUT, 'utf8'));
    console.log(`Loaded ${results.length} existing results`);
  }

  const existingIds = new Set(results.map(r => r.id));
  const subset = schools.slice(startIdx, endIdx).filter(s => !existingIds.has(s.id));
  console.log(`Processing ${subset.length} schools (${startIdx + 1} to ${endIdx}), skipping ${schools.slice(startIdx, endIdx).length - subset.length} already done`);

  for (let i = 0; i < subset.length; i++) {
    const school = subset[i];
    console.log(`[${i + 1}/${subset.length}] Generating clues for: ${school.answer}`);

    try {
      const puzzle = await generatePuzzle(client, school);
      results.push(puzzle);

      // Save progress after each school
      fs.writeFileSync(OUTPUT, JSON.stringify(results, null, 2));
      console.log(`  ✓ Done (${results.length} total saved)`);

      if (i < subset.length - 1) {
        await sleep(DELAY);
      }
    } catch (err) {
      console.error(`  ✗ Failed: ${err.message}`);
      // Save a placeholder so we can retry later
      results.push({
        id: school.id,
        answer: school.answer,
        mascot: school.mascot,
        city: school.city,
        state: school.state,
        stadium: school.stadium,
        status: 'failed',
        error: err.message,
        clues: school.clues // keep old clues as fallback
      });
      fs.writeFileSync(OUTPUT, JSON.stringify(results, null, 2));
    }
  }

  console.log(`\nDone! ${results.length} puzzles saved to ${OUTPUT}`);
  const failed = results.filter(r => r.status === 'failed').length;
  if (failed > 0) console.log(`  ${failed} failed — rerun to retry`);

  if (doUpload) {
    await uploadToFirestore(results.filter(r => r.status !== 'failed'));
  }
}

async function generatePuzzle(client, school) {
  const prompt = `You are generating a puzzle for "4th & Wardle V2", a daily guessing game about high school football programs. Players guess the school name from 5 clues revealed one at a time, hardest first.

SCHOOL: ${school.answer} in ${school.city}, ${school.state}
MASCOT: ${school.mascot}
STADIUM: ${school.stadium || 'unknown'}

STEP 1 — Research using web search. Search for:
- "${school.answer} football history"
- "${school.answer} famous alumni NFL"
- "${school.answer} traditions championships"
- "${school.answer} ${school.city} ${school.state}"

STEP 2 — Generate exactly 5 TRIVIA-STYLE clues, each teaching something interesting:

CLUE 1 (HARDEST — obscure):
- Must be a specific, surprising fact: famous alumni, unique record, wild tradition
- NEVER mention the state, mascot, or school colors
- Example: "Kyler Murray threw for 4,700 yards here before winning the Heisman at Oklahoma"

CLUE 2 (HARD — historic):
- A historic fact, championship detail, or unique tradition
- Can mention a region vaguely but not the state directly
- Example: "This program won 57 consecutive games from 2012-2016, a state 6A record"

CLUE 3 (MEDIUM — regional + fun fact):
- May include the state OR general region + one more interesting fact
- Example: "This North Texas school built a $60 million stadium that rivals small college venues"

CLUE 4 (EASIER — identifiers):
- Include mascot name OR school colors OR stadium name wrapped in a fact
- Example: "The Eagles play at a stadium that seats 18,000 in Collin County"

CLUE 5 (NEAR GIVEAWAY — city + state):
- Include the city AND state plus a direct identifying detail
- Example: "Located in Allen, Texas — one of the largest high school programs in the state"

RULES:
- Every clue must teach something interesting — NO filler like "consistent performer" or "known for tough schedules"
- Use specific numbers, names, years, records when possible
- No clue should just be "Home of the [Mascot]" — wrap mascot mentions in real facts
- Write for casual fans (think Friday Night Lights vibes), not scouts
- Each clue must stand alone and be engaging to read

Also provide:
- School colors (e.g. "Red and White")
- A famous alumni name if found (e.g. "Patrick Mahomes")
- The stadium name

Return ONLY valid JSON, NO markdown, NO backticks:
{
  "answer": "full school name with High School",
  "mascot": "mascot name",
  "city": "city",
  "state": "state abbreviation or full name",
  "stadium": "stadium name or empty string",
  "colors": "school colors or empty string",
  "famousAlumni": "notable alumni name or empty string",
  "clues": ["clue1", "clue2", "clue3", "clue4", "clue5"],
  "clueTypes": ["alumni/tradition", "history", "region", "mascot/stadium", "giveaway"],
  "overallConfidence": "high|medium|low"
}`;

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    messages: [{ role: 'user', content: prompt }]
  });

  const textBlocks = (res.content || []).filter(b => b.type === 'text');
  const raw = textBlocks[textBlocks.length - 1]?.text?.trim() || '';
  if (!raw) throw new Error('No text in response');

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON found');
  const data = JSON.parse(jsonMatch[0]);

  return {
    id: school.id,
    answer: data.answer || school.answer,
    mascot: data.mascot || school.mascot,
    city: data.city || school.city,
    state: data.state || school.state,
    stadium: data.stadium || school.stadium || '',
    colors: data.colors || '',
    famousAlumni: data.famousAlumni || '',
    clues: data.clues,
    clueTypes: data.clueTypes || [],
    overallConfidence: data.overallConfidence || 'medium',
    status: 'generated'
  };
}

async function uploadToFirestore(puzzles) {
  console.log('\nUploading to Firestore puzzles_v2 collection...');
  const admin = require('firebase-admin');
  if (!admin.apps.length) {
    admin.initializeApp({ projectId: 'th-and-ward-b8f1c' });
  }
  const db = admin.firestore();

  for (const p of puzzles) {
    const doc = {
      answer: p.answer,
      mascot: p.mascot,
      city: p.city,
      state: p.state,
      stadium: p.stadium,
      colors: p.colors || '',
      famousAlumni: p.famousAlumni || '',
      clues: p.clues,
      clueTypes: p.clueTypes || [],
      type: 'school',
      autoGenerated: true,
      generatedAt: Date.now()
    };
    await db.collection('puzzles_v2').doc(String(p.id)).set(doc);
    console.log(`  Uploaded puzzle #${p.id}: ${p.answer}`);
  }
  console.log(`\n✓ Uploaded ${puzzles.length} puzzles to puzzles_v2`);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
