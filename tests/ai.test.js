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
  const resume = RESUME_BASE.replace('Shipped an AI assistant', 'Leveraged end-to-end');
  const result = validateResumeOutput(resume);
  assert.ok(result.bannedFound.includes('leveraged'));
  assert.strictEqual(result.valid, false);
});

test('detects banned phrase: spearheaded', () => {
  const resume = RESUME_BASE.replace('Shipped an AI assistant', 'Spearheaded end-to-end');
  const result = validateResumeOutput(resume);
  assert.ok(result.bannedFound.includes('spearheaded'));
});

test('detects multiple banned phrases', () => {
  let resume = RESUME_BASE;
  resume = resume.replace('Shipped an AI assistant', 'Leveraged cutting-edge');
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
  const modified = RESUME_BASE.replace('Shipped an AI assistant', 'Directed end-to-end');
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
// Summary
// ─────────────────────────────────────────────────────────────────────────────
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
