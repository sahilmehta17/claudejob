/**
 * tests/selection.test.js — Entry-selection pool, status gating, selector,
 * publication schema, and skills-balancing tests (2026-08-05 brief).
 *
 * Run: node tests/selection.test.js  (also chained from `npm test`).
 *
 * The regression guard is the load-bearing test: the DEFAULT selection must
 * reproduce today's resume EXCEPT for the two intended entry changes
 * (GSPANN out, GoodEnough in). "Today's resume" is captured byte-for-byte in
 * tests/fixtures/todays-resume.golden.json (snapshotted before this brief).
 */

const assert = require('assert');
const path = require('path');

const {
  RESUME_BASE_JSON,
  ENTRY_POOL,
  MAX_PROJECT_ENTRIES,
  MAX_NON_DEFAULT_SWAPS,
  selectEntries,
  isValidEntryKind,
  BASE_BULLET_CHAR_BUDGET,
  sumBulletChars,
  extractUserSkills,
  enforceProjectDateOrder,
} = require('../routes/resumeContent');

const GOLDEN = require('./fixtures/todays-resume.golden.json');

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; failures.push({ name, error: e.message }); console.log(`  ✗ ${name}\n    ${e.message}`); }
}

// ── helpers ──────────────────────────────────────────────────────────────────
const clone = (o) => JSON.parse(JSON.stringify(o));
const sec = (json, type) => (json.sections || []).find(s => s.type === type);
const expItems = (json) => (sec(json, 'experience') || { items: [] }).items;
const projItems = (json) => (sec(json, 'projects') || { items: [] }).items;
const expTitles = (json) => expItems(json).map(i => i.title);
const projTitles = (json) => projItems(json).map(i => i.title);
const poolById = (id) => ENTRY_POOL.find(e => e.id === id);

// JD shapes used across tests
const RAG_JD = {
  skills: ['RAG', 'retrieval', 'embeddings', 'vector search', 'BM25', 'TF-IDF'],
  text: 'Build hybrid retrieval and RAG pipelines with BM25, TF-IDF, embeddings and vector search over large document corpora.',
};
const ML_JD = {
  skills: ['PyTorch', 'CNN', 'model training', 'deep learning', 'computer vision'],
  text: 'Train deep learning models with PyTorch. CNN architectures for computer vision. Hands-on model training, not just API calls.',
};
const BACKEND_JD = {
  skills: ['Node.js', 'Express', 'PostgreSQL', 'REST APIs', 'Docker'],
  text: 'Backend engineer building Node.js and Express services on PostgreSQL, containerized with Docker.',
};

// ── Regression guard (write-first) ───────────────────────────────────────────
console.log('\nRegression guard (default == today minus GSPANN plus GoodEnough):');

test('default experience is Enidus + Orahi, GSPANN removed', () => {
  assert.deepStrictEqual(expTitles(RESUME_BASE_JSON), [
    'Enidus USA LLC. (Full-Time)',
    'Software Developer, Orahi (Internship)',
  ]);
});

test('default projects are 3, date-sorted newest-first: GoodEnough, CloudGuard, Denari', () => {
  const titles = projTitles(RESUME_BASE_JSON);
  assert.strictEqual(titles.length, 3);
  assert.ok(/GoodEnough/i.test(titles[0]), 'slot 1 GoodEnough (Aug 2026): ' + titles[0]);
  assert.ok(/CloudGuard/.test(titles[1]), 'slot 2 CloudGuard (Jul 2026): ' + titles[1]);
  assert.ok(/Denari/i.test(titles[2]), 'slot 3 Denari (2025): ' + titles[2]);
  // ClaudeJob is benched from the default now.
  assert.ok(!titles.some(t => /ClaudeJob/.test(t)), 'ClaudeJob should not be a default project');
});

