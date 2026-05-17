#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/validate.js — Post-generation validator for ClaudeJob bundles.
//
// CLI:        node scripts/validate.js <application_folder>
// Programmatic:
//   const { validate } = require('./scripts/validate');
//   const { ok, checks } = await validate('/path/to/<App>_<Title>_<ts>');
//
// Runs 12 deterministic checks against a generated bundle:
//   File integrity (4):  resume_size_min, cover_size_min,
//                        resume_parseable, cover_parseable
//   Identity drift (2):  linkedin_correct, github_correct
//   Resume structure (2): resume_sections, resume_bullets   (bullets = warn-only)
//   Cover structure (2):  cover_salutation, cover_signoff
//   JD relevance (2):    cover_mentions_company, cover_hits_themes
//
// Exit codes:
//   0  — all hard checks passed (warn-only checks may still flag)
//   1  — at least one hard check failed (caller should NOT submit)
//   2  — invalid invocation (missing folder, required file absent, internal error)
//
// Wired into the pipeline from routes/ai.js immediately after the save step;
// see saveResult handling there. Surfaces failures over SSE so the UI can
// block the user before they submit the wrong artifact.
// ─────────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
// pdf-parse v2 exports a PDFParse class; v1's bare-function default was
// removed. We always use the class to keep the import shape stable across
// minor bumps. getHyperlinks() in v2 currently errors on Buffer input, so
// link annotations are still pulled via raw-byte scan (extractLinkUris) —
// that path is independent of the upstream API churn.
const { PDFParse } = require('pdf-parse');

const { LINKEDIN_URL, GITHUB_URL } = require('../constants/identity');

const RESUME_FILE = 'Sahil_Mehta_Resume.pdf';
const COVER_FILE  = 'Sahil_Mehta_CoverLetter.pdf';
const JD_FILE     = 'JD_Analysis.json';

const MIN_RESUME_BYTES = 5000;
const MIN_COVER_BYTES  = 2000;

const REQUIRED_RESUME_SECTIONS = [
  'EDUCATION',
  'PROFESSIONAL EXPERIENCE',
  'PROJECTS',
  'TECHNICAL SKILLS',
];

// Bullet glyph used by routes/pdfRender.js (Unicode U+2022). pdf-parse preserves
// it in extracted text, so counting occurrences per role chunk gives the bullet
// count without needing layout info.
const BULLET_GLYPH = '•';

// ─────────────────────────────────────────────────────────────────────────────
// PDF link annotation extraction.
//
// pdf-parse returns rendered text only — it discards /URI annotations, which
// is where pdfkit's doc.link() entries live. To verify the resume/cover
// actually links to the CORRECT LinkedIn and GitHub URLs (not a typo or stale
// slug), scan the raw PDF bytes for `/URI (...)` literal entries. pdfkit
// always emits URIs as ASCII literals, so a latin1 string scan is sufficient.
//
// Caveats:
//   - This only catches link annotations, not visible text. A resume that
//     prints "linkedin.com/in/wrong" as plain text but never adds a link
//     would pass this check. Acceptable — drift in clickable links is the
//     specific failure mode this catches.
//   - URIs with escaped parens or unbalanced brackets would need a smarter
//     parser. Our renderer never produces those.
// ─────────────────────────────────────────────────────────────────────────────
function extractLinkUris(pdfBuffer) {
  const raw = pdfBuffer.toString('latin1');
  const uris = [];
  const re = /\/URI\s*\(([^)]+)\)/g;
  let m;
  while ((m = re.exec(raw)) !== null) uris.push(m[1]);
  return uris;
}

function makeCheck(name, passed, reason, opts = {}) {
  return { name, passed, reason, severity: opts.severity || 'fail' };
}

