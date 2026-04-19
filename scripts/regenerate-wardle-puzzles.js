#!/usr/bin/env node
/**
 * Regenerate Wardle puzzles starting at #38, preserving #1-37 untouched.
 *
 * Pulls every school from totw_nominees + totw_winners, dedups, removes any
 * already used in puzzles #1-37, shuffles for random order, and generates
 * fresh puzzle docs (5 progressive clues + colors + stadium + alumni)
 * via Claude with web search for accuracy.
 *
 * Hint fields the live game consumes:
 *   answer, mascot, city, state, stadium, colors, famousAlumni, clues[5]
 * Tier 1 hints (location/mascot/letter/vowels) come straight from
 * totw data + algorithmic; Tier 2 (colors/stadium/famousAlumni) come from
 * Claude w/ web search. Missing fields are stored as "" so the in-game
 * unlock buttons grey out gracefully (no points lost).
 *
 * Usage:
 *   node scripts/regenerate-wardle-puzzles.js                    # dry run summary
 *   node scripts/regenerate-wardle-puzzles.js --live             # actually write to Firestore
 *   node scripts/regenerate-wardle-puzzles.js --live --max=10    # cap to 10 puzzles for testing
 *   node scripts/regenerate-wardle-puzzles.js --live --start=50  # start writing at id 50 instead of 38
 *
 * Env: ANTHROPIC_API_KEY (loaded from .env.local automatically)
 */

const fs = require('fs');
const path = require('path');

// ── CONFIG ───────────────────────────────────────────────────────────────────
const PROJECT_ID    = 'th-and-ward-b8f1c';
const PRESERVE_THRU = 37;       // puzzles 1..37 are untouched
const DEFAULT_START = 38;       // first id to write to
const MODEL         = 'claude-haiku-4-5';
const REQUEST_DELAY_MS = 6000;  // throttle between Claude calls
const PROGRESS_FILE = path.join(__dirname, '.wardle-regen-progress.json');

// ── ENV LOAD (.env.local) ────────────────────────────────────────────────────
function loadEnv() {
  for (const fname of ['.env.local', '.env']) {
    const p = path.join(__dirname, '..', fname);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
      if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
    }
  }
}
loadEnv();

// ── ARGS ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const LIVE   = args.includes('--live');
const MAX    = (() => { const a = args.find(a => a.startsWith('--max=')); return a ? parseInt(a.split('=')[1]) : Infinity; })();
const START  = (() => { const a = args.find(a => a.startsWith('--start=')); return a ? parseInt(a.split('=')[1]) : DEFAULT_START; })();
if (START <= PRESERVE_THRU) {
  console.error(`Refusing to write at id ${START}: must be > ${PRESERVE_THRU} to preserve live puzzles.`);
  process.exit(1);
}

// ── FIRESTORE REST ───────────────────────────────────────────────────────────
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

function unwrapValue(v) {
  if (!v) return null;
  if ('stringValue' in v)    return v.stringValue;
  if ('integerValue' in v)   return parseInt(v.integerValue, 10);
  if ('doubleValue' in v)    return v.doubleValue;
  if ('booleanValue' in v)   return v.booleanValue;
  if ('nullValue' in v)      return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v)     return (v.arrayValue.values || []).map(unwrapValue);
  if ('mapValue' in v)       return unwrap(v.mapValue.fields || {});
  return null;
}
function unwrap(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) out[k] = unwrapValue(v);
  return out;
}
function wrapValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string')  return { stringValue: v };
  if (typeof v === 'number')  return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (Array.isArray(v))       return { arrayValue: { values: v.map(wrapValue) } };
  if (typeof v === 'object')  return { mapValue: { fields: wrap(v) } };
  return { nullValue: null };
}
function wrap(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = wrapValue(v);
  return out;
}
async function fsList(collection, pageSize = 300) {
  const results = [];
  let pageToken = '';
  do {
    const url = `${FS_BASE}/${collection}?pageSize=${pageSize}` + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fsList ${collection} failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    for (const d of (data.documents || [])) {
      results.push({ id: d.name.split('/').pop(), ...unwrap(d.fields || {}) });
    }
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return results;
}
async function fsGet(collection, id) {
  const res = await fetch(`${FS_BASE}/${collection}/${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`fsGet ${collection}/${id} failed: ${res.status}`);
  const data = await res.json();
  return data.fields ? unwrap(data.fields) : null;
}
async function fsSet(collection, id, doc) {
  const res = await fetch(`${FS_BASE}/${collection}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: wrap(doc) })
  });
  if (!res.ok) throw new Error(`fsSet ${collection}/${id} failed: ${res.status} ${await res.text()}`);
}

