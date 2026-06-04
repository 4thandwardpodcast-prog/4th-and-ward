// Jimmys & Joes — minimal CSV utilities for the coach bulk-upload flow.
// Self-contained: no PapaParse/Papa dependency. Handles quoted fields with
// commas and escaped double-quotes (RFC-4180-lite). UTF-8 BOMs are stripped.

import { POSITIONS, ACCOLADES, classYearOptions } from './jj-config.js';

// ── Column definition for the bulk-upload template ───────────────
// Order matters: this is the order columns appear in the template CSV
// and in the preview table. `key` is what we store on the prospect doc.
export const CSV_COLUMNS = [
  { key: 'fullName',           label: 'Full Name',         required: true,  hint: 'John Doe' },
  { key: 'primaryPosition',    label: 'Position',          required: true,  hint: 'QB / RB / WR / TE / OL / DL / EDGE / LB / CB / S / ATH / K / P / LS' },
  { key: 'secondaryPositions', label: 'Secondary Pos',     required: false, hint: 'Comma-separated, optional (e.g. "ATH, WR")' },
  { key: 'classYear',          label: 'Class',             required: true,  hint: '2026 / 2027 / 2028 / 2029 / JUCO / Transfer' },
  { key: 'schoolName',         label: 'School',            required: true,  hint: 'Allen High School' },
  { key: 'city',               label: 'City',              required: true,  hint: 'Allen' },
  { key: 'state',              label: 'State',             required: true,  hint: 'TX' },
  { key: 'highlightUrl',       label: 'Highlight URL',     required: true,  hint: 'YouTube or Hudl link' },
  { key: 'heightFt',           label: 'Ht (ft)',           required: false, hint: '6' },
  { key: 'heightIn',           label: 'Ht (in)',           required: false, hint: '2' },
  { key: 'weightLbs',          label: 'Weight (lbs)',      required: false, hint: '195' },
  { key: 'fortyElectronic',    label: '40 (electronic)',   required: false, hint: '4.58' },
  { key: 'fortyHand',          label: '40 (hand)',         required: false, hint: '4.62' },
  { key: 'vertical',           label: 'Vert (in)',         required: false, hint: '32' },
  { key: 'broad',              label: 'Broad (in)',        required: false, hint: '116' },
  { key: 'threeCone',          label: '3-Cone (s)',        required: false, hint: '7.10' },
  { key: 'shuttle',            label: 'Shuttle (s)',       required: false, hint: '4.35' },
  { key: 'bench225',           label: 'Bench@225 (reps)',  required: false, hint: '12' },
  { key: 'bench1rm',           label: 'Bench 1RM',         required: false, hint: '305' },
  { key: 'squat1rm',           label: 'Squat 1RM',         required: false, hint: '465' },
  { key: 'powerClean1rm',      label: 'Clean 1RM',         required: false, hint: '285' },
  { key: 'accolades',          label: 'Accolades',         required: false, hint: 'Comma-separated IDs from the accolade list (see README cell)' },
  { key: 'offers',             label: 'Offers',            required: false, hint: 'Comma-separated school names' },
  { key: 'shortBio',           label: 'Short Bio (≤500)',  required: false, hint: 'Anything else fans should know?' },
  { key: 'coachName',          label: 'Coach Name',        required: false, hint: 'Public if "Coach Public?" = yes' },
  { key: 'coachEmail',         label: 'Coach Email',       required: false, hint: '' },
  { key: 'coachPhone',         label: 'Coach Phone',       required: false, hint: '' },
  { key: 'coachPublic',        label: 'Coach Public?',     required: false, hint: 'yes / no (default no)' },
];