async function readPdf(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.length === 0) {
    return { text: '', uris: [], bytes: 0, parseError: 'empty file (0 bytes)' };
  }
  let parser;
  try {
    parser = new PDFParse({ data: buf });
    const parsed = await parser.getText();
    return {
      text: parsed.text || '',
      uris: extractLinkUris(buf),
      bytes: buf.length,
      parseError: null,
    };
  } catch (e) {
    return { text: '', uris: [], bytes: buf.length, parseError: e.message };
  } finally {
    // PDFParse holds an internal pdfjs document handle; destroy() releases it
    // so we don't leak workers across many sequential validations.
    try { parser && parser.destroy && parser.destroy(); } catch (_) {}
  }
}

// Derive a company name when JD_Analysis.json doesn't carry one (older bundles
// generated before the company-in-JD change). Folder format is
// `${slug(company)}_${slug(title)}_${timestamp}` per routes/saveBundle.js; the
// slug replaces non-alphanumerics with '-', so we deslug by swapping '-' for
// a space. This loses the original casing of multi-word names ("Cook Unity" vs
// "CookUnity") — that's exactly the drift the user is trying to catch, so the
// fallback is intentionally lossy and the reason string flags the source.
function deslugCompanyFromFolder(folder) {
  const base = path.basename(folder);
  const i = base.indexOf('_');
  if (i < 0) return null;
  return base.slice(0, i).replace(/-/g, ' ');
}

// Carve out the PROFESSIONAL EXPERIENCE block from the extracted text, split
// it into role chunks by date-range header detection, and count bullets per
// chunk. Returns a check result. Warn-only: an out-of-range count flags
// visually but does NOT fail the verdict, since 0..8 is a rough heuristic.
function checkBulletCounts(resumeText) {
  const expIdx = resumeText.indexOf('PROFESSIONAL EXPERIENCE');
  if (expIdx < 0) {
    return makeCheck('resume_bullets', false,
      'PROFESSIONAL EXPERIENCE section not found in extracted text');
  }
  const after = resumeText.slice(expIdx + 'PROFESSIONAL EXPERIENCE'.length);
  // First subsequent major section header marks the end of the experience block.
  const nextSec = after.match(/\n(PROJECTS|TECHNICAL SKILLS|EDUCATION|CERTIFICATIONS|AWARDS|PUBLICATIONS)\b/);
  const block = nextSec ? after.slice(0, nextSec.index) : after;

  // Role boundaries: each job header has an italic right-aligned date range
  // like "June 2025 - present" or "Jan 2025 - May 2025". A date-range regex
  // is a more reliable boundary than trying to detect bolded titles.
  const dateRange = /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\b[^\n]{0,30}(?:-|–|—|to)[^\n]{0,40}(?:present|\d{4})/gi;

  const boundaries = [];
  let m;
  while ((m = dateRange.exec(block)) !== null) boundaries.push(m.index);

  if (boundaries.length === 0) {
    return makeCheck('resume_bullets', false,
      'no role-header date ranges found under PROFESSIONAL EXPERIENCE — cannot split',
      { severity: 'warn' });
  }

  const counts = [];
  for (let i = 0; i < boundaries.length; i++) {
    const start = boundaries[i];
    const end = i + 1 < boundaries.length ? boundaries[i + 1] : block.length;
    const chunk = block.slice(start, end);
    counts.push((chunk.match(new RegExp(BULLET_GLYPH, 'g')) || []).length);
  }
  const outOfRange = counts.filter(c => c < 1 || c > 8);
  if (outOfRange.length === 0) {
    return makeCheck('resume_bullets', true,
      `bullets per role: [${counts.join(', ')}] (all within 1..8)`);
  }
  return makeCheck('resume_bullets', false,
    `WARN: bullets per role [${counts.join(', ')}] — ${outOfRange.length} role(s) outside 1..8`,
    { severity: 'warn' });
}

