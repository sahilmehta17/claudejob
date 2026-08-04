// ═════════════════════════════════════════════════════════════════════════════
// checks.js: shared fabrication checks used by BOTH the bullet validator and the
// cover-letter validator, so the two surfaces cannot drift.
//
// Three reusable checks (all truth-bounded against CANDIDATE_FACTS + the base):
//   checkCapabilityInjection      capability/keyword injection (deterministic)
//   checkDirectionalInversion     reversed decision/architecture/migration (LLM-judge)
//   checkMetricContamination      metric attached to the wrong project (deterministic)
//
// Plus the primitives they need (allowlist builder, project classifier, tech
// recognizer). Extracted from routes/ai.js with no behavior change for bullets.
// ═════════════════════════════════════════════════════════════════════════════

const { SYNONYM_MAP, FACT_FRAGMENT_MAP } = require('./resumeContent');

// TECH_VOCAB: a small recognizer of known tools/languages/frameworks/acronyms.
// Its ONLY job is deciding which words in a piece of text are candidate
// technical terms worth checking against the allowlist. A term appearing here
// that is genuinely on the base resume or in CANDIDATE_FACTS is still allowed
// (the allowlist covers it); TECH_VOCAB just guarantees we NOTICE it. Keep it
// broad on the fabrication-prone side (languages/tools a JD might tempt the LLM
// to bolt on) and lowercase. Extraction also picks up ALLCAPS acronyms and
// alphanumeric identifiers, so acronyms need not all be enumerated here.
const TECH_VOCAB = new Set([
  // languages the resume does NOT claim (prime injection candidates)
  'go', 'golang', 'rust', 'ruby', 'php', 'scala', 'elixir', 'erlang', 'perl',
  'c++', 'c#', 'objective-c', 'haskell', 'clojure', 'lua', 'dart', 'groovy',
  // languages the resume DOES claim (allowlist will cover them)
  'python', 'typescript', 'javascript', 'java', 'kotlin', 'swift', 'sql',
  // infra / orchestration
  'kubernetes', 'k8s', 'terraform', 'ansible', 'pulumi', 'helm', 'nomad',
  'docker', 'podman', 'jenkins', 'circleci', 'argocd', 'istio',
  // cloud
  'aws', 'gcp', 'azure', 's3', 'lambda', 'ec2', 'dynamodb', 'bigquery',
  'redshift', 'snowflake', 'databricks',
  // datastores / streaming
  'postgresql', 'postgres', 'mysql', 'sqlite', 'mongodb', 'cassandra', 'redis',
  'elasticsearch', 'kafka', 'rabbitmq', 'spark', 'hadoop', 'flink', 'airflow',
  'timescaledb', 'sql server',
  // vector / ml
  'qdrant', 'pinecone', 'weaviate', 'chroma', 'chromadb', 'milvus', 'pgvector',
  'faiss', 'pytorch', 'tensorflow', 'keras', 'scikit-learn', 'numpy', 'pandas',
  'huggingface', 'sentence-transformers', 'bm25', 'tf-idf', 'rrf',
  // web frameworks
  'fastapi', 'flask', 'django', 'express', 'nestjs', 'react', 'angular', 'vue',
  'svelte', 'next.js', 'nextjs', 'node.js', 'nodejs', 'graphql', 'grpc', 'rest',
  'spring', 'rails', 'laravel', '.net', 'dotnet',
  // llm / agent stack
  'langchain', 'langgraph', 'llamaindex', 'mcp', 'pydantic', 'anthropic', 'openai',
  // multi-word tech phrases the validator should recognize as a unit
  'vector search', 'row-level security', 'reciprocal rank fusion', 'semantic search',
  'rest apis', 'tool calling', 'function-calling', 'hybrid retrieval', 'vector database',
]);

// METRIC_OWNERSHIP: each distinctive metric mapped to the project that earned
// it. If a metric appears attached to a different project, that is
// contamination. Metrics are enumerable, so a deterministic map beats an LLM.
// `context` (optional) requires a co-occurring word so a bare number shared
// across projects (e.g. a lone "9") does not false-flag. Owner keys match the
// classifyProject() vocabulary. Kept conservative and true to CANDIDATE_FACTS.
const METRIC_OWNERSHIP = [
  { num: '40%',   context: 'latency',  owner: 'capstone' }, // Denari capstone
  { num: '73%',   context: 'accuracy', owner: 'capstone' }, // 73% QA accuracy
  { num: '22K+',  owner: 'capstone' },
  { num: '300K+', owner: 'capstone' },
  { num: '80%',   context: 'student',  owner: 'orahi' },
  { num: '73.5%', owner: 'copilot' },  // intent top-1 accuracy climb
  { num: '89.0%', owner: 'copilot' },
  { num: '442',   owner: 'copilot' },  // 442-query eval corpus
  { num: '97%',   context: 'accuracy', owner: 'gspann' },
];