// ── Template CSV (returned as a Blob the page offers as a download) ──
export function buildTemplateCsvBlob() {
  const headerRow = CSV_COLUMNS.map(c => csvEscape(c.label)).join(',');
  const hintRow   = CSV_COLUMNS.map(c => csvEscape(c.hint || '')).join(',');
  const exampleRow = CSV_COLUMNS.map(c => csvEscape(exampleValueFor(c.key))).join(',');

  // Pre-amble: legal-style block of comment lines explaining accolade IDs.
  const accNotes = [
    '# 4th & Ward — Jimmys & Joes — Bulk Upload Template',
    '# Delete lines starting with "#" and the example row before uploading.',
    '# Valid positions: ' + POSITIONS.map(p => p.code).join(', '),
    '# Valid class years: ' + classYearOptions().join(', '),
    '# Valid accolade IDs (use these in the Accolades column, comma-separated):',
  ];
  ACCOLADES.forEach(a => { accNotes.push(`#   ${a.id} = ${a.label} (${a.points} pts)`); });

  const csv = [
    ...accNotes,
    '',
    headerRow,
    hintRow,
    exampleRow,
  ].join('\n');

  return new Blob([csv], { type: 'text/csv;charset=utf-8' });
}

function exampleValueFor(key) {
  const ex = {
    fullName: 'John Doe',
    primaryPosition: 'QB',
    secondaryPositions: '',
    classYear: '2027',
    schoolName: 'Allen High School',
    city: 'Allen',
    state: 'TX',
    highlightUrl: 'https://www.hudl.com/video/3/1234567/abcdef',
    heightFt: '6', heightIn: '2', weightLbs: '195',
    fortyElectronic: '4.58', fortyHand: '', vertical: '32',
    broad: '116', threeCone: '7.10', shuttle: '4.35',
    bench225: '12', bench1rm: '305', squat1rm: '465', powerClean1rm: '285',
    accolades: 'dist-mvp, all-dist-1st',
    offers: 'Texas Tech, Houston, Tulsa',
    shortBio: 'Three-year starter, district MVP as a junior.',
    coachName: 'Coach Smith', coachEmail: 'smith@allenisd.org', coachPhone: '', coachPublic: 'no',
  };
  return ex[key] ?? '';
}

// ── CSV parser (RFC-4180-lite) ──────────────────────────────────
// Returns { headers: [...], rows: [{header:val, ...}, ...] }.
// `commentChar` lines (default '#') are dropped — used by the template.
export function parseCsv(text, { commentChar = '#' } = {}) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);   // strip BOM
  const records = tokenize(text);
  // Drop comment-only lines and empty lines.
  const filtered = records.filter(r => {
    if (!r.length) return false;
    if (r.length === 1 && r[0].trim() === '') return false;
    const first = (r[0] ?? '').trim();
    if (commentChar && first.startsWith(commentChar)) return false;
    return true;
  });
  if (!filtered.length) return { headers: [], rows: [] };

  const headers = filtered[0].map(h => h.trim());
  const rows = filtered.slice(1)
    // Drop the "hint" row our template includes (heuristic: all required
    // fields look like instructional text, not data).
    .filter(r => !looksLikeHintRow(r, headers))
    .map(r => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = (r[i] ?? '').trim(); });
      return obj;
    });
  return { headers, rows };
}

function looksLikeHintRow(row, headers) {
  // If 4+ cells contain a slash, an em-dash, or parens-with-units, treat as hint.
  let hintish = 0;
  for (let i = 0; i < Math.min(row.length, headers.length); i++) {
    const v = (row[i] || '').toLowerCase();
    if (!v) continue;
    if (v.includes('/') || v.includes('—') || v.includes('e.g.') || /\(.+\)/.test(v)) hintish++;
  }
  return hintish >= 4;
}

function tokenize(text) {
  const records = [];
  let field = '';
  let row = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(field); field = '';
      } else if (c === '\r') {
        // ignore — handle on \n
      } else if (c === '\n') {
        row.push(field); records.push(row);
        field = ''; row = [];
      } else {
        field += c;
      }
    }
  }
  // last field / row
  if (field.length || row.length) {
    row.push(field);
    records.push(row);
  }
  return records;
}

function csvEscape(v) {
  const s = String(v ?? '');
  if (s === '') return '';
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}