test('projects render newest-first by date (dateSort)', () => {
  // Denari (2025) is the oldest default project, so it renders last.
  const titles = projTitles(RESUME_BASE_JSON);
  assert.ok(/Denari/i.test(titles[titles.length - 1]), 'Denari (2025) should render last: ' + titles.join(' | '));
});

test('enforceProjectDateOrder re-imposes newest-first even if projects are shuffled (LLM-proof)', () => {
  // Simulate a tailoring LLM that emitted projects oldest-first.
  const shuffled = clone(RESUME_BASE_JSON);
  const projSec = sec(shuffled, 'projects');
  projSec.items = [...projSec.items].reverse(); // reverse the canonical newest-first order
  const fixed = enforceProjectDateOrder(shuffled);
  const titles = projTitles(fixed);
  assert.ok(/GoodEnough/i.test(titles[0]), 'GoodEnough (Aug 2026) must be first: ' + titles.join(' | '));
  assert.ok(/Denari/i.test(titles[titles.length - 1]), 'Denari (2025) must be last: ' + titles.join(' | '));
});

test('enforceProjectDateOrder parses date ranges by their LATEST month', () => {
  const json = { sections: [{ type: 'projects', items: [
    { title: 'A', date: 'January 2025 - May 2025 | Capstone' },
    { title: 'B', date: 'July 2026 | Personal Project' },
    { title: 'C', date: 'August 2026 | Research' },
  ] }] };
  const titles = enforceProjectDateOrder(json).sections[0].items.map(i => i.title);
  assert.deepStrictEqual(titles, ['C', 'B', 'A']);
});

test('GoodEnough carries its GitHub link', () => {
  const ge = poolById('goodenough');
  assert.strictEqual(ge.item.url, 'https://github.com/sahilmehta17/GoodEnough');
  const rendered = projItems(RESUME_BASE_JSON).find(i => /GoodEnough/i.test(i.title));
  assert.ok(rendered.url && /github\.com\/sahilmehta17\/GoodEnough/.test(rendered.url));
});

test('carried experience entries are byte-identical to today (Enidus, Orahi)', () => {
  const g = expItems(GOLDEN);
  const gEnidus = g.find(i => /Enidus/.test(i.title));
  const gOrahi = g.find(i => /Orahi/.test(i.title));
  const nEnidus = expItems(RESUME_BASE_JSON).find(i => /Enidus/.test(i.title));
  const nOrahi = expItems(RESUME_BASE_JSON).find(i => /Orahi/.test(i.title));
  assert.deepStrictEqual(nEnidus, gEnidus, 'Enidus entry changed');
  assert.deepStrictEqual(nOrahi, gOrahi, 'Orahi entry changed');
});

test('carried project entry CloudGuard is byte-identical to today; ClaudeJob content preserved in pool', () => {
  const gCG = projItems(GOLDEN).find(i => /CloudGuard/.test(i.title));
  const nCG = projItems(RESUME_BASE_JSON).find(i => /CloudGuard/.test(i.title));
  assert.deepStrictEqual(nCG, gCG, 'CloudGuard entry changed');
  // ClaudeJob is benched from the default but its content must be unchanged.
  const gCJ = projItems(GOLDEN).find(i => /ClaudeJob/.test(i.title));
  const poolCJ = poolById('claudejob');
  assert.deepStrictEqual(poolCJ.item, gCJ, 'ClaudeJob pool content changed');
});

test('name / contact / education / summary are byte-identical to today', () => {
  assert.deepStrictEqual(RESUME_BASE_JSON.name, GOLDEN.name);
  assert.deepStrictEqual(RESUME_BASE_JSON.contact, GOLDEN.contact);
  assert.deepStrictEqual(RESUME_BASE_JSON.summary, GOLDEN.summary);
  assert.deepStrictEqual(sec(RESUME_BASE_JSON, 'education'), sec(GOLDEN, 'education'));
});

test('LinkedIn URL is intact (identity lock, no fabrication)', () => {
  const li = RESUME_BASE_JSON.contact.find(c => typeof c === 'object' && c.text === 'Linkedin');
  assert.ok(li && li.url === 'https://www.linkedin.com/in/sahil-mehta-87357b1b9/', 'LinkedIn url: ' + JSON.stringify(li));
});

