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
  const resume = RESUME_BASE.replace('Led end-to-end', 'Leveraged end-to-end');
  const result = validateResumeOutput(resume);
  assert.ok(result.bannedFound.includes('leveraged'));
  assert.strictEqual(result.valid, false);
});

test('detects banned phrase: spearheaded', () => {
  const resume = RESUME_BASE.replace('Led end-to-end', 'Spearheaded end-to-end');
  const result = validateResumeOutput(resume);
  assert.ok(result.bannedFound.includes('spearheaded'));
});

test('detects multiple banned phrases', () => {
  let resume = RESUME_BASE;
  resume = resume.replace('Led end-to-end', 'Leveraged cutting-edge');
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
  const modified = RESUME_BASE.replace('Led end-to-end', 'Directed end-to-end');
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