// Project keyword patterns for PROSE contamination detection (cover letters),
// where a bullet's structural project is unknown and must be inferred from the
// words near the metric. Mirrors the classifyProject() vocabulary.
const PROJECT_KEYWORDS = {
  copilot:    /copilot|chatbot|agentic|assistant|reseller|t-mobile/i,
  reports:    /reports|dashboard|analytics/i,
  bff:        /carrier api|\bbff\b|gateway/i,
  orahi:      /orahi|bus route|student-assignment/i,
  gspann:     /gspann|pneumonia|chest x-ray/i,
  capstone:   /denari|capstone|22k|300k/i,
  cloudguard: /cloudguard/i,
  claudejob:  /claudejob/i,
};

// ── small text utilities ──────────────────────────────────────────────────
function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
// Normalize one raw word: lowercase, strip surrounding punctuation, keep the
// internal punctuation that makes a token what it is (node.js, row-level,
// aes-256-cbc). Used identically for the allowlist and for extraction so the
// two can never drift.
function normWord(w) {
  return String(w).toLowerCase().replace(/^[^a-z0-9]+/, '').replace(/[^a-z0-9]+$/, '');
}
function normText(t) {
  return String(t).toLowerCase().replace(/\s+/g, ' ').trim();
}
// A whole-word (phrase) occurrence test that treats hyphens as word chars so
// "go" does not match inside "Django" and "rest apis" matches "REST APIs".
function containsTerm(text, term) {
  return new RegExp('(?<![\\w-])' + escapeRegex(term) + '(?![\\w-])', 'i').test(text);
}

// Classify which project a bullet belongs to from its surrounding titles.
function classifyProject(item, sub, projItem) {
  const hay = [item && item.title, item && item.role, sub && sub.name, projItem && projItem.title]
    .filter(Boolean).join(' ').toLowerCase();
  if (/orahi/.test(hay)) return 'orahi';
  if (/gspann/.test(hay)) return 'gspann';
  if (/cloudguard/.test(hay)) return 'cloudguard';
  if (/claudejob/.test(hay)) return 'claudejob';
  if (/denari|capstone/.test(hay)) return 'capstone';
  if (/carrier api|bff|gateway/.test(hay)) return 'bff';
  if (/reports|dashboard|analytics/.test(hay)) return 'reports';
  if (/copilot|chatbot|agentic|assistant/.test(hay)) return 'copilot';
  if (/enidus/.test(hay)) return 'enidus';
  return 'unknown';
}

// Walk every experience + projects bullet in canonical order. Each descriptor
// carries the bullet text, its project, an ordinal within that project, and a
// setter that mutates the bullet in place inside `json` (callers pass a clone,
// never the base). Skills/contact/name are never touched here.
function collectBullets(json) {
  const out = [];
  const ordc = {};
  const push = (text, project, setter) => {
    const ordinal = ordc[project] == null ? 0 : ordc[project];
    ordc[project] = ordinal + 1;
    out.push({ index: out.length, text, project, ordinal, set: setter });
  };
  for (const section of json.sections || []) {
    if (section.type === 'experience') {
      for (const item of section.items || []) {
        for (const sub of item.subsections || []) {
          const arr = sub.bullets || [];
          const project = classifyProject(item, sub, null);
          arr.forEach((b, i) => push(b, project, (nv) => { arr[i] = nv; }));
        }
      }
    } else if (section.type === 'projects') {
      for (const item of section.items || []) {
        const arr = item.bullets || [];
        const project = classifyProject(null, null, item);
        arr.forEach((b, i) => push(b, project, (nv) => { arr[i] = nv; }));
      }
    }
  }
  return out;
}

function groupBaseBullets(baseJson) {
  const g = {};
  for (const d of collectBullets(baseJson)) (g[d.project] = g[d.project] || []).push(d.text);
  return g;
}