// ── Part 1: the pool ─────────────────────────────────────────────────────────
console.log('\nPart 1: ENTRY_POOL + metadata:');

test('ENTRY_POOL seeds all 9 entries', () => {
  const ids = ENTRY_POOL.map(e => e.id).sort();
  assert.deepStrictEqual(ids, [
    'chef-drop-brief', 'claudejob', 'cloudguard', 'denari', 'enidus',
    'goodenough', 'gspann', 'mcp-census', 'orahi',
  ]);
});

test('Enidus is pinned and default', () => {
  const e = poolById('enidus');
  assert.strictEqual(e.pinned, true);
  assert.strictEqual(e.default, true);
  assert.strictEqual(e.kind, 'experience');
});

test('GSPANN is benched (default false) but eligible and tagged for ML', () => {
  const g = poolById('gspann');
  assert.strictEqual(g.default, false);
  assert.notStrictEqual(g.eligible, false);
  assert.ok(g.tags.includes('pytorch') && g.tags.includes('cnn') && g.tags.includes('model training'));
});

test('Denari is a default project now, tagged for retrieval', () => {
  const d = poolById('denari');
  assert.strictEqual(d.default, true);
  assert.notStrictEqual(d.eligible, false);
  assert.ok(d.tags.includes('rag') && d.tags.includes('bm25') && d.tags.includes('vector search'));
});

test('ClaudeJob is benched (default false) but selectable', () => {
  const c = poolById('claudejob');
  assert.strictEqual(c.default, false);
  assert.notStrictEqual(c.eligible, false);
});

test('GoodEnough is a default project (status ready)', () => {
  const ge = poolById('goodenough');
  assert.strictEqual(ge.default, true);
  assert.strictEqual(ge.status, 'ready');
  assert.strictEqual(ge.kind, 'project');
  // The apparatus (number-free) bullet set is retained for the honesty mechanism.
  assert.ok(Array.isArray(ge.bulletsByStatus.apparatus) && ge.bulletsByStatus.apparatus.length >= 1);
});

test('mcp-census is planned and eligible:false', () => {
  const m = poolById('mcp-census');
  assert.strictEqual(m.status, 'planned');
  assert.strictEqual(m.eligible, false);
});

test('MAX_PROJECT_ENTRIES is 3', () => {
  assert.strictEqual(MAX_PROJECT_ENTRIES, 3);
});

// ── Part 2: status gating ────────────────────────────────────────────────────
console.log('\nPart 2: status gating:');

test('status gating mechanism: forcing GoodEnough to apparatus emits only apparatus bullets', () => {
  // The apparatus/ready gate still works even though the live default now ships
  // the ready bullets.
  const pool = clone(ENTRY_POOL);
  const ge = pool.find(e => e.id === 'goodenough');
  ge.status = 'apparatus';
  const { json } = selectEntries(pool, [], '', Infinity);
  const rendered = projItems(json).find(i => /GoodEnough/i.test(i.title));
  assert.deepStrictEqual(rendered.bullets, ge.bulletsByStatus.apparatus);
});

test('apparatus bullet set claims no numeric results (honesty gate preserved)', () => {
  const ge = poolById('goodenough');
  for (const b of ge.bulletsByStatus.apparatus) {
    assert.ok(!/\d+\s*%|\bp50\b|\d+x\b|\d+\s*ms\b/i.test(b),
      'apparatus bullet leaked a result-shaped number: ' + b);
  }
});

test('GoodEnough ready bullets carry the real numbers and no leftover XX placeholders', () => {
  const ge = poolById('goodenough');
  const joined = ge.bulletsByStatus.ready.join(' ');
  assert.ok(/10-point margin/i.test(joined), 'the real 10-point non-inferiority margin must be stated');
  assert.ok(/8 MMLU/i.test(joined) && /GSM8K/i.test(joined), 'benchmarks must be 8 MMLU domains + GSM8K');
  assert.ok(!/\[[^\]]*\]|\bXX\b/.test(joined), 'no leftover [..]/XX placeholders may remain: ' + joined);
});

