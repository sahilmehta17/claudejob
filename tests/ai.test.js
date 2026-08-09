/**
 * tests/ai.test.js — Core unit tests for resume validation, diff, and JSON parsing
 *
 * Run: npm test
 */

const assert = require('assert');
const {
  validateResumeOutput,
  generateResumeDiff,
  safeParseJSON,
  BANNED_RESUME_PHRASES,
  RESUME_BASE,
} = require('../routes/ai');

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    failures.push({ name, error: e.message });
    console.log(`  ✗ ${name}`);
    console.log(`    ${e.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// safeParseJSON
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nsafeParseJSON:');

test('parses valid JSON', () => {
  const { data, error } = safeParseJSON('{"key": "value"}');
  assert.strictEqual(error, null);
  assert.deepStrictEqual(data, { key: 'value' });
});

test('parses JSON wrapped in markdown fences', () => {
  const { data, error } = safeParseJSON('```json\n{"a": 1}\n```');
  assert.strictEqual(error, null);
  assert.deepStrictEqual(data, { a: 1 });
});

test('parses JSON wrapped in plain fences', () => {
  const { data, error } = safeParseJSON('```\n[1,2,3]\n```');
  assert.strictEqual(error, null);
  assert.deepStrictEqual(data, [1, 2, 3]);
});

test('returns error for invalid JSON', () => {
  const { data, error } = safeParseJSON('not json at all');
  assert.strictEqual(data, null);
  assert.ok(error.includes('JSON parse failed'));
});

// Regression: an LLM judge told "Return ONLY JSON" sometimes still appends an
// explanatory note after the closing fence (observed live from the cover-letter
// incident/inversion judges). The old fence-stripping only removed the ``` ```
// markers themselves and left the trailing prose glued to the JSON, breaking
// JSON.parse — which silently downgraded a real judge verdict to the "parse
// failed" PASS fallback, i.e. a fabricated claim could slip through undetected.
test('parses fenced JSON even with explanatory prose after the closing fence', () => {
  const raw = '```json\n{"verdict": "PASS", "reason": ""}\n```\n\nAll claims trace cleanly to CANDIDATE FACTS, so this passes.';
  const { data, error } = safeParseJSON(raw);
  assert.strictEqual(error, null, 'trailing prose after the fence must not break parsing: ' + error);
  assert.deepStrictEqual(data, { verdict: 'PASS', reason: '' });
});

test('returns error for null input', () => {
  const { data, error } = safeParseJSON(null);
  assert.strictEqual(data, null);
  assert.ok(error.includes('Empty or non-string'));
});

test('returns error for undefined input', () => {
  const { data, error } = safeParseJSON(undefined);
  assert.strictEqual(data, null);
  assert.ok(error.includes('Empty or non-string'));
});

test('returns error for empty string', () => {
  const { data, error } = safeParseJSON('');
  assert.strictEqual(data, null);
  assert.ok(error);
});

test('returns error for number input', () => {
  const { data, error } = safeParseJSON(42);
  assert.strictEqual(data, null);
  assert.ok(error.includes('non-string'));
});

test('truncates raw output in error message', () => {
  const longGarbage = 'x'.repeat(500);
  const { error } = safeParseJSON(longGarbage);
  assert.ok(error.length < 400, 'Error message should be bounded');
});

// ─────────────────────────────────────────────────────────────────────────────
// validateResumeOutput
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nvalidateResumeOutput:');

test('validates the base resume as valid', () => {
  const result = validateResumeOutput(RESUME_BASE);
  assert.strictEqual(result.valid, true, `Expected valid but got warnings: ${result.warnings.join('; ')}`);
  assert.strictEqual(result.bannedFound.length, 0);
});

test('rejects empty input', () => {
  const result = validateResumeOutput('');
  assert.strictEqual(result.valid, false);
  assert.ok(result.warnings.some(w => w.includes('short')));
});

test('rejects null input', () => {
  const result = validateResumeOutput(null);
  assert.strictEqual(result.valid, false);
});

test('rejects very short input', () => {
  const result = validateResumeOutput('Just a few words');
  assert.strictEqual(result.valid, false);
  assert.ok(result.warnings.some(w => w.includes('short')));
});

test('detects banned phrase: leveraged', () => {
  const resume = RESUME_BASE.replace('Shipped a multi-tenant conversational AI assistant', 'Leveraged end-to-end');
  const result = validateResumeOutput(resume);
  assert.ok(result.bannedFound.includes('leveraged'));
  assert.strictEqual(result.valid, false);
});

test('detects banned phrase: spearheaded', () => {
  const resume = RESUME_BASE.replace('Shipped a multi-tenant conversational AI assistant', 'Spearheaded end-to-end');
  const result = validateResumeOutput(resume);
  assert.ok(result.bannedFound.includes('spearheaded'));
});

test('detects multiple banned phrases', () => {
  let resume = RESUME_BASE;
  resume = resume.replace('Shipped a multi-tenant conversational AI assistant', 'Leveraged cutting-edge');
  const result = validateResumeOutput(resume);
  assert.ok(result.bannedFound.length >= 2, `Expected >=2 banned, got: ${result.bannedFound}`);
});

test('warns on missing EDUCATION section', () => {
  const resume = RESUME_BASE.replace('EDUCATION', 'SCHOOLING');
  const result = validateResumeOutput(resume);
  assert.ok(result.warnings.some(w => w.includes('EDUCATION')));
});

test('warns on missing PROFESSIONAL EXPERIENCE section', () => {
  const resume = RESUME_BASE.replace('PROFESSIONAL EXPERIENCE', 'WORK HISTORY');
  const result = validateResumeOutput(resume);
  assert.ok(result.warnings.some(w => w.includes('PROFESSIONAL EXPERIENCE')));
});

test('warns on missing SKILLS section', () => {
  const resume = RESUME_BASE.replace('SKILLS', 'COMPETENCIES');
  const result = validateResumeOutput(resume);
  assert.ok(result.warnings.some(w => w.includes('SKILLS')));
});

test('flags fabricated percentages', () => {
  const resume = RESUME_BASE + '\nImproved throughput by 99%';
  const result = validateResumeOutput(resume);
  assert.ok(result.warnings.some(w => w.includes('not in source')), `Expected fabrication warning, got: ${result.warnings}`);
});

test('preserves validity when source numbers are kept', () => {
  // Base resume already has all source numbers — should be valid
  const result = validateResumeOutput(RESUME_BASE);
  assert.ok(!result.warnings.some(w => w.includes('fabrication')));
});

// Narrative-before-jargon heuristic
const NARRATIVE_BASE = `EDUCATION
University of Wisconsin, Madison
PROFESSIONAL EXPERIENCE
Software Developer, Enidus USA LLC.
SKILLS
Languages: Python, TypeScript, T-Mobile, GSPANN, Orahi, Denari
`;

test('flags bullet that leads with stacked tech jargon', () => {
  const bad = NARRATIVE_BASE + `
• Architected a production NL-to-SQL AI assistant using FastAPI, GPT-4o-mini, Pydantic, and Qdrant for live telecom data.
`;
  const result = validateResumeOutput(bad);
  assert.ok(
    result.warnings.some(w => w.startsWith('Bullet leads with tech jargon')),
    'expected jargon-lead warning, got: ' + result.warnings.join(' | ')
  );
  assert.strictEqual(result.valid, false);
});

test('does NOT flag bullet that leads with user outcome (tech in trailing fragment)', () => {
  const good = NARRATIVE_BASE + `
• Built a production AI assistant for T-Mobile's portal that lets account admins ask plain-English questions about their accounts. FastAPI, GPT-4o-mini, Qdrant.
`;
  const result = validateResumeOutput(good);
  assert.ok(
    !result.warnings.some(w => w.startsWith('Bullet leads with tech jargon')),
    'unexpected jargon-lead warning: ' + result.warnings.join(' | ')
  );
});

test('does NOT flag bullet with tech inside parens (parens are explicit trailing detail)', () => {
  const good = NARRATIVE_BASE + `
• Built and deployed a full-stack RAG system (TypeScript, TimescaleDB, Docker, S3, OpenAI APIs) processing 22K+ documents.
`;
  const result = validateResumeOutput(good);
  assert.ok(
    !result.warnings.some(w => w.startsWith('Bullet leads with tech jargon')),
    'unexpected jargon-lead warning: ' + result.warnings.join(' | ')
  );
});

test('flags FastAPI/Python-style slash compound when stacked at the lead', () => {
  const bad = NARRATIVE_BASE + `
• Architected a FastAPI/Python backend with React 19 + TypeScript + Vite + Tailwind frontend for the copilot.
`;
  const result = validateResumeOutput(bad);
  assert.ok(
    result.warnings.some(w => w.startsWith('Bullet leads with tech jargon')),
    'expected jargon-lead warning, got: ' + result.warnings.join(' | ')
  );
});

test('base resume passes the jargon-lead check', () => {
  const result = validateResumeOutput(RESUME_BASE);
  assert.ok(
    !result.warnings.some(w => w.startsWith('Bullet leads with tech jargon')),
    'base resume should not trigger jargon-lead warning, got: ' +
      result.warnings.filter(w => w.startsWith('Bullet leads')).join(' | ')
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// generateResumeDiff
// ─────────────────────────────────────────────────────────────────────────────
console.log('\ngenerateResumeDiff:');

test('identical text produces all "same" entries', () => {
  const diff = generateResumeDiff('Line A\nLine B', 'Line A\nLine B');
  assert.ok(diff.every(d => d.type === 'same'));
  assert.strictEqual(diff.length, 2);
});

test('added line is marked as "added"', () => {
  const diff = generateResumeDiff('Line A', 'Line A\nLine B');
  const added = diff.filter(d => d.type === 'added');
  assert.strictEqual(added.length, 1);
  assert.strictEqual(added[0].text, 'Line B');
});

test('removed line is marked as "removed"', () => {
  const diff = generateResumeDiff('Line A\nLine B', 'Line A');
  const removed = diff.filter(d => d.type === 'removed');
  assert.strictEqual(removed.length, 1);
  assert.strictEqual(removed[0].text, 'Line B');
});

test('modified line shows as added + removed', () => {
  const diff = generateResumeDiff('Original line', 'Modified line');
  const added = diff.filter(d => d.type === 'added');
  const removed = diff.filter(d => d.type === 'removed');
  assert.strictEqual(added.length, 1);
  assert.strictEqual(removed.length, 1);
});

test('empty lines are skipped', () => {
  const diff = generateResumeDiff('A\n\nB', 'A\n\nB');
  assert.strictEqual(diff.length, 2); // empty lines skipped
});

test('diff with real resume has reasonable output', () => {
  const modified = RESUME_BASE.replace('Shipped a multi-tenant conversational AI assistant', 'Directed end-to-end');
  const diff = generateResumeDiff(RESUME_BASE, modified);
  const added = diff.filter(d => d.type === 'added');
  const removed = diff.filter(d => d.type === 'removed');
  // Should have exactly 1 added and 1 removed (the changed line)
  assert.ok(added.length >= 1, 'Should have at least 1 added line');
  assert.ok(removed.length >= 1, 'Should have at least 1 removed line');
  // Most lines should be same
  const same = diff.filter(d => d.type === 'same');
  assert.ok(same.length > added.length, 'Most lines should be unchanged');
});

// ─────────────────────────────────────────────────────────────────────────────
// BANNED_RESUME_PHRASES
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nBANNED_RESUME_PHRASES:');

test('has at least 20 entries', () => {
  assert.ok(BANNED_RESUME_PHRASES.length >= 20, `Only ${BANNED_RESUME_PHRASES.length} phrases`);
});

test('all entries are lowercase strings', () => {
  for (const phrase of BANNED_RESUME_PHRASES) {
    assert.strictEqual(typeof phrase, 'string');
    assert.strictEqual(phrase, phrase.toLowerCase(), `Phrase "${phrase}" should be lowercase`);
  }
});

test('base resume does not contain any banned phrases', () => {
  const lower = RESUME_BASE.toLowerCase();
  const found = BANNED_RESUME_PHRASES.filter(p => lower.includes(p));
  assert.strictEqual(found.length, 0, `Base resume contains banned phrases: ${found.join(', ')}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Tracker sanitization (import from server)
// ─────────────────────────────────────────────────────────────────────────────
// Note: server.js sanitizeTrackerEntry is not exported, so we test via HTTP in integration tests

// ─────────────────────────────────────────────────────────────────────────────
// resumeContent: renderResumeText + applyAdjacency
// ─────────────────────────────────────────────────────────────────────────────
const {
  RESUME_BASE_JSON,
  renderResumeText,
  applyAdjacency,
  ADJACENCY_MAP,
  extractUserSkills,
} = require('../routes/resumeContent');

console.log('\nresumeContent:');

test('RESUME_BASE_JSON has required top-level keys', () => {
  assert.ok(RESUME_BASE_JSON.name);
  assert.ok(Array.isArray(RESUME_BASE_JSON.contact));
  assert.ok(Array.isArray(RESUME_BASE_JSON.sections));
  assert.ok(RESUME_BASE_JSON.sections.length >= 4);
});

test('renderResumeText produces text with all expected sections', () => {
  const text = renderResumeText(RESUME_BASE_JSON);
  assert.ok(text.includes('EDUCATION'));
  assert.ok(text.includes('PROFESSIONAL EXPERIENCE'));
  assert.ok(text.includes('PROJECTS'));
  assert.ok(text.includes('TECHNICAL SKILLS'));
  assert.ok(text.includes('Sahil Mehta'));
});

test('renderResumeText output passes the existing validator', () => {
  const text = renderResumeText(RESUME_BASE_JSON);
  const v = validateResumeOutput(text);
  // No banned phrases, no jargon-led bullets — base is clean.
  assert.strictEqual(v.bannedFound.length, 0,
    'base text has banned phrases: ' + v.bannedFound.join(', '));
  assert.ok(!v.warnings.some(w => w.startsWith('Bullet leads with tech jargon')),
    'base text triggered jargon-lead warning: ' +
    v.warnings.filter(w => w.startsWith('Bullet leads')).join(' | '));
});

test('extractUserSkills pulls comma-separated tokens lowercased', () => {
  const skills = extractUserSkills(RESUME_BASE_JSON);
  assert.ok(skills.has('python'));
  assert.ok(skills.has('javascript/typescript'));
  assert.ok(skills.has('flask'));
  assert.ok(skills.has('docker'));
});

test('applyAdjacency adds JD-required skill when adjacency match exists', () => {
  // JD requires FastAPI; user has Flask (in ADJACENCY_MAP['fastapi']).
  // BUT the base resume already lists FastAPI, so we test with a skill
  // we know isn't on the base.
  const trimmed = JSON.parse(JSON.stringify(RESUME_BASE_JSON));
  // Strip Vue-adjacent things from base for a clean test.
  const result = applyAdjacency(trimmed, ['Pinecone']);
  // Pinecone has Qdrant in its adjacency list and user has Qdrant → should add.
  assert.strictEqual(result.added.length, 1);
  assert.strictEqual(result.added[0].skill, 'Pinecone');
  assert.strictEqual(result.added[0].justifiedBy.toLowerCase(), 'qdrant');
  const skillsValues = result.json.sections.find(s => s.type === 'skills').items
    .map(i => i.value).join(' ');
  assert.ok(skillsValues.includes('Pinecone'));
});

test('applyAdjacency does NOT add a skill with no adjacency match', () => {
  // Cobol is nowhere in ADJACENCY_MAP — must not be added even though we listed it.
  const result = applyAdjacency(RESUME_BASE_JSON, ['COBOL']);
  assert.strictEqual(result.added.length, 0);
});

test('applyAdjacency skips skills already on the resume', () => {
  // Python is already in user skills; nothing should be added even if listed.
  const result = applyAdjacency(RESUME_BASE_JSON, ['Python']);
  assert.strictEqual(result.added.length, 0);
});

test('applyAdjacency does not duplicate when called repeatedly', () => {
  const r1 = applyAdjacency(RESUME_BASE_JSON, ['Pinecone']);
  const r2 = applyAdjacency(r1.json, ['Pinecone']);
  assert.strictEqual(r2.added.length, 0,
    'second pass should not re-add');
});

test('ADJACENCY_MAP keys are all lowercase', () => {
  for (const k of Object.keys(ADJACENCY_MAP)) {
    assert.strictEqual(k, k.toLowerCase(), `key "${k}" must be lowercase`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Bullet-keyword validator (JD keywords into bullets, truth-bounded)
// validateTailoredBullets / enforceBulletKeywords / capRewordedBullets
// ─────────────────────────────────────────────────────────────────────────────
const {
  validateTailoredBullets,
  enforceBulletKeywords,
  capRewordedBullets,
  ENABLE_BULLET_KEYWORDS,
  MAX_TAILORED_BULLETS,
  lockSkillsSection,
  validateCoverLetter,
  enforceCoverLetter,
  enforceBulletLength,
  needsNarrativeRewrite,
} = require('../routes/ai');
const { CANDIDATE_FACTS } = require('../routes/resumeContent');
const { SYNONYM_MAP, FACT_FRAGMENT_MAP } = require('../routes/resumeContent');
const { BASE_BULLET_CHAR_BUDGET } = require('../routes/resumeContent');

const clone = (j) => JSON.parse(JSON.stringify(j));
// Canonical bullet paths inside RESUME_BASE_JSON. Resolved by section TYPE, not
// by array index: SECTION_ORDER moved skills above experience (2026-08-04 layout
// brief), and these tests are about bullet handling, not section order.
const EXP     = (t) => t.sections.find(s => s.type === 'experience');
const COPILOT = (t) => EXP(t).items[0].subsections[0].bullets; // AI Copilot
const REPORTS = (t) => EXP(t).items[0].subsections[1].bullets; // Reports
const ORAHI   = (t) => EXP(t).items[1].subsections[0].bullets; // Orahi
const JD_KW = { title: 'AI Engineer', company: 'Acme', tags: ['REST APIs', 'semantic search', 'RBAC', 'FastAPI'], desc: 'Build RAG systems.' };

console.log('\nbullet-keyword validator:');

// Async test wrapper (existing `test` is sync). Collects a promise to await.
const asyncTests = [];
function atest(name, fn) { asyncTests.push({ name, fn }); }

// Regression guard: the candidate's own true material must never be flagged.
atest('validateTailoredBullets: base resume produces zero flags', async () => {
  const res = await validateTailoredBullets(clone(RESUME_BASE_JSON), RESUME_BASE_JSON, CANDIDATE_FACTS, JD_KW);
  assert.strictEqual(res.flags.length, 0, 'unexpected flags: ' + JSON.stringify(res.flags));
});

// Check 1: capability/keyword injection.
atest('validateTailoredBullets: flags injected tools not in facts (Go, Rust)', async () => {
  const t = clone(RESUME_BASE_JSON);
  COPILOT(t)[0] = 'Shipped a Go microservice with Rust extensions for the reseller copilot.';
  const res = await validateTailoredBullets(t, RESUME_BASE_JSON, CANDIDATE_FACTS, JD_KW);
  const terms = res.flags.filter(f => f.check === 'injection').map(f => f.term);
  assert.ok(terms.includes('go'), 'expected Go flagged, got: ' + JSON.stringify(terms));
  assert.ok(terms.includes('rust'), 'expected Rust flagged, got: ' + JSON.stringify(terms));
});

atest('validateTailoredBullets: does NOT flag a tool already on the base resume (Docker)', async () => {
  const t = clone(RESUME_BASE_JSON);
  COPILOT(t)[0] = 'Deployed the reseller copilot on Docker with per-tenant Qdrant isolation.';
  const res = await validateTailoredBullets(t, RESUME_BASE_JSON, CANDIDATE_FACTS, JD_KW);
  const terms = res.flags.filter(f => f.check === 'injection').map(f => f.term);
  assert.ok(!terms.includes('docker'), 'Docker is on the base resume; must not flag');
});

// Companion to the above, and a regression guard for the 2026-08-04 skills trim.
// Kubernetes was cut from the skills section because no CANDIDATE_FACTS entry
// supports it. Trimming a skill must therefore TIGHTEN the fabrication guard:
// once a tool is off the resume, a bullet claiming it is an injection.
atest('validateTailoredBullets: flags a tool trimmed off the base resume (Kubernetes)', async () => {
  const t = clone(RESUME_BASE_JSON);
  COPILOT(t)[0] = 'Deployed the reseller copilot on Kubernetes with per-tenant Qdrant isolation.';
  const res = await validateTailoredBullets(t, RESUME_BASE_JSON, CANDIDATE_FACTS, JD_KW);
  const terms = res.flags.filter(f => f.check === 'injection').map(f => f.term);
  assert.ok(terms.includes('kubernetes'),
    'Kubernetes is no longer a claimed skill; must flag as injected, got: ' + JSON.stringify(terms));
});

// Check 1: synonym (conditional allow).
atest('validateTailoredBullets: synonym allowed when mapped base term present', async () => {
  const t = clone(RESUME_BASE_JSON);
  COPILOT(t)[1] = 'Designed a hybrid retrieval layer over Qdrant vector search with BM25, exposed as semantic search for the catalog.';
  const res = await validateTailoredBullets(t, RESUME_BASE_JSON, CANDIDATE_FACTS, JD_KW);
  assert.ok(!res.flags.some(f => f.term === 'semantic search'),
    'semantic search should be allowed alongside vector search: ' + JSON.stringify(res.flags));
});

atest('validateTailoredBullets: synonym flagged when mapped base term absent', async () => {
  const t = clone(RESUME_BASE_JSON);
  COPILOT(t)[1] = 'Built a semantic search feature for the reseller catalog.';
  const res = await validateTailoredBullets(t, RESUME_BASE_JSON, CANDIDATE_FACTS, JD_KW);
  assert.ok(res.flags.some(f => f.term === 'semantic search' && f.check === 'injection'),
    'semantic search without vector search should flag: ' + JSON.stringify(res.flags));
});

// Check 1: approved fact fragment, topic-scoped.
atest('validateTailoredBullets: fact fragment allowed on its mapped topic', async () => {
  const t = clone(RESUME_BASE_JSON);
  COPILOT(t)[3] = 'Migrated session state to a durable SQL-backed flow state machine with optimistic concurrency control via state_version, preserving 9 transaction flows.';
  const res = await validateTailoredBullets(t, RESUME_BASE_JSON, CANDIDATE_FACTS, JD_KW);
  assert.ok(!res.flags.some(f => String(f.term).includes('optimistic concurrency')),
    'fragment on its own topic should be allowed: ' + JSON.stringify(res.flags));
});

atest('validateTailoredBullets: fact fragment flagged on the wrong topic', async () => {
  const t = clone(RESUME_BASE_JSON);
  ORAHI(t)[0] = 'Designed a bus route algorithm with optimistic concurrency control, reducing manual student-assignment effort by 80%.';
  const res = await validateTailoredBullets(t, RESUME_BASE_JSON, CANDIDATE_FACTS, JD_KW);
  assert.ok(res.flags.some(f => String(f.term).includes('optimistic concurrency')),
    'copilot-only fragment on the Orahi bullet should flag: ' + JSON.stringify(res.flags));
});

// Check 2: directional inversion (injected LLM-judge).
atest('validateTailoredBullets: inversion judge FAIL flags a reversed directional claim', async () => {
  const t = clone(RESUME_BASE_JSON);
  COPILOT(t)[1] = 'Led a routing inversion from vector-first to lexical-first when the product pivoted consumer-facing.';
  const judge = async (bullet) => ({ verdict: /vector-first to lexical-first/.test(bullet) ? 'FAIL' : 'PASS', reason: 'direction reversed' });
  const res = await validateTailoredBullets(t, RESUME_BASE_JSON, CANDIDATE_FACTS, JD_KW, { judge });
  assert.ok(res.flags.some(f => f.check === 'inversion'), 'expected inversion flag: ' + JSON.stringify(res.flags));
});

atest('validateTailoredBullets: inversion judge PASS does not flag', async () => {
  const t = clone(RESUME_BASE_JSON);
  const judge = async () => ({ verdict: 'PASS', reason: 'ok' });
  const res = await validateTailoredBullets(t, RESUME_BASE_JSON, CANDIDATE_FACTS, JD_KW, { judge });
  assert.ok(!res.flags.some(f => f.check === 'inversion'), 'PASS verdict must not flag');
});

// Check 3: cross-project metric contamination.
atest('validateTailoredBullets: flags 40% latency metric moved onto a copilot bullet', async () => {
  const t = clone(RESUME_BASE_JSON);
  COPILOT(t)[1] = 'Designed a hybrid retrieval layer that delivered a 40% query-latency reduction for the copilot.';
  const res = await validateTailoredBullets(t, RESUME_BASE_JSON, CANDIDATE_FACTS, JD_KW);
  assert.ok(res.flags.some(f => f.check === 'contamination'),
    'expected contamination flag for 40% latency on copilot: ' + JSON.stringify(res.flags));
});

// Enforcement: regenerate once, then fall back to base.
atest('enforceBulletKeywords: a flagged bullet regenerated clean is kept', async () => {
  const t = clone(RESUME_BASE_JSON);
  COPILOT(t)[0] = 'Shipped a Go service for the reseller copilot.';
  const regenerate = async () => 'Shipped a multi-tenant conversational AI assistant for the reseller platform in pilot with 15 tenants.';
  const out = await enforceBulletKeywords(t, RESUME_BASE_JSON, CANDIDATE_FACTS, JD_KW, { regenerate });
  const b = COPILOT(out.json)[0];
  assert.ok(!/\bGo\b/.test(b), 'injected term should be gone after regeneration');
  assert.ok(out.resolutions.some(r => r.resolution === 'regenerated'), 'expected a regenerated resolution');
});

atest('enforceBulletKeywords: second failure falls back to the base bullet', async () => {
  const t = clone(RESUME_BASE_JSON);
  const baseBullet0 = COPILOT(RESUME_BASE_JSON)[0];
  COPILOT(t)[0] = 'Shipped a Go service for the reseller copilot.';
  const regenerate = async () => 'Rebuilt it in Go and Rust for the copilot.'; // still injected
  const out = await enforceBulletKeywords(t, RESUME_BASE_JSON, CANDIDATE_FACTS, JD_KW, { regenerate });
  const b = COPILOT(out.json)[0];
  assert.strictEqual(b, baseBullet0, 'should fall back to the untouched base bullet');
  assert.ok(out.resolutions.some(r => r.resolution === 'fallback-base'), 'expected a fallback-base resolution');
});

// Config cap: never reword more than MAX_TAILORED_BULLETS.
atest('capRewordedBullets: never rewords more than the cap', async () => {
  const t = clone(RESUME_BASE_JSON);
  COPILOT(t)[0] = 'Reworded bullet A about the assistant for resellers and enterprise customers.';
  COPILOT(t)[1] = 'Reworded bullet B about hybrid retrieval and ranking across the catalog.';
  REPORTS(t)[0] = 'Reworded bullet C about the self-serve analytics product for customers.';
  ORAHI(t)[0]   = 'Reworded bullet D about the dynamic bus route clustering work.';
  const out = capRewordedBullets(t, RESUME_BASE_JSON, 2);
  assert.strictEqual(out.reworded, 2, 'reworded count should equal the cap');
  assert.strictEqual(out.reverted, 2, 'two excess bullets should revert to base');
});

// Config surface.
test('config: ENABLE_BULLET_KEYWORDS defaults on, MAX_TAILORED_BULLETS positive', () => {
  assert.strictEqual(ENABLE_BULLET_KEYWORDS, true);
  assert.ok(MAX_TAILORED_BULLETS > 0, 'MAX_TAILORED_BULLETS should be a positive number');
});

test('SYNONYM_MAP and FACT_FRAGMENT_MAP keys are lowercase', () => {
  for (const k of Object.keys(SYNONYM_MAP)) assert.strictEqual(k, k.toLowerCase(), `SYNONYM_MAP key "${k}"`);
  for (const k of Object.keys(FACT_FRAGMENT_MAP)) assert.strictEqual(k, k.toLowerCase(), `FACT_FRAGMENT_MAP key "${k}"`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Fix 3: shared checks module (DRY guard). Bullet behavior is covered unchanged
// by all the bullet tests above; this just locks in the shared exports.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nshared checks module (Fix 3):');

test('checks module exports the three reusable checks', () => {
  const checks = require('../routes/checks');
  assert.strictEqual(typeof checks.checkCapabilityInjection, 'function');
  assert.strictEqual(typeof checks.checkMetricContamination, 'function');
  assert.strictEqual(typeof checks.checkDirectionalInversion, 'function');
});

// ─────────────────────────────────────────────────────────────────────────────
// Fix 1: deterministic skills lock
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// Section order lock (2026-08-04 layout brief, Fix 3)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nsection order lock (Fix 3):');

const { SECTION_ORDER, enforceSectionOrder } = require('../routes/resumeContent');

test('SECTION_ORDER is Skills, Experience, Projects, Education', () => {
  assert.deepStrictEqual(SECTION_ORDER, ['skills', 'experience', 'projects', 'education']);
});

test('RESUME_BASE_JSON ships in canonical section order', () => {
  const types = RESUME_BASE_JSON.sections.map(s => s.type);
  assert.deepStrictEqual(types, SECTION_ORDER,
    'base section order drifted, got: ' + JSON.stringify(types));
  assert.strictEqual(RESUME_BASE_JSON.sections[0].header, 'TECHNICAL SKILLS',
    'skills must lead the resume');
});

test('enforceSectionOrder reorders an LLM resume that emitted the old order', () => {
  const t = clone(RESUME_BASE_JSON);
  // Simulate the model echoing the pre-brief order (experience first).
  t.sections = [
    t.sections.find(s => s.type === 'experience'),
    t.sections.find(s => s.type === 'projects'),
    t.sections.find(s => s.type === 'education'),
    t.sections.find(s => s.type === 'skills'),
  ];
  const out = enforceSectionOrder(t);
  assert.deepStrictEqual(out.sections.map(s => s.type), SECTION_ORDER);
});

test('enforceSectionOrder never drops sections, including unknown types', () => {
  const t = clone(RESUME_BASE_JSON);
  t.sections.push({ type: 'awards', header: 'AWARDS', items: [] });
  const out = enforceSectionOrder(t);
  assert.strictEqual(out.sections.length, 5, 'no section may be lost while reordering');
  assert.strictEqual(out.sections[4].type, 'awards', 'unknown types sort to the end');
});

test('enforceSectionOrder is idempotent', () => {
  const once = enforceSectionOrder(clone(RESUME_BASE_JSON)).sections.map(s => s.type);
  const twice = enforceSectionOrder(enforceSectionOrder(clone(RESUME_BASE_JSON))).sections.map(s => s.type);
  assert.deepStrictEqual(once, twice);
});

test('enforceSectionOrder tolerates malformed input', () => {
  assert.doesNotThrow(() => enforceSectionOrder(null));
  assert.doesNotThrow(() => enforceSectionOrder({}));
  assert.doesNotThrow(() => enforceSectionOrder({ sections: 'nope' }));
});

// ─────────────────────────────────────────────────────────────────────────────
// Skills section shape (2026-08-04 layout brief, Fix 2)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nskills shape (Fix 2):');

test('skills section keeps exactly 4 labeled groups, balanced order (longest not first)', () => {
  // 2026-08-05 brief Part 5: lines rebalanced to within ~15% and reordered so the
  // block no longer opens with the longest line (was "AI / LLM Systems").
  const skills = RESUME_BASE_JSON.sections.find(s => s.type === 'skills');
  assert.strictEqual(skills.items.length, 4, 'must stay at 4 groups');
  assert.deepStrictEqual(skills.items.map(i => i.label),
    ['Languages', 'AI / LLM Systems', 'Frameworks', 'Infra & Tools']);
});

test('skills lines carry no proficiency labels, ratings, or self-rated years', () => {
  const skills = RESUME_BASE_JSON.sections.find(s => s.type === 'skills');
  for (const item of skills.items) {
    assert.ok(!/\b(expert|advanced|intermediate|beginner|proficient|fluent)\b/i.test(item.value),
      `proficiency label in "${item.label}": ${item.value}`);
    assert.ok(!/[★*]{2,}|\b\d+\s*(?:\+\s*)?(?:yrs?|years)\b/i.test(item.value),
      `rating or years-of-experience in "${item.label}": ${item.value}`);
  }
});

test('every ADJACENCY_MAP justifier still present after the skills trim', () => {
  const { ADJACENCY_MAP, extractUserSkills } = require('../routes/resumeContent');
  const tokens = extractUserSkills(RESUME_BASE_JSON);
  // These 19 were the justifiers the map could actually reach before the trim.
  // If a future trim removes one, applyAdjacency silently stops injecting the
  // skills it unlocks, so pin the list rather than recomputing it.
  const REQUIRED = [
    'aws s3', 'claude code', 'django', 'docker', 'express', 'fastapi', 'flask',
    'git', 'grpc', 'node.js', 'postgresql', 'python', 'pytorch', 'qdrant',
    'rag', 'react', 'sql', 'tool calling', 'vector search',
  ];
  const missing = REQUIRED.filter(r => !tokens.has(r));
  assert.strictEqual(missing.length, 0, 'lost adjacency justifiers: ' + missing.join(', '));
  // And each one is genuinely reachable as a justifier in the map.
  const inMap = new Set();
  for (const v of Object.values(ADJACENCY_MAP)) v.forEach(x => inMap.add(x.toLowerCase()));
  const orphans = REQUIRED.filter(r => !inMap.has(r));
  assert.strictEqual(orphans.length, 0, 'no longer justifiers in ADJACENCY_MAP: ' + orphans.join(', '));
});

console.log('\nskills lock (Fix 1):');

test('lockSkillsSection: discards LLM skills (C++), keeps 4 base labels, adds adjacency skills', () => {
  const t = clone(RESUME_BASE_JSON);
  // Simulate an LLM that rewrote the skills section and injected C++.
  const sIdx = t.sections.findIndex(s => s.type === 'skills');
  t.sections[sIdx] = {
    type: 'skills', header: 'TECHNICAL SKILLS',
    items: [{ label: 'Made Up Category', value: 'C++, Rust, Haskell' }],
  };
  const out = lockSkillsSection(t, RESUME_BASE_JSON, ['Pinecone']);
  const skills = out.json.sections.find(s => s.type === 'skills');
  const joined = skills.items.map(i => `${i.label}: ${i.value}`).join(' | ');
  assert.ok(!/C\+\+/.test(joined), 'C++ must not survive the lock: ' + joined);
  assert.ok(/Pinecone/.test(joined), 'adjacency-justified Pinecone should appear: ' + joined);
  assert.deepStrictEqual(
    skills.items.map(i => i.label),
    ['Languages', 'AI / LLM Systems', 'Frameworks', 'Infra & Tools'],
    'the 4 base category labels must be preserved'
  );
});

test('lockSkillsSection: does not mutate the module-level base skills', () => {
  const before = JSON.stringify(RESUME_BASE_JSON.sections.find(s => s.type === 'skills'));
  const t = clone(RESUME_BASE_JSON);
  lockSkillsSection(t, RESUME_BASE_JSON, ['Pinecone']);
  const after = JSON.stringify(RESUME_BASE_JSON.sections.find(s => s.type === 'skills'));
  assert.strictEqual(before, after, 'base skills section must be untouched');
});

// ─────────────────────────────────────────────────────────────────────────────
// Fix 2: cover-letter validator + enforcement
// ─────────────────────────────────────────────────────────────────────────────
console.log('\ncover-letter validator (Fix 2):');
const CLEAN_LETTER = 'Dear team, I build production AI systems in Python and TypeScript with FastAPI and Qdrant. Best,\nSahil Mehta';

atest('validateCoverLetter: flags a letter naming C++ (capability injection)', async () => {
  const letter = 'Dear team, I build production AI systems in Python, TypeScript, and C++. Best,\nSahil Mehta';
  const res = await validateCoverLetter(letter, CANDIDATE_FACTS, RESUME_BASE_JSON, JD_KW);
  assert.ok(res.flags.some(f => f.check === 'injection' && f.term === 'c++'),
    'expected C++ injection flag: ' + JSON.stringify(res.flags));
});

atest('validateCoverLetter: a clean letter passes capability injection', async () => {
  const res = await validateCoverLetter(CLEAN_LETTER, CANDIDATE_FACTS, RESUME_BASE_JSON, JD_KW);
  assert.ok(!res.flags.some(f => f.check === 'injection'),
    'clean letter should not flag injection: ' + JSON.stringify(res.flags));
});

// Regression (2026-08-09 ByteDance block): a letter for a role literally named
// "Applied Machine Learning" must be allowed to call that domain "ML" / "AML".
// Title WORDS were allowlisted but their standard initialisms were not, so the
// ALLCAPS-acronym extractor flagged "ml"/"aml" as fabrication and the letter
// was blocked after one failed regeneration.
const AML_JD = { title: 'Software Engineer - Applied Machine Learning, Engine', company: 'ByteDance', tags: ['Python'], desc: 'AML team.' };

atest('validateCoverLetter: JD-title initialisms (ML, AML) are not injection', async () => {
  const letter = 'Dear ByteDance team, The AML team runs distributed recommendation systems, and applied ML at that scale is engineering I want to do. At Enidus I shipped a multi-tenant AI copilot. Best,\nSahil Mehta';
  const res = await validateCoverLetter(letter, CANDIDATE_FACTS, RESUME_BASE_JSON, AML_JD);
  const bad = res.flags.filter(f => f.check === 'injection' && (f.term === 'ml' || f.term === 'aml'));
  assert.strictEqual(bad.length, 0,
    'JD-title initialisms must be traceable: ' + JSON.stringify(res.flags));
});

atest('validateCoverLetter: initialism allowance does NOT weaken the stack backstop (Golang still flags)', async () => {
  const letter = 'Dear ByteDance team, I am fluent in Golang and run the AML stack daily. Best,\nSahil Mehta';
  const res = await validateCoverLetter(letter, CANDIDATE_FACTS, RESUME_BASE_JSON, AML_JD);
  assert.ok(res.flags.some(f => f.check === 'injection' && f.term === 'golang'),
    'golang must still flag: ' + JSON.stringify(res.flags));
});

atest('validateCoverLetter: flags a reversed routing story (inversion judge)', async () => {
  const letter = 'Dear team, I inverted routing from vector-first to lexical-first as we scaled. Best,\nSahil Mehta';
  const judge = async () => ({ verdict: 'FAIL', reason: 'reversed lexical/vector-first' });
  const res = await validateCoverLetter(letter, CANDIDATE_FACTS, RESUME_BASE_JSON, JD_KW, { judge });
  assert.ok(res.flags.some(f => f.check === 'inversion'), 'expected inversion flag: ' + JSON.stringify(res.flags));
});

atest('validateCoverLetter: flags an invented incident (incident judge)', async () => {
  const letter = 'Dear team, last month I discovered a critical gap in a banking client system. Best,\nSahil Mehta';
  const incidentJudge = async () => ({ verdict: 'FAIL', reason: 'invented incident: last-month gap' });
  const res = await validateCoverLetter(letter, CANDIDATE_FACTS, RESUME_BASE_JSON, JD_KW, { incidentJudge });
  assert.ok(res.flags.some(f => f.check === 'invented-incident'),
    'expected invented-incident flag: ' + JSON.stringify(res.flags));
});

atest('validateCoverLetter: flags capstone 40% latency attributed to the copilot', async () => {
  const letter = 'Dear team, on the T-Mobile copilot I delivered a 40% latency reduction for users. Best,\nSahil Mehta';
  const res = await validateCoverLetter(letter, CANDIDATE_FACTS, RESUME_BASE_JSON, JD_KW);
  assert.ok(res.flags.some(f => f.check === 'contamination'),
    'expected contamination flag: ' + JSON.stringify(res.flags));
});

atest('enforceCoverLetter: a clean letter is not blocked and not regenerated', async () => {
  let regenCalled = false;
  const regenerate = async () => { regenCalled = true; return CLEAN_LETTER; };
  const out = await enforceCoverLetter(CLEAN_LETTER, CANDIDATE_FACTS, RESUME_BASE_JSON, JD_KW, { regenerate });
  assert.strictEqual(out.blocked, false);
  assert.strictEqual(regenCalled, false, 'a clean letter must not trigger regeneration');
});

atest('enforceCoverLetter: a regenerated clean letter is accepted', async () => {
  const bad = 'Dear team, I build systems in C++ every day. Best,\nSahil Mehta';
  const regenerate = async () => CLEAN_LETTER;
  const out = await enforceCoverLetter(bad, CANDIDATE_FACTS, RESUME_BASE_JSON, JD_KW, { regenerate });
  assert.strictEqual(out.blocked, false);
  assert.strictEqual(out.resolution, 'regenerated');
  assert.strictEqual(out.text, CLEAN_LETTER);
});

// Regression for the Astrana block (2026-08-04). The letter invented a "before"
// state ("I was routing based on embedding similarity alone") that contradicts
// the facts, where the BEFORE state is lexical-first. Regeneration was told to
// "fix ONLY these issues, keeping every correctly-sourced detail", so it patched
// the correct direction phrase in while preserving the wrong narrative around
// it. Verified 8/8 deterministically: the resulting self-contradictory letter
// fails the inversion judge again and blocks. A narrative-premise flag must
// escalate to a full paragraph rewrite instead of a surgical patch.
test('needsNarrativeRewrite: inversion and invented-incident escalate; word-level flags do not', () => {
  assert.strictEqual(needsNarrativeRewrite([{ check: 'inversion' }]), true);
  assert.strictEqual(needsNarrativeRewrite([{ check: 'invented-incident' }]), true);
  assert.strictEqual(needsNarrativeRewrite([{ check: 'injection' }]), false);
  assert.strictEqual(needsNarrativeRewrite([{ check: 'contamination' }]), false);
  assert.strictEqual(needsNarrativeRewrite([{ check: 'injection' }, { check: 'inversion' }]), true,
    'a mixed flag set containing a narrative flag must escalate');
});

test('needsNarrativeRewrite: tolerates empty, null, and malformed flag lists', () => {
  assert.strictEqual(needsNarrativeRewrite([]), false);
  assert.strictEqual(needsNarrativeRewrite(null), false);
  assert.strictEqual(needsNarrativeRewrite(undefined), false);
  assert.strictEqual(needsNarrativeRewrite([null, {}, { check: undefined }]), false);
});

atest('enforceCoverLetter: passes the flag objects to regenerate so it can escalate', async () => {
  const bad = 'Dear team, I build systems in C++ every day. Best,\nSahil Mehta';
  let seenFlags = null;
  const regenerate = async (text, reasons, facts, jd, flags) => { seenFlags = flags; return CLEAN_LETTER; };
  await enforceCoverLetter(bad, CANDIDATE_FACTS, RESUME_BASE_JSON, JD_KW, { regenerate });
  assert.ok(Array.isArray(seenFlags), 'regenerate must receive the flag objects, not just reason strings');
  assert.ok(seenFlags.some(f => f.check === 'injection'),
    'flag objects must carry their check type: ' + JSON.stringify(seenFlags));
});

atest('enforceCoverLetter: regenerates once then BLOCKS a persistently flagged letter', async () => {
  const bad = 'Dear team, I build systems in C++ every day. Best,\nSahil Mehta';
  const regenerate = async () => 'Dear team, I still rely on C++ heavily. Best,\nSahil Mehta'; // still flagged
  const out = await enforceCoverLetter(bad, CANDIDATE_FACTS, RESUME_BASE_JSON, JD_KW, { regenerate });
  assert.strictEqual(out.blocked, true, 'a persistently flagged letter must block');
  assert.strictEqual(out.resolution, 'blocked');
});

// Regression coverage for the false-positive block pattern found across recent
// live applications (AXQ Capital "axq", ERP Suites "erp", Nuro "ml" from the
// job title, Aquatic "go", Exelixis "rails"): the target company name / job
// title and a handful of TECH_VOCAB entries that double as ordinary English
// words must not read as fabricated candidate capability claims.
atest('validateCoverLetter: does not flag the target company name as an injected term (AXQ Capital)', async () => {
  const jd = { title: 'Quantitative Developer', company: 'AXQ Capital', tags: [], desc: '' };
  const letter = 'Dear AXQ Capital hiring team, I build production AI systems in Python and TypeScript. Best,\nSahil Mehta';
  const res = await validateCoverLetter(letter, CANDIDATE_FACTS, RESUME_BASE_JSON, jd);
  assert.ok(!res.flags.some(f => f.term === 'axq'),
    'company name "AXQ" must not be flagged as an unsupported technical term: ' + JSON.stringify(res.flags));
});

atest('validateCoverLetter: does not flag a job-title acronym as an injected term (ML Data Infra)', async () => {
  const jd = { title: 'Software Engineer, ML Data Infra', company: 'Nuro', tags: [], desc: '' };
  const letter = 'Dear Nuro hiring team, I want to bring my ML Data Infra experience to this role. Best,\nSahil Mehta';
  const res = await validateCoverLetter(letter, CANDIDATE_FACTS, RESUME_BASE_JSON, jd);
  assert.ok(!res.flags.some(f => f.term === 'ml'),
    'job-title term "ML" must not be flagged as an unsupported technical term: ' + JSON.stringify(res.flags));
});

atest('validateCoverLetter: does not flag ordinary English usage of "go" and "rails"', async () => {
  const letter = 'Dear team, I want to go deep on evals rather than chase every framework off the rails. Best,\nSahil Mehta';
  const res = await validateCoverLetter(letter, CANDIDATE_FACTS, RESUME_BASE_JSON, JD_KW);
  const terms = res.flags.filter(f => f.check === 'injection').map(f => f.term);
  assert.ok(!terms.includes('go') && !terms.includes('rails'),
    'ordinary prose use of "go"/"rails" must not be flagged as tech claims: ' + JSON.stringify(terms));
});

atest('validateCoverLetter: a genuine fabricated claim using an ambiguous word is still allowed through this check (documented tradeoff) but real tech terms still flag', async () => {
  const letter = 'Dear team, I ship production systems in C++ and Elixir. Best,\nSahil Mehta';
  const res = await validateCoverLetter(letter, CANDIDATE_FACTS, RESUME_BASE_JSON, JD_KW);
  const terms = res.flags.filter(f => f.check === 'injection').map(f => f.term);
  assert.ok(terms.includes('c++') && terms.includes('elixir'),
    'unambiguous fabricated tech terms must still flag: ' + JSON.stringify(terms));
});

// FACT_FRAGMENT_MAP entries are true, topic-scoped facts; the topic restricts
// which BULLET they may render on, but that placement constraint should not
// apply to free prose, where there is no bullet to misattribute the fact to.
atest('validateCoverLetter: does not flag a true fact-fragment term (multi-tenant isolation) in prose', async () => {
  const letter = 'Dear team, my work on the copilot centered on multi-tenant isolation for reseller accounts. Best,\nSahil Mehta';
  const res = await validateCoverLetter(letter, CANDIDATE_FACTS, RESUME_BASE_JSON, JD_KW);
  assert.ok(!res.flags.some(f => f.term === 'multi-tenant isolation'),
    'true fact-fragment term must not flag in cover-letter prose: ' + JSON.stringify(res.flags));
});

// ─────────────────────────────────────────────────────────────────────────────
// Fix 4: number-format normalization in validateResumeOutput
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nnumber normalization (Fix 4):');

test('validateResumeOutput: "0%" output does not false-flag when base writes "0 percent"', () => {
  // The base CloudGuard bullet writes "0 percent"; a tailored output may render
  // it as "0%". That must not be flagged as a number not in source.
  const text = RESUME_BASE.replace(/0 percent/g, '0%');
  const res = validateResumeOutput(text);
  assert.ok(
    !res.warnings.some(w => /Contains numbers not in source/.test(w) && /\b0%/.test(w)),
    'unexpected 0% fabrication warning: ' + res.warnings.join(' | ')
  );
});

test('validateResumeOutput: still flags a genuinely new percentage', () => {
  const text = RESUME_BASE + '\nImproved throughput by 63% overnight';
  const res = validateResumeOutput(text);
  assert.ok(res.warnings.some(w => /Contains numbers not in source/.test(w) && /63%/.test(w)),
    'a genuinely new number should still flag: ' + res.warnings.join(' | '));
});

// ─────────────────────────────────────────────────────────────────────────────
// 2026-07-30 brief: keep the tailored resume on one page (length-fit)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nskills growth cap (Fix 2):');

test('lockSkillsSection: reports skillsGrowth for an added skill', () => {
  const t = clone(RESUME_BASE_JSON);
  const out = lockSkillsSection(t, RESUME_BASE_JSON, ['Pinecone']);
  assert.strictEqual(out.skillsGrowth, ', Pinecone'.length, 'growth is the appended chars');
});

test('lockSkillsSection: caps skills growth to roughly one line', () => {
  // Many adjacency-justified skills; the section must not grow past ~1 line.
  const many = ['Pinecone', 'Weaviate', 'Milvus', 'Chroma', 'pgvector', 'Podman', 'LangChain', 'LangGraph', 'LlamaIndex'];
  const t = clone(RESUME_BASE_JSON);
  const out = lockSkillsSection(t, RESUME_BASE_JSON, many);
  assert.ok(out.skillsGrowth > 0 && out.skillsGrowth <= 90,
    'growth should be capped near one line, got: ' + out.skillsGrowth);
  assert.ok(out.added.length < many.length, 'some additions were capped');
});

console.log('\nlength-fit enforcement (Fix 1):');
const COPILOT_B0 = COPILOT(RESUME_BASE_JSON)[0];

atest('enforceBulletLength: shortens an over-length bullet and keeps total <= budget', async () => {
  const t = clone(RESUME_BASE_JSON);
  COPILOT(t)[0] = COPILOT_B0 + ('  padding words'.repeat(30)); // well over base
  const regenerate = async () => 'Shipped the reseller copilot to pilot users.';
  const out = await enforceBulletLength(t, RESUME_BASE_JSON, CANDIDATE_FACTS, JD_KW, { regenerate });
  assert.ok(out.totalChars <= BASE_BULLET_CHAR_BUDGET, 'total must be within the one-page budget');
  assert.ok(COPILOT(out.json)[0].length <= COPILOT_B0.length, 'bullet 0 must be at or below its base length');
  assert.ok(out.resolutions.some(r => r.index === 0 && r.resolution === 'shortened'), JSON.stringify(out.resolutions));
});

atest('enforceBulletLength: a shortening that injects a tool is rejected and reverted to base', async () => {
  const t = clone(RESUME_BASE_JSON);
  COPILOT(t)[0] = COPILOT_B0 + ('  padding words'.repeat(30));
  const regenerate = async () => 'Rebuilt the copilot in Go for raw speed.'; // short but injects Go
  const out = await enforceBulletLength(t, RESUME_BASE_JSON, CANDIDATE_FACTS, JD_KW, { regenerate });
  assert.strictEqual(COPILOT(out.json)[0], COPILOT_B0, 'must revert to base when the shortening fabricates');
  assert.ok(out.resolutions.some(r => r.index === 0 && r.resolution === 'reverted-base'), JSON.stringify(out.resolutions));
});

atest('enforceBulletLength: a resume already within budget is left unchanged', async () => {
  const t = clone(RESUME_BASE_JSON); // identical to base
  let regenCalled = false;
  const regenerate = async () => { regenCalled = true; return 'x'; };
  const out = await enforceBulletLength(t, RESUME_BASE_JSON, CANDIDATE_FACTS, JD_KW, { regenerate });
  assert.strictEqual(regenCalled, false, 'no bullet over tolerance should trigger regeneration');
  assert.strictEqual(out.resolutions.length, 0, 'no reverts or shortenings expected');
  assert.strictEqual(JSON.stringify(out.json.sections), JSON.stringify(RESUME_BASE_JSON.sections),
    'sections must be byte-identical to base');
});

atest('enforceBulletLength: reverting one over-length bullet leaves the others untouched', async () => {
  const t = clone(RESUME_BASE_JSON);
  const baseB1 = COPILOT(RESUME_BASE_JSON)[1];
  COPILOT(t)[0] = COPILOT_B0 + ('  padding words'.repeat(40)); // over; shortening will fail
  const tweaked = baseB1.replace('Designed', 'Built'); // within tolerance (shorter), stays tailored
  COPILOT(t)[1] = tweaked;
  const regenerate = async () => null; // shortening fails -> revert bullet 0 only
  const out = await enforceBulletLength(t, RESUME_BASE_JSON, CANDIDATE_FACTS, JD_KW, { regenerate });
  assert.strictEqual(COPILOT(out.json)[0], COPILOT_B0, 'bullet 0 reverts to base');
  assert.strictEqual(COPILOT(out.json)[1], tweaked, 'bullet 1 (within tolerance) stays tailored');
});

atest('enforceBulletLength: guarantees total <= budget even when every shortening fails', async () => {
  const t = clone(RESUME_BASE_JSON);
  COPILOT(t)[0] = COPILOT(t)[0] + ('  padding'.repeat(40));
  COPILOT(t)[1] = COPILOT(t)[1] + ('  padding'.repeat(40));
  REPORTS(t)[0] = REPORTS(t)[0] + ('  padding'.repeat(40));
  const regenerate = async () => null; // all shortenings fail -> all revert to base
  const out = await enforceBulletLength(t, RESUME_BASE_JSON, CANDIDATE_FACTS, JD_KW, { regenerate });
  assert.ok(out.totalChars <= BASE_BULLET_CHAR_BUDGET, 'total must be within the one-page budget');
});

atest('enforceBulletLength: skills growth reserves budget and keeps the combined total in envelope', async () => {
  const t = clone(RESUME_BASE_JSON);
  COPILOT(t)[0] = COPILOT_B0 + ('  padding words'.repeat(40));
  const regenerate = async () => 'Shipped the reseller copilot to pilot users with zero incidents.';
  const skillsGrowth = 40;
  const out = await enforceBulletLength(t, RESUME_BASE_JSON, CANDIDATE_FACTS, JD_KW, { regenerate, skillsGrowth });
  assert.strictEqual(out.budget, BASE_BULLET_CHAR_BUDGET - skillsGrowth, 'budget is reduced by skills growth');
  assert.ok(out.totalChars <= out.budget, 'bullets fit the reserved budget');
  assert.ok(out.totalChars + skillsGrowth <= BASE_BULLET_CHAR_BUDGET, 'combined total stays in the one-page envelope');
});

// ─────────────────────────────────────────────────────────────────────────────
// saveBundle: folder name + slug helpers (no actual disk I/O in tests)
// ─────────────────────────────────────────────────────────────────────────────
const { slug, buildFolderName } = require('../routes/saveBundle');

console.log('\nsaveBundle:');

test('slug strips spaces and special chars', () => {
  assert.strictEqual(slug('David Joseph & Company'), 'David-Joseph-Company');
  assert.strictEqual(slug('CollectWise!@#'), 'CollectWise');
});

test('slug handles empty/null', () => {
  assert.strictEqual(slug(''), 'unknown');
  assert.strictEqual(slug(null), 'unknown');
});

test('buildFolderName combines company, title, timestamp', () => {
  const name = buildFolderName('CollectWise', 'AI Agent Engineer');
  assert.ok(name.startsWith('CollectWise_AI-Agent-Engineer_'));
  assert.ok(/_\d{4}-\d{2}-\d{2}-\d{4}$/.test(name),
    `name should end with timestamp: ${name}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Run async tests (bullet-keyword validator), then print the summary.
// The async cases are registered via atest() into `asyncTests` above; they run
// after all synchronous tests so the counters stay shared and accurate.
// ─────────────────────────────────────────────────────────────────────────────
async function runAsyncTests() {
  for (const { name, fn } of asyncTests) {
    try {
      await fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (e) {
      failed++;
      failures.push({ name, error: e.message });
      console.log(`  ✗ ${name}`);
      console.log(`    ${e.message}`);
    }
  }
}

(async () => {
  await runAsyncTests();

  // ───────────────────────────────────────────────────────────────────────────
  // Summary
  // ───────────────────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log('\nFailed tests:');
    for (const f of failures) {
      console.log(`  ✗ ${f.name}: ${f.error}`);
    }
  }
  console.log('');

  process.exit(failed > 0 ? 1 : 0);
})();