// Build the deterministic allowlist: 1/2/3-grams from CANDIDATE_FACTS + every
// base bullet + every base skills line. Fact fragments are intentionally NOT
// dumped in here; they are topic-scoped and handled in isTermCovered().
function buildBulletAllowlist(baseJson, candidateFacts) {
  const set = new Set();
  const add = (textVal) => {
    const words = String(textVal).split(/\s+/).map(normWord).filter(Boolean);
    for (let i = 0; i < words.length; i++) {
      set.add(words[i]);
      if (i + 1 < words.length) set.add(words[i] + ' ' + words[i + 1]);
      if (i + 2 < words.length) set.add(words[i] + ' ' + words[i + 1] + ' ' + words[i + 2]);
    }
  };
  for (const d of collectBullets(baseJson)) add(d.text);
  const skills = (baseJson.sections || []).find(s => s.type === 'skills');
  if (skills) for (const it of skills.items || []) add(it.value);
  add(candidateFacts);
  return set;
}

// The set of terms extraction should look for as whole phrases (single or
// multi-word): TECH_VOCAB plus every synonym key and fact-fragment key.
const KNOWN_TERMS = new Set([
  ...TECH_VOCAB,
  ...Object.keys(SYNONYM_MAP || {}),
  ...Object.keys(FACT_FRAGMENT_MAP || {}),
]);