test('GoodEnough latency claim points the RIGHT way (local is slower, not faster)', () => {
  // Corrected 2026-08-06: local CPU is far slower than the hosted Groq API. A
  // bullet claiming local has LOWER/faster latency would be backwards.
  const ge = poolById('goodenough');
  const joined = ge.bulletsByStatus.ready.join(' ');
  assert.ok(/higher p50 latency/i.test(joined), 'must state local has HIGHER p50 latency');
  assert.ok(!/lower p50 latency|faster.*local|local.*faster/i.test(joined),
    'must not claim local is faster / lower-latency: ' + joined);
});

test('default resume ships the GoodEnough ready bullets', () => {
  const ge = poolById('goodenough');
  const rendered = projItems(RESUME_BASE_JSON).find(i => /GoodEnough/i.test(i.title));
  assert.deepStrictEqual(rendered.bullets, ge.bulletsByStatus.ready);
});

test('flipping GoodEnough to ready emits ready bullets', () => {
  const pool = clone(ENTRY_POOL);
  const ge = pool.find(e => e.id === 'goodenough');
  ge.status = 'ready';
  const { json } = selectEntries(pool, [], '', Infinity);
  const rendered = projItems(json).find(i => /GoodEnough/i.test(i.title));
  assert.deepStrictEqual(rendered.bullets, ge.bulletsByStatus.ready);
});

test('planned mcp-census is never selected even when every tag matches', () => {
  const m = poolById('mcp-census');
  const { json, selected } = selectEntries(ENTRY_POOL, m.tags, m.tags.join(' ') + ' ' + (m.item && m.item.title || ''), Infinity);
  assert.ok(!projTitles(json).some(t => /census/i.test(t)), 'mcp-census must not render');
  assert.ok(!selected.some(s => s.id === 'mcp-census'), 'mcp-census must not be selected');
});

// ── Part 3: the selector ─────────────────────────────────────────────────────
console.log('\nPart 3: deterministic selectEntries:');

test('selectEntries is deterministic (same inputs -> deep-equal outputs)', () => {
  const a = selectEntries(ENTRY_POOL, RAG_JD.skills, RAG_JD.text, BASE_BULLET_CHAR_BUDGET);
  const b = selectEntries(ENTRY_POOL, RAG_JD.skills, RAG_JD.text, BASE_BULLET_CHAR_BUDGET);
  assert.deepStrictEqual(a.json, b.json);
  assert.deepStrictEqual(a.selected, b.selected);
  assert.deepStrictEqual(a.dropped, b.dropped);
});

test('returns {json, selected, dropped} with reasons', () => {
  const r = selectEntries(ENTRY_POOL, RAG_JD.skills, RAG_JD.text, BASE_BULLET_CHAR_BUDGET);
  assert.ok(r.json && Array.isArray(r.selected) && Array.isArray(r.dropped));
  for (const s of r.selected) {
    assert.ok(typeof s.id === 'string' && typeof s.reason === 'string' && typeof s.score === 'number');
  }
  for (const d of r.dropped) {
    assert.ok(typeof d.id === 'string' && typeof d.reason === 'string');
  }
});

test('GSPANN IS selected for an ML/PyTorch/CNN/model-training JD', () => {
  const { json, selected } = selectEntries(ENTRY_POOL, ML_JD.skills, ML_JD.text, BASE_BULLET_CHAR_BUDGET);
  assert.ok(expTitles(json).some(t => /GSPANN/.test(t)), 'GSPANN should render for ML JD');
  assert.ok(selected.some(s => s.id === 'gspann'));
});