// ── HELPERS ──────────────────────────────────────────────────────────────────
function normalizeSchool(name) {
  return String(name || '').toLowerCase()
    .replace(/\bsenior high school\b/g, '').replace(/\bhigh school\b/g, '')
    .replace(/\bsenior high\b/g, '').replace(/\bhigh\b/g, '').replace(/\bschool\b/g, '')
    .replace(/\bhs\b/g, '').replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function loadProgress() {
  if (!fs.existsSync(PROGRESS_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8')); } catch { return {}; }
}
function saveProgress(progress) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

// ── CLAUDE PUZZLE GENERATION ─────────────────────────────────────────────────
async function generatePuzzle(client, school) {
  const prompt = `Generate a puzzle for "4th & Wardle", a daily guessing game where players guess a high school football program from 5 progressive clues (hardest first, easiest last).

SCHOOL: ${school.name} in ${school.city}, ${school.state}
MASCOT: ${school.mascot || '(unknown)'}

Use web search to verify facts. Search for things like:
- "${school.name} football history"
- "${school.name} ${school.city} ${school.state}"
- "${school.name} famous alumni NFL"
- "${school.name} stadium colors traditions"

Return ONLY valid JSON (no markdown, no prose), with these fields:
{
  "answer":       "${school.name}",
  "mascot":       "mascot name (verify or correct)",
  "city":         "${school.city}",
  "state":        "${school.state}",
  "stadium":      "stadium name (or empty string if not found)",
  "colors":       "school colors like 'Red and Gold' (or empty string if not found)",
  "famousAlumni": "one notable alum's name (or empty string if not found)",
  "clues":        ["clue1", "clue2", "clue3", "clue4", "clue5"]
}

Clue ladder (hardest → easiest):
1. SURPRISING fact: famous alum, unique tradition, or wild record. NEVER mention state, mascot, or colors. Must teach something interesting.
2. HISTORIC fact: championship, record, distinctive tradition. Vague region OK, no state/mascot.
3. REGIONAL: may include state OR general region + one more interesting fact.
4. IDENTIFIERS: include mascot OR colors OR stadium wrapped in a real fact (not just "Home of the X").
5. NEAR GIVEAWAY: include city AND state plus one identifying detail.

Rules:
- Each clue must teach something specific (numbers, names, years, records). No filler.
- If you can't verify a fact, say something safe and true rather than inventing.
- For stadium/colors/famousAlumni: leave as empty string if not confident — the game greys those out cleanly.
`;

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    messages: [{ role: 'user', content: prompt }]
  });

  const textBlocks = (res.content || []).filter(b => b.type === 'text');
  const raw = textBlocks.map(b => b.text).join('\n').trim();
  if (!raw) throw new Error('No text in Claude response');

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in Claude response');
  const data = JSON.parse(jsonMatch[0]);

  if (!Array.isArray(data.clues) || data.clues.length !== 5) {
    throw new Error(`Bad clues array (got ${data.clues?.length})`);
  }

  return {
    answer:       String(data.answer || school.name),
    mascot:       String(data.mascot || school.mascot || ''),
    city:         String(data.city || school.city || ''),
    state:        String(data.state || school.state || ''),
    stadium:      String(data.stadium || ''),
    colors:       String(data.colors || ''),
    famousAlumni: String(data.famousAlumni || ''),
    clues:        data.clues.map(c => String(c)),
    approved:     false,           // admin must approve in /admin before it goes live
    autoGenerated: true,
    generatedAt:   Date.now()
  };
}

// ── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Mode: ${LIVE ? 'LIVE (writes to Firestore)' : 'DRY RUN (no writes)'}`);
  console.log(`Will write puzzles starting at id ${START}, preserving 1..${PRESERVE_THRU}.`);
  console.log(`Cap: ${MAX === Infinity ? 'unlimited' : MAX} puzzles per run.\n`);

  if (LIVE && !process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY not found in env or .env.local');
    process.exit(1);
  }

  // Pull schools from TOTW collections
  console.log('Fetching TOTW data...');
  const [nominees, winners] = await Promise.all([fsList('totw_nominees'), fsList('totw_winners')]);
  console.log(`  ${nominees.length} nominees, ${winners.length} past winners`);

  const allSchools = [...nominees, ...winners]
    .map(s => ({
      name:   String(s.teamName || '').trim(),
      mascot: String(s.mascot || '').trim(),
      city:   String(s.city || '').trim(),
      state:  String(s.state || '').trim(),
    }))
    .filter(s => s.name && s.city && s.state);

  // Pull existing puzzles 1..PRESERVE_THRU to exclude their answers
  console.log(`Fetching existing puzzles 1..${PRESERVE_THRU} to exclude already-played schools...`);
  const playedKeys = new Set();
  for (let i = 1; i <= PRESERVE_THRU; i++) {
    const p = await fsGet('puzzles', String(i));
    if (p && p.answer) playedKeys.add(normalizeSchool(p.answer));
  }
  console.log(`  ${playedKeys.size} schools already used in puzzles 1..${PRESERVE_THRU}`);

  // Dedup + filter
  const seen = new Set();
  const pool = [];
  for (const s of allSchools) {
    const key = normalizeSchool(s.name);
    if (!key || seen.has(key) || playedKeys.has(key)) continue;
    seen.add(key);
    pool.push(s);
  }
  shuffle(pool);
  const cappedPool = pool.slice(0, MAX);

  console.log(`\nGeneration pool: ${cappedPool.length} schools`);
  if (cappedPool.length === 0) { console.log('Nothing to do.'); return; }
  console.log('First 5 (after shuffle):');
  cappedPool.slice(0, 5).forEach((s, i) => console.log(`  ${i + 1}. ${s.name} (${s.city}, ${s.state})`));
  console.log(`Last 3:`);
  cappedPool.slice(-3).forEach(s => console.log(`  ${s.name} (${s.city}, ${s.state})`));

  if (!LIVE) {
    console.log('\nDry run complete. Re-run with --live to actually generate + write puzzles.');
    return;
  }

  // Generate
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const progress = loadProgress();

  let nextId = START;
  let written = 0;
  let failed = 0;
  for (const school of cappedPool) {
    const key = normalizeSchool(school.name);
    if (progress[key]) {
      console.log(`[skip] ${school.name} — already done as puzzle ${progress[key]}`);
      continue;
    }
    console.log(`[${nextId}] ${school.name}`);
    try {
      const puzzle = await generatePuzzle(client, school);
      await fsSet('puzzles', String(nextId), puzzle);
      progress[key] = nextId;
      saveProgress(progress);
      console.log(`   ✓ saved (clues: ${puzzle.clues.length}, colors: "${puzzle.colors}", stadium: "${puzzle.stadium}", alumni: "${puzzle.famousAlumni}")`);
      written++;
      nextId++;
    } catch (e) {
      console.error(`   ✗ failed: ${e.message}`);
      failed++;
    }
    await sleep(REQUEST_DELAY_MS);
  }

  console.log(`\nDone. ${written} written (#${START}-${nextId - 1}), ${failed} failed.`);
  if (failed > 0) console.log('Re-run the script to retry failed ones (progress is cached).');
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