// Extract candidate technical terms from a piece of text: KNOWN_TERMS phrase
// hits, plus ALLCAPS acronyms and alphanumeric identifiers (e.g. RS256,
// AES-256-CBC). Heuristic by design; it prefers to over-extract because the
// allowlist filters out everything the candidate legitimately has.
function extractTechTerms(text) {
  const found = new Set();
  for (const term of KNOWN_TERMS) {
    if (containsTerm(text, term)) found.add(term);
  }
  for (const w of String(text).split(/\s+/)) {
    const bare = w.replace(/^[^A-Za-z0-9]+/, '').replace(/[^A-Za-z0-9+#.-]+$/, '');
    if (/^[A-Z]{2,}$/.test(bare) || (/[A-Za-z]/.test(bare) && /\d/.test(bare))) {
      found.add(bare.toLowerCase());
    }
  }
  return [...found];
}

// PROSE_AMBIGUOUS_TERMS: TECH_VOCAB entries that double as ordinary English
// words (verbs/nouns a cover letter is likely to use with zero technical
// intent: "go deep", "off the rails", "spark my interest", "at the helm",
// "digital nomad", "look forward to spring"). None of these are on the
// candidate's real stack, so exempting them costs no real detection value;
// left un-exempted they reliably false-positive on ordinary prose. Bullet
// validation (project != null) is untouched — bullets are terse/technical
// and don't carry this ambiguity the same way.
const PROSE_AMBIGUOUS_TERMS = new Set(['go', 'rails', 'spring', 'spark', 'helm', 'nomad']);

// Is a candidate term traceable? Global allowlist wins; else a synonym is
// allowed only when the text ALSO carries one of its mapped base terms; else a
// fact fragment is allowed on its mapped topic (`project`) — or, in prose mode
// (project === null, i.e. cover letters), unconditionally, since `topics`
// only restricts which BULLET a fragment may render on and prose has no
// bullet to misattribute it to; the fragment itself is always a true,
// candidate-fact-backed claim by construction. Ambiguous common-English terms
// are also exempted in prose mode only.
function isTermCovered(term, text, project, allowSet) {
  if (allowSet.has(term)) return true;
  if (project === null && PROSE_AMBIGUOUS_TERMS.has(term)) return true;
  const syn = SYNONYM_MAP && SYNONYM_MAP[term];
  if (syn && syn.some(base => containsTerm(text, base))) return true;
  const frag = FACT_FRAGMENT_MAP && FACT_FRAGMENT_MAP[term];
  if (frag) {
    if (project === null) return true;
    if (Array.isArray(frag.topics) && frag.topics.includes(project)) return true;
  }
  return false;
}

// Heuristic: does this text describe a decision / architecture / migration
// whose DIRECTION could be reversed? Only these get the LLM-judge pass.
function isDirectionalBullet(text) {
  return /\binvert|inversion|lexical-first|vector-first|\bmigrat|routing architecture|architecture inversion|reversed|\bpivot/i.test(text);
}

// ── the three shared checks ─────────────────────────────────────────────────
// Each returns an array of flag objects: { check, reason, text, project?, term? }.

// Check: capability/keyword injection (deterministic). Flags any candidate tech
// term not traceable to the allowlist / synonym / fragment coverage.
function checkCapabilityInjection(text, opts = {}) {
  const { project = null, allowSet } = opts;
  const flags = [];
  for (const term of extractTechTerms(text)) {
    if (!isTermCovered(term, text, project, allowSet)) {
      flags.push({
        check: 'injection', project, term, text,
        reason: `technical term "${term}" is not traceable to CANDIDATE_FACTS or the base resume`,
      });
    }
  }
  return flags;
}

// Check: cross-project metric contamination (deterministic).
// Bullet mode (project provided): flag a metric whose owner differs from the
// bullet's project. Prose mode (project null, cover letters): flag a metric
// whose window names a different project than its owner (and not the owner).
function checkMetricContamination(text, opts = {}) {
  const { project = null } = opts;
  const flags = [];

  if (project != null) {
    for (const rule of METRIC_OWNERSHIP) {
      const numRe = new RegExp('(?<![\\d.])' + escapeRegex(rule.num));
      if (!numRe.test(text)) continue;
      if (rule.context && !new RegExp(escapeRegex(rule.context), 'i').test(text)) continue;
      if (project !== rule.owner) {
        flags.push({
          check: 'contamination', project, term: rule.num, text,
          reason: `metric "${rule.num}"${rule.context ? ` (${rule.context})` : ''} belongs to ${rule.owner}, not ${project}`,
        });
      }
    }
    return flags;
  }

  // Prose mode: inspect a window around each metric occurrence.
  for (const rule of METRIC_OWNERSHIP) {
    const re = new RegExp('(?<![\\d.])' + escapeRegex(rule.num), 'gi');
    let m;
    while ((m = re.exec(text)) !== null) {
      const start = Math.max(0, m.index - 140);
      const end = Math.min(text.length, m.index + String(rule.num).length + 140);
      const win = text.slice(start, end);
      if (rule.context && !new RegExp(escapeRegex(rule.context), 'i').test(win)) continue;
      const ownerRe = PROJECT_KEYWORDS[rule.owner];
      if (ownerRe && ownerRe.test(win)) continue; // correctly attributed nearby
      const wrong = Object.keys(PROJECT_KEYWORDS)
        .find(p => p !== rule.owner && PROJECT_KEYWORDS[p].test(win));
      if (wrong) {
        flags.push({
          check: 'contamination', project: wrong, term: rule.num, text,
          reason: `metric "${rule.num}"${rule.context ? ` (${rule.context})` : ''} belongs to ${rule.owner}, not ${wrong}`,
        });
        break; // one flag per rule is enough
      }
    }
  }
  return flags;
}

// Check: directional inversion (LLM-judge). `judge(text, candidateFacts)` must
// resolve to { verdict: 'PASS'|'FAIL', reason }. `gate` (optional) restricts the
// judge to texts that look directional (used for bullets); pass null to always
// judge (used for cover letters). Non-fatal: a thrown judge degrades to PASS.
async function checkDirectionalInversion(text, opts = {}) {
  const { candidateFacts, judge, gate = null } = opts;
  if (typeof judge !== 'function') return [];
  if (gate && !gate(text)) return [];
  try {
    const verdict = await judge(text, candidateFacts);
    if (verdict && String(verdict.verdict).toUpperCase() === 'FAIL') {
      return [{ check: 'inversion', text, reason: verdict.reason || 'directional claim contradicts CANDIDATE_FACTS' }];
    }
  } catch (e) {
    console.warn('[checks] inversion judge threw (non-fatal):', e.message);
  }
  return [];
}

module.exports = {
  TECH_VOCAB,
  PROSE_AMBIGUOUS_TERMS,
  METRIC_OWNERSHIP,
  PROJECT_KEYWORDS,
  escapeRegex,
  normWord,
  normText,
  containsTerm,
  classifyProject,
  collectBullets,
  groupBaseBullets,
  buildBulletAllowlist,
  extractTechTerms,
  isTermCovered,
  isDirectionalBullet,
  checkCapabilityInjection,
  checkMetricContamination,
  checkDirectionalInversion,
};