test('GSPANN is NOT selected for a backend JD', () => {
  const { json } = selectEntries(ENTRY_POOL, BACKEND_JD.skills, BACKEND_JD.text, BASE_BULLET_CHAR_BUDGET);
  assert.ok(!expTitles(json).some(t => /GSPANN/.test(t)));
});

test('Denari is a default project and stays on for a RAG JD', () => {
  const { json } = selectEntries(ENTRY_POOL, RAG_JD.skills, RAG_JD.text, BASE_BULLET_CHAR_BUDGET);
  assert.ok(projTitles(json).some(t => /Denari/i.test(t)), 'Denari should render for RAG JD: ' + projTitles(json).join(' | '));
  assert.ok(projTitles(RESUME_BASE_JSON).some(t => /Denari/i.test(t)), 'Denari should be on the default resume');
  assert.ok(projItems(json).length <= 3, 'projects capped at 3');
});

test('a benched project (ClaudeJob) swaps in for a matching JD, displacing a default', () => {
  const CJ_JD = {
    skills: ['structured outputs', 'SSE', 'validators', 'pipeline', 'Node.js'],
    text: 'Build agentic pipelines with structured outputs and SSE streaming, plus validator suites in Node.js.',
  };
  const { json, selected, dropped } = selectEntries(ENTRY_POOL, CJ_JD.skills, CJ_JD.text, BASE_BULLET_CHAR_BUDGET);
  assert.ok(projTitles(json).some(t => /ClaudeJob/.test(t)), 'ClaudeJob should swap in: ' + projTitles(json).join(' | '));
  assert.ok(projItems(json).length <= MAX_PROJECT_ENTRIES, 'projects within cap');
  assert.ok(selected.some(s => s.id === 'claudejob'), 'ClaudeJob selected');
  // At least one default project yielded its slot to the benched swap-in.
  const defaultProjIds = ENTRY_POOL.filter(e => e.kind === 'project' && e.default).map(e => e.id);
  assert.ok(dropped.some(d => defaultProjIds.includes(d.id)), 'a default project was displaced');
});

test('never more than MAX_PROJECT_ENTRIES projects on any JD (incl. all-tags JD)', () => {
  const allTags = ENTRY_POOL.flatMap(e => e.tags || []);
  const jds = [RAG_JD, ML_JD, BACKEND_JD, { skills: allTags, text: allTags.join(' ') }];
  for (const jd of jds) {
    const { json } = selectEntries(ENTRY_POOL, jd.skills, jd.text, BASE_BULLET_CHAR_BUDGET);
    assert.ok(projItems(json).length <= MAX_PROJECT_ENTRIES,
      'too many projects: ' + projTitles(json).join(' | '));
  }
});

test('at most MAX_NON_DEFAULT_SWAPS non-default entries swapped in per run', () => {
  const allTags = ENTRY_POOL.flatMap(e => e.tags || []);
  const { selected } = selectEntries(ENTRY_POOL, allTags, allTags.join(' '), BASE_BULLET_CHAR_BUDGET);
  const defaultIds = new Set(ENTRY_POOL.filter(e => e.default || e.pinned).map(e => e.id));
  const swapIns = selected.filter(s => !defaultIds.has(s.id));
  assert.ok(swapIns.length <= MAX_NON_DEFAULT_SWAPS,
    'too many swaps: ' + swapIns.map(s => s.id).join(', '));
});

test('selection never exceeds the char budget on the three JD shapes', () => {
  for (const jd of [RAG_JD, ML_JD, BACKEND_JD]) {
    const { json } = selectEntries(ENTRY_POOL, jd.skills, jd.text, BASE_BULLET_CHAR_BUDGET);
    assert.ok(sumBulletChars(json) <= BASE_BULLET_CHAR_BUDGET,
      `budget exceeded (${sumBulletChars(json)} > ${BASE_BULLET_CHAR_BUDGET})`);
  }
});