// ─────────────────────────────────────────────────────────────────────────────
// runChecks — read the bundle, run all 12 checks, return structured results.
// Throws only on invalid invocation (missing required file). Each check
// individually swallows its own errors and reports passed=false.
// ─────────────────────────────────────────────────────────────────────────────
async function runChecks(folder) {
  const resumePath = path.join(folder, RESUME_FILE);
  const coverPath  = path.join(folder, COVER_FILE);
  const jdPath     = path.join(folder, JD_FILE);

  for (const [label, p] of [['resume', resumePath], ['cover', coverPath], ['JD', jdPath]]) {
    if (!fs.existsSync(p)) {
      const err = new Error(`missing required ${label} file: ${path.basename(p)}`);
      err.code = 'MISSING_FILE';
      throw err;
    }
  }

  const resumeStat = fs.statSync(resumePath);
  const coverStat  = fs.statSync(coverPath);

  let jd = {};
  try {
    jd = JSON.parse(fs.readFileSync(jdPath, 'utf8'));
  } catch (e) {
    // A malformed JD JSON shouldn't crash the whole run — surface as a check
    // failure on the JD-dependent assertions further down.
    jd = { _parseError: e.message };
  }

  const [resumeRead, coverRead] = await Promise.all([
    readPdf(resumePath),
    readPdf(coverPath),
  ]);
  const coverText = coverRead.text || '';

  const themes = Array.isArray(jd.key_themes) ? jd.key_themes : [];

  const companyFromJd = typeof jd.company === 'string' && jd.company.trim()
    ? jd.company.trim()
    : null;
  const companyFromFolder = deslugCompanyFromFolder(folder);
  const company = companyFromJd || companyFromFolder || '';
  const companySource = companyFromJd ? 'JD_Analysis.company' : 'deslugged folder name';

  // Cover-letter salutation: matches "Dear <Name>" or "Hello <Name>" at the
  // start of any line. Captures the JD-provided team name when no recruiter
  // is known (e.g., "Dear Ruby AI team,"). The first matching line is echoed
  // back in the reason string for quick visual scan.
  const salutationMatch = coverText.match(/^(?:Dear|Hello)\s+[A-Z][^\n]*/m);

  // Cover-letter signoff: one of (Best|Sincerely|Regards|Thanks) followed by
  // comma, newline(s), and "Sahil". The newlines may include indentation, so
  // \s+ tolerates that.
  const signoffRe = /(?:Best|Sincerely|Regards|Thanks),\s*\n+\s*Sahil/;
  const signoffOk = signoffRe.test(coverText);

  const checks = [
    // ── File integrity ────────────────────────────────────────────────────
    makeCheck('resume_size_min',
      resumeStat.size >= MIN_RESUME_BYTES,
      `resume = ${resumeStat.size} bytes (min ${MIN_RESUME_BYTES})`),
    makeCheck('cover_size_min',
      coverStat.size >= MIN_COVER_BYTES,
      `cover  = ${coverStat.size} bytes (min ${MIN_COVER_BYTES})`),
    makeCheck('resume_parseable',
      !resumeRead.parseError && resumeRead.text.trim().length > 0,
      resumeRead.parseError
        ? `pdf-parse: ${resumeRead.parseError}`
        : `extracted ${resumeRead.text.length} chars`),
    makeCheck('cover_parseable',
      !coverRead.parseError && coverRead.text.trim().length > 0,
      coverRead.parseError
        ? `pdf-parse: ${coverRead.parseError}`
        : `extracted ${coverRead.text.length} chars`),

    // ── Identity drift ────────────────────────────────────────────────────
    (() => {
      const r = resumeRead.uris.includes(LINKEDIN_URL);
      const c = coverRead.uris.includes(LINKEDIN_URL);
      return makeCheck('linkedin_correct', r && c,
        `resume ${r ? 'OK' : 'MISS'} / cover ${c ? 'OK' : 'MISS'} for ${LINKEDIN_URL}`);
    })(),
    (() => {
      const r = resumeRead.uris.includes(GITHUB_URL);
      const c = coverRead.uris.includes(GITHUB_URL);
      return makeCheck('github_correct', r && c,
        `resume ${r ? 'OK' : 'MISS'} / cover ${c ? 'OK' : 'MISS'} for ${GITHUB_URL}`);
    })(),

    // ── Resume structure ──────────────────────────────────────────────────
    (() => {
      const missing = REQUIRED_RESUME_SECTIONS.filter(s => !resumeRead.text.includes(s));
      return makeCheck('resume_sections', missing.length === 0,
        missing.length === 0
          ? `all present: ${REQUIRED_RESUME_SECTIONS.join(', ')}`
          : `missing: ${missing.join(', ')}`);
    })(),
    checkBulletCounts(resumeRead.text),

    // ── Cover letter structure ────────────────────────────────────────────
    makeCheck('cover_salutation',
      !!salutationMatch,
      salutationMatch
        ? `first line: "${salutationMatch[0].trim()}"`
        : 'no /^(Dear|Hello)\\s+[A-Z]/m match'),
    makeCheck('cover_signoff',
      signoffOk,
      signoffOk
        ? 'signoff block present'
        : 'no "(Best|Sincerely|Regards|Thanks),\\n+Sahil" block'),

    // ── JD relevance ──────────────────────────────────────────────────────
    (() => {
      if (!company) {
        return makeCheck('cover_mentions_company', false,
          'company name not derivable (no JD_Analysis.company and no folder prefix)');
      }
      const hit = coverText.includes(company);
      return makeCheck('cover_mentions_company', hit,
        `looking for exact "${company}" (source: ${companySource}) — ${hit ? 'found' : 'NOT FOUND'}`);
    })(),
    (() => {
      if (themes.length === 0) {
        return makeCheck('cover_hits_themes', false,
          'JD_Analysis.key_themes is missing or empty');
      }
      const lower = coverText.toLowerCase();
      const hits = themes.filter(t => lower.includes(String(t).toLowerCase()));
      return makeCheck('cover_hits_themes', hits.length >= 3,
        `${hits.length}/${themes.length} themes hit: [${hits.join(', ')}]`);
    })(),
  ];

  return { folder, checks, meta: { company, companySource, themes } };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pretty-print: 12-row table + verdict line. Returns true if all hard checks
// passed (warn-only failures don't block).
// ─────────────────────────────────────────────────────────────────────────────
function symbolFor(c) {
  if (c.passed) return '✓'; // ✓
  if (c.severity === 'warn') return '⚠'; // ⚠
  return '✗'; // ✗
}

function prettyPrint(result) {
  const { folder, checks } = result;
  const nameW = Math.max(...checks.map(c => c.name.length));
  console.log(`\nValidating: ${folder}`);
  console.log('-'.repeat(80));
  for (const c of checks) {
    console.log(`  ${symbolFor(c)}  ${c.name.padEnd(nameW)}  ${c.reason}`);
  }

  const passed = checks.filter(c => c.passed).length;
  const warns  = checks.filter(c => !c.passed && c.severity === 'warn').length;
  const hardFails = checks.filter(c => !c.passed && c.severity !== 'warn').length;
  const verdict = hardFails === 0 ? 'SUBMIT' : 'DO NOT SUBMIT';

  console.log('-'.repeat(80));
  console.log(
    `VERDICT: ${passed}/${checks.length} passed` +
    (warns ? `, ${warns} warn` : '') +
    `. ${verdict}\n`
  );
  return hardFails === 0;
}

async function validate(folder) {
  const result = await runChecks(folder);
  const ok = prettyPrint(result);
  return { ok, checks: result.checks, folder, meta: result.meta };
}

if (require.main === module) {
  const folder = process.argv[2];
  if (!folder) {
    console.error('Usage: node scripts/validate.js <application_folder>');
    process.exit(2);
  }
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
    console.error(`Folder not found or not a directory: ${folder}`);
    process.exit(2);
  }
  validate(folder)
    .then(({ ok }) => process.exit(ok ? 0 : 1))
    .catch(e => {
      console.error('Validator error:', e.message);
      process.exit(2);
    });
}

module.exports = { validate, runChecks, extractLinkUris, deslugCompanyFromFolder };