test('pinned Enidus is never dropped even under extreme budget pressure', () => {
  const { json, selected } = selectEntries(ENTRY_POOL, [], '', 1);
  assert.ok(expTitles(json).some(t => /Enidus/.test(t)), 'Enidus must survive budget pressure');
  assert.ok(selected.some(s => s.id === 'enidus'));
});

test('experience stays in chronological order regardless of score', () => {
  const { json } = selectEntries(ENTRY_POOL, ML_JD.skills, ML_JD.text, BASE_BULLET_CHAR_BUDGET);
  const titles = expTitles(json);
  const idxEnidus = titles.findIndex(t => /Enidus/.test(t));
  const idxOrahi = titles.findIndex(t => /Orahi/.test(t));
  const idxGspann = titles.findIndex(t => /GSPANN/.test(t));
  assert.ok(idxEnidus < idxOrahi && idxOrahi < idxGspann, 'order: ' + titles.join(' | '));
});

// ── Part 4: publication schema only ──────────────────────────────────────────
console.log('\nPart 4: publication schema (no section built):');

test("'publication' is a valid entry kind", () => {
  assert.strictEqual(isValidEntryKind('publication'), true);
  assert.strictEqual(isValidEntryKind('experience'), true);
  assert.strictEqual(isValidEntryKind('project'), true);
  assert.strictEqual(isValidEntryKind('nonsense'), false);
});

test('no publications section is rendered today', () => {
  assert.ok(!(RESUME_BASE_JSON.sections || []).some(s => s.type === 'publications' || s.type === 'publication'));
});

test('a publication pool entry does not crash the selector and does not render', () => {
  const pool = clone(ENTRY_POOL);
  pool.push({
    id: 'neurips-workshop', kind: 'publication', status: 'planned', default: false,
    pinned: false, eligible: false, tags: ['ml'], weight: 0,
    item: { title: 'Workshop paper (in progress)', bullets: [] },
  });
  const { json } = selectEntries(pool, [], '', Infinity);
  assert.ok(!(json.sections || []).some(s => /publication/i.test(s.type)));
});

// ── Part 5: skills balancing ─────────────────────────────────────────────────
console.log('\nPart 5: skills balancing:');

const skillItems = () => sec(RESUME_BASE_JSON, 'skills').items;
const lineLen = (it) => `${it.label}: ${it.value}`.length;

test('exactly four skill groups, no proficiency labels', () => {
  const items = skillItems();
  assert.strictEqual(items.length, 4);
  for (const it of items) {
    assert.ok(!/\b(expert|advanced|intermediate|beginner|proficient|\d+\s*years?)\b/i.test(it.value),
      'proficiency label leaked: ' + it.value);
  }
});

test('the four lines are within ~15% of each other in length', () => {
  const lens = skillItems().map(lineLen);
  const max = Math.max(...lens), min = Math.min(...lens);
  assert.ok(max / min <= 1.16, `lines not balanced: ${lens.join(', ')} (ratio ${(max / min).toFixed(2)})`);
});

test('the block does not open with the longest line', () => {
  const lens = skillItems().map(lineLen);
  assert.ok(lens[0] < Math.max(...lens), `first line is the longest: ${lens.join(', ')}`);
});

test('every ADJACENCY_MAP justifier still present in skills (no path removed)', () => {
  const JUSTIFIERS = ['aws s3', 'claude code', 'django', 'docker', 'express', 'fastapi',
    'flask', 'git', 'grpc', 'node.js', 'postgresql', 'python', 'pytorch', 'qdrant',
    'rag', 'react', 'sql', 'tool calling', 'vector search'];
  const skills = extractUserSkills(RESUME_BASE_JSON);
  for (const j of JUSTIFIERS) {
    assert.ok(skills.has(j), `justifier "${j}" missing from skills after rebalance`);
  }
});

// ── summary ──────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFailed tests:');
  for (const f of failures) console.log(`  ✗ ${f.name}: ${f.error}`);
}
console.log('');
process.exit(failed > 0 ? 1 : 0);
