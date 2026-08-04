const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const router = express.Router();
const { RESUME_BASE_JSON, CANDIDATE_FACTS, renderResumeText, applyAdjacency, sumBulletChars, BASE_BULLET_CHAR_BUDGET, SYNONYM_MAP, FACT_FRAGMENT_MAP } = require('./resumeContent');
const { saveApplicationBundle } = require('./saveBundle');
const { runChecks: runBundleChecks } = require('../scripts/validate');
// Shared fabrication checks (Fix 3), consumed by the bullet validator and the
// cover-letter validator so the two surfaces cannot drift.
const {
  TECH_VOCAB,
  METRIC_OWNERSHIP,
  normText,
  normWord,
  collectBullets,
  groupBaseBullets,
  buildBulletAllowlist,
  isDirectionalBullet,
  checkCapabilityInjection,
  checkMetricContamination,
  checkDirectionalInversion,
} = require('./checks');

// ─────────────────────────────────────────────────────────────────────────────
// Tailoring char budget — carries a SAFETY MARGIN below the base's actual
// 1-page char count (BASE_BULLET_CHAR_BUDGET). The base fills the page's line
// budget almost exactly, and per-JD tailoring GROWS the skills section
// (deterministic adjacency injection appends JD skills, and the model expands /
// renames categories), which adds 1-2 lines the base doesn't carry. If tailored
// bullets are allowed up to the base's full char count, that extra skills height
// spills to page 2 and the whole tailoring is discarded (fallback to base).
// Capping tailored bullets ~10% under the base reserves those lines for skills.
// Tune these three multipliers if the fallback still fires or pages underfill.
// ─────────────────────────────────────────────────────────────────────────────
const TAILOR_CHAR_CAP = Math.round(BASE_BULLET_CHAR_BUDGET * 0.90);    // hard max shown to the model
const TAILOR_CHAR_TARGET = Math.round(BASE_BULLET_CHAR_BUDGET * 0.85); // aim-for middle of the window
const TAILOR_CHAR_MIN = Math.round(BASE_BULLET_CHAR_BUDGET * 0.80);    // below this the page reads sparse

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─────────────────────────────────────────────────────────────────────────────
// SAHIL'S BASE RESUME — source of truth for all AI tailoring
// JSON content lives in resumeContent.js. We derive the plain-text version here
// for the LLM prompt context, the frontend diff display, and the validators.
// PDF generation goes JSON → Python (generate_resume.py), never text → PDF.
// ─────────────────────────────────────────────────────────────────────────────
const RESUME_BASE = renderResumeText(RESUME_BASE_JSON);


// ─────────────────────────────────────────────────────────────────────────────
// RESUME GUARDRAILS — banned phrases and validation
// ─────────────────────────────────────────────────────────────────────────────
const BANNED_RESUME_PHRASES = [
  'leveraged', 'spearheaded', 'utilized', 'results-driven', 'dynamic professional',
  'passionate about', 'excited to bring', 'proven track record', 'cutting-edge',
  'synergized', 'revolutionized', 'transformative', 'game-changing', 'best-in-class',
  'thought leader', 'self-starter', 'go-getter', 'team player',
  'drove innovation', 'deep expertise', 'unparalleled', 'world-class',
  'highly motivated', 'detail-oriented professional', 'results-oriented',
  'passionate engineer', 'seasoned professional', 'extensive experience',
  'unique ability', 'strong communicator', 'thrive in fast-paced',
  'hit the ground running', 'paradigm shift', 'ecosystem',
  'stakeholder alignment', 'cross-functional synergy',
];

const RESUME_BANNED_REGEX = new RegExp(
  BANNED_RESUME_PHRASES.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
  'gi'
);

// Source facts extracted from RESUME_BASE for validation
const SOURCE_FACTS = {
  numbers: ['80%', '15%', '10%', '97%', '22K+', '300K+', '73%', '73.5%', '89.0%',
            '70%+', '40%', '25+', '52', '442',
            '8 RBAC', '4 Qdrant', '6-intent', '9 SQL', '6 field', '3-layer', '100%',
            '100+', '53-intent', '43', '20', '6.2K', '15K', '3 tokens', '10+', '30+',
            '60 seconds', 'RS256', 'HS256', 'PIL', 'Next.js 16', 'React 19'],
  companies: ['Enidus USA', 'Orahi', 'GSPANN', 'Denari', 'T-Mobile'],
  tools: ['Node.js', 'Express', 'Angular', 'FastAPI', 'GPT-4o-mini', 'Qdrant',
          'TypeScript', 'TimescaleDB', 'Docker', 'S3', 'OpenAI', 'Flask',
          'React', 'Next.js', 'Vite', 'Tailwind', 'Pydantic',
          'SQL Server', 'PostgreSQL', 'Axios', 'K-means',
          'BM25', 'TF-IDF', 'PyTorch', 'TensorFlow', 'Keras', 'Scikit-learn',
          'Apache Spark', 'Hadoop', 'Kafka', 'Pandas', 'NumPy',
          'Python', 'Java', 'JavaScript', 'C', 'Kotlin', 'Swift', 'R',
          'GraphQL', 'REST', 'gRPC', 'AWS', 'AWS S3', 'Git', 'Bash', 'Postman', 'JIRA',
          'JWT', 'OAuth', 'PoP', 'node:test',
          'Reciprocal Rank Fusion', 'Cohere', 'Voyage'],
};

/**
 * Validate resume output against guardrails.
 * Returns { valid: boolean, warnings: string[], bannedFound: string[] }
 */
function validateResumeOutput(resumeText) {
  const warnings = [];
  const bannedFound = [];

  if (!resumeText || resumeText.trim().length < 200) {
    warnings.push('Resume output is suspiciously short (< 200 chars)');
    return { valid: false, warnings, bannedFound };
  }

  // Check for banned phrases
  const matches = resumeText.match(RESUME_BANNED_REGEX);
  if (matches) {
    const unique = [...new Set(matches.map(m => m.toLowerCase()))];
    bannedFound.push(...unique);
    warnings.push(`Contains banned AI-resume phrases: ${unique.join(', ')}`);
  }

  // Em-dash / en-dash guard. These are a strong AI-writing tell and are
  // prohibited in resume output. The prompt bans them, but the LLM occasionally
  // slips one in, so flag it here as a hard fail the UI can surface.
  const dashMatches = resumeText.match(/[—–]/g);
  if (dashMatches) {
    warnings.push(`Contains em/en-dashes (${dashMatches.length}) — prohibited as an AI tell; replace with colon/semicolon/comma/period`);
  }

  // Check that core sections exist.
  // Match the section name as a whole word against the raw (case-sensitive) text:
  // headers are rendered in uppercase, body values are mixed-case, so this
  // cleanly separates a real header from incidental matches like "Claude Skills"
  // inside a skill-line value.
  const requiredSections = ['EDUCATION', 'PROFESSIONAL EXPERIENCE', 'SKILLS'];
  for (const section of requiredSections) {
    if (!new RegExp(`\\b${section}\\b`).test(resumeText)) {
      warnings.push(`Missing expected section: ${section}`);
    }
  }

  // Check that key facts are preserved (at least some numbers should match)
  const numbersPresent = SOURCE_FACTS.numbers.filter(n => resumeText.includes(n));
  if (numbersPresent.length < 3) {
    warnings.push(`Only ${numbersPresent.length} of ${SOURCE_FACTS.numbers.length} source numbers preserved — possible fabrication`);
  }

  // Check for numbers not in source (possible fabrication)
  // Regex captures: decimal percentages with optional trailing + (e.g. 73.5%, 70%+),
  // K-shorthand (22K+), and bare numeric + (25+, 100+). Decimal handling added when
  // the ARIA bullets introduced 73.5% / 89.0% / 70%+ as source-of-truth facts.
  //
  // Fix 4: normalize spelled percents to the symbol form before comparing, so a
  // real number written differently in source vs output stops false-flagging.
  // The base writes "0 percent" (CloudGuard bullet); the tailored output may
  // write "0%". Normalize both, and seed the source set with any "N percent"/
  // "N%" that appears in the base text itself, not just the hardcoded list.
  const normalizePct = (s) => String(s).replace(/(\d+(?:\.\d+)?)\s*percent\b/gi, '$1%');
  const baseNums = (RESUME_BASE.match(/\d+(?:\.\d+)?\s*percent|\d+(?:\.\d+)?%\+?/gi) || []).map(normalizePct);
  const sourceNumberSet = new Set([...SOURCE_FACTS.numbers.map(normalizePct), ...baseNums]);
  const outputNumbers = normalizePct(resumeText).match(/\d+(?:\.\d+)?%\+?|\d+K\+|\d+\+/g) || [];
  const suspiciousNumbers = outputNumbers.filter(n => !sourceNumberSet.has(n) && !['100%'].includes(n));
  if (suspiciousNumbers.length > 0) {
    warnings.push(`Contains numbers not in source resume: ${[...new Set(suspiciousNumbers)].join(', ')} — verify these`);
  }

  // Check company names are preserved
  const companiesPresent = SOURCE_FACTS.companies.filter(c => resumeText.includes(c));
  if (companiesPresent.length < SOURCE_FACTS.companies.length) {
    const missing = SOURCE_FACTS.companies.filter(c => !resumeText.includes(c));
    warnings.push(`Missing companies from source: ${missing.join(', ')}`);
  }

  // Narrative-before-jargon heuristic: flag bullets that open with stacked tech
  // terms instead of a user-facing outcome. A non-engineer should understand
  // sentence one. Tech inside parens is fine — that's a trailing detail by design.
  const TECH_LEAD_TERMS = new Set([
    ...SOURCE_FACTS.tools.map(t => t.toLowerCase()),
    'rag', 'llm', 'nl-to-sql', 'crud', 'mvc', 'orm', 'spa', 'sse', 'cnn',
    'fastapi/python', 'node.js/typescript', 'node.js/express', 'react/typescript',
  ]);
  const bulletLines = resumeText.split('\n').filter(l => /^\s*[•\-*]\s+\S/.test(l));
  const jargonLeadBullets = [];
  for (const line of bulletLines) {
    const raw = line.replace(/^\s*[•\-*]\s*/, '').trim();
    // Strip parenthetical content — that's explicit trailing detail, not the lead.
    const stripped = raw.replace(/\([^)]*\)/g, ' ');
    // Tokenize on whitespace AND slash so "FastAPI/Python" counts as two tech tokens.
    const firstWords = stripped.split(/[\s/]+/).slice(0, 12)
      .map(w => w.toLowerCase().replace(/[.,;:'"`]/g, ''))
      .filter(Boolean);
    const techCount = firstWords.filter(w => TECH_LEAD_TERMS.has(w)).length;
    if (techCount >= 3) {
      jargonLeadBullets.push(raw.slice(0, 70) + (raw.length > 70 ? '…' : ''));
    }
  }
  if (jargonLeadBullets.length > 0) {
    warnings.push(`Bullet leads with tech jargon (rewrite to lead with user outcome): "${jargonLeadBullets.join('"; "')}"`);
  }

  const valid = bannedFound.length === 0
    && warnings.filter(w => w.includes('fabrication')).length === 0
    && jargonLeadBullets.length === 0
    && !warnings.some(w => w.includes('em/en-dashes'));
  return { valid, warnings, bannedFound };
}

/**
 * Generate a simple diff between base and tailored resume.
 * Returns array of { type: 'same'|'added'|'removed', text: string }
 */
function generateResumeDiff(base, tailored) {
  const baseLines = base.split('\n');
  const tailoredLines = tailored.split('\n');
  const diff = [];

  // Simple line-by-line comparison
  const baseSet = new Set(baseLines.map(l => l.trim()).filter(Boolean));
  const tailoredSet = new Set(tailoredLines.map(l => l.trim()).filter(Boolean));

  for (const line of tailoredLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (baseSet.has(trimmed)) {
      diff.push({ type: 'same', text: trimmed });
    } else {
      diff.push({ type: 'added', text: trimmed });
    }
  }

  for (const line of baseLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (!tailoredSet.has(trimmed)) {
      diff.push({ type: 'removed', text: trimmed });
    }
  }

  return diff;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: stream text from Anthropic and call chunk/done callbacks
// ─────────────────────────────────────────────────────────────────────────────
async function streamText(prompt, maxTokens, onChunk) {
  let full = '';
  const stream = await client.messages.stream({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  });
  for await (const chunk of stream) {
    if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'text_delta') {
      full += chunk.delta.text;
      onChunk(chunk.delta.text);
    }
  }
  return full;
}

/**
 * Deterministic em/en-dash remover for generated prose (cover letters, Q&A).
 * The prompt bans dashes, but the model occasionally slips one in, so this is
 * the hard guarantee. Replaces a dash (with any surrounding spaces) by a comma
 * + single space when it joins clauses mid-sentence, then cleans up any double
 * punctuation artifacts. Idempotent.
 */
function sanitizeDashes(text) {
  if (!text || typeof text !== 'string') return text;
  return text
    // " — ", "—", " –", etc. → ", "
    .replace(/\s*[—–]\s*/g, ', ')
    // collapse "word, , " or punctuation followed by stray comma
    .replace(/([,;:])\s*,\s+/g, '$1 ')
    // ", ." or ", ;" → drop the orphan comma before terminal punctuation
    .replace(/,\s*([.;:!?])/g, '$1')
    // tidy any doubled spaces introduced above
    .replace(/ {2,}/g, ' ');
}

/**
 * Strip markdown emphasis/code markers from generated prose. The cover-letter
 * and Q&A renderers output PLAIN TEXT, so any **bold**, *italics*, or `code`
 * the model emits renders as literal asterisks/backticks. Cover letters need
 * none of these, so we remove the markers (keeping the inner words). Underscores
 * are left alone to avoid mangling identifiers like ai_flow_state. Idempotent.
 */
function stripMarkdown(text) {
  if (!text || typeof text !== 'string') return text;
  return text
    .replace(/\*/g, '')       // ** bold ** and * italic * emphasis markers
    .replace(/`/g, '')        // `code` backticks
    .replace(/ {2,}/g, ' ');  // tidy any doubled spaces left behind
}

/**
 * Safely parse JSON from model output, stripping markdown fences.
 * Returns { data, error } — never throws.
 */
function safeParseJSON(raw) {
  if (!raw || typeof raw !== 'string') {
    return { data: null, error: 'Empty or non-string response from model' };
  }
  // Prefer the content of the first fenced code block when one is present.
  // Models told "Return ONLY JSON" sometimes still append an explanatory note
  // after the closing fence; stripping just the ``` markers (old behavior)
  // leaves that trailing prose glued to the JSON and breaks JSON.parse. The
  // fenced block itself is reliably the answer, so extract only that.
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const cleaned = (fenced ? fenced[1] : raw).trim();
  try {
    return { data: JSON.parse(cleaned), error: null };
  } catch (e) {
    return { data: null, error: `JSON parse failed: ${e.message}. Raw output (first 200 chars): ${cleaned.slice(0, 200)}` };
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// BULLET-KEYWORD VALIDATOR (JD keywords into bullets, truth-bounded)
//
// Runs AFTER tailoring, BEFORE render/save. Three checks, hard-block, then a
// bullet-scoped one-shot regeneration (mirrors the chef-drop-brief revision
// loop) with a fall-back to the untouched base bullet. Never ships a flagged
// bullet. All flags are non-fatal: they log to console and surface on the SSE.
//
//   Check 1  capability/keyword injection (deterministic, primary defense)
//   Check 2  directional inversion (targeted LLM-judge)
//   Check 3  cross-project metric contamination (deterministic map)
//
// Guardrail: the ALLOWLIST is derived from CANDIDATE_FACTS + every base bullet
// and skills line + the accelerant maps, so the candidate's own true material
// can never be flagged (see the "base resume produces zero flags" test).
// ═════════════════════════════════════════════════════════════════════════════

// Config. ENABLE_BULLET_KEYWORDS gates the whole behavior (default on so it can
// be killed with ENABLE_BULLET_KEYWORDS=false). MAX_TAILORED_BULLETS caps how
// many bullets may be reworded away from base wording, to prevent keyword
// stuffing; beyond the cap, base wording is restored.
const ENABLE_BULLET_KEYWORDS = process.env.ENABLE_BULLET_KEYWORDS !== 'false';

// Run the three shared checks on a SINGLE bullet. Returns an array of flag
// objects (empty means clean). The checks themselves live in routes/checks.js
// (Fix 3) so the bullet and cover-letter validators cannot drift. `opts.judge`
// is the injected inversion judge, gated to directional bullets; when it is
// absent, the inversion check is skipped (deterministic tests, or no LLM).
async function checkBullet(text, project, allowSet, candidateFacts, opts = {}) {
  const flags = [
    ...checkCapabilityInjection(text, { project, allowSet }),
    ...checkMetricContamination(text, { project }),
    ...(await checkDirectionalInversion(text, { candidateFacts, judge: opts.judge, gate: isDirectionalBullet })),
  ];
  // Guarantee a `project` on every flag for the bullet consumers (the shared
  // inversion check does not set one).
  for (const f of flags) if (f.project == null) f.project = project;
  return flags;
}

/**
 * validateTailoredBullets(tailoredJson, baseJson, candidateFacts, jd, opts)
 * Runs the three checks over every tailored bullet. Returns { flags } where
 * each flag carries { index, check, project, term?, reason, bulletText }.
 * `index` is the bullet's position in collectBullets() order, so callers can
 * map a flag back to the exact bullet to regenerate.
 */
async function validateTailoredBullets(tailoredJson, baseJson, candidateFacts, jd, opts = {}) {
  const allowSet = buildBulletAllowlist(baseJson, candidateFacts);
  const bullets = collectBullets(tailoredJson);
  const flags = [];
  for (const d of bullets) {
    const bulletFlags = await checkBullet(d.text, d.project, allowSet, candidateFacts, opts);
    for (const f of bulletFlags) flags.push({ index: d.index, ...f });
  }
  return { flags };
}

/**
 * enforceBulletKeywords(tailoredJson, baseJson, candidateFacts, jd, opts)
 * Validates, then for each flagged bullet runs a bullet-scoped one-shot
 * regeneration (opts.regenerate). If the regenerated bullet re-validates clean
 * it is kept; otherwise the untouched BASE bullet for that slot is restored.
 * Never ships a flagged bullet. Returns { json, warnings, resolutions }.
 * Mutates `tailoredJson` in place (callers pass a clone).
 */
async function enforceBulletKeywords(tailoredJson, baseJson, candidateFacts, jd, opts = {}) {
  const allowSet = buildBulletAllowlist(baseJson, candidateFacts);
  const baseGroups = groupBaseBullets(baseJson);
  const bullets = collectBullets(tailoredJson);
  const { flags } = await validateTailoredBullets(tailoredJson, baseJson, candidateFacts, jd, opts);

  const warnings = [];
  const resolutions = [];
  const flaggedIndices = [...new Set(flags.map(f => f.index))];

  for (const idx of flaggedIndices) {
    const d = bullets[idx];
    const before = d.text;
    const idxFlags = flags.filter(f => f.index === idx);
    const reasons = idxFlags.map(f => f.reason);
    let resolved = false;

    if (typeof opts.regenerate === 'function') {
      let regen;
      try {
        regen = await opts.regenerate(before, reasons, candidateFacts, jd, d.project);
      } catch (e) {
        console.warn('[ai.bullet-keywords] regenerate threw (non-fatal):', e.message);
      }
      if (regen && typeof regen === 'string') {
        const reFlags = await checkBullet(regen, d.project, allowSet, candidateFacts, opts);
        if (reFlags.length === 0) {
          d.set(regen);
          resolutions.push({ index: idx, resolution: 'regenerated', before, after: regen, reasons });
          warnings.push(`bullet #${idx} (${d.project}) regenerated to fix: ${reasons.join('; ')}`);
          resolved = true;
        }
      }
    }

    if (!resolved) {
      // Fall back to the untouched base bullet at this slot (same project +
      // ordinal). Base bullets are true by construction, so this can never ship
      // a flagged bullet.
      const group = baseGroups[d.project] || [];
      const baseText = group[d.ordinal] != null ? group[d.ordinal] : before;
      d.set(baseText);
      resolutions.push({ index: idx, resolution: 'fallback-base', before, after: baseText, reasons });
      warnings.push(`bullet #${idx} (${d.project}) fell back to base after regeneration failed: ${reasons.join('; ')}`);
    }
  }

  return { json: tailoredJson, warnings, resolutions };
}

/**
 * capRewordedBullets(tailoredJson, baseJson, max)
 * Prevents keyword stuffing: at most `max` bullets may differ from base wording.
 * A bullet counts as reworded when its normalized text is absent from its
 * project's base bullet set (a pure reorder does not count). Excess reworded
 * bullets (in canonical order) are reverted to the base bullet at their slot.
 * Returns { json, reworded, reverted } where `reworded` is the final count.
 */
function capRewordedBullets(tailoredJson, baseJson, max) {
  const baseGroups = groupBaseBullets(baseJson);
  const baseTextSets = {};
  for (const p of Object.keys(baseGroups)) baseTextSets[p] = new Set(baseGroups[p].map(normText));
  const bullets = collectBullets(tailoredJson);
  let kept = 0;
  let reverted = 0;
  for (const d of bullets) {
    const set = baseTextSets[d.project];
    const isReworded = !(set && set.has(normText(d.text)));
    if (!isReworded) continue;
    if (kept < max) { kept++; continue; }
    const group = baseGroups[d.project] || [];
    if (group[d.ordinal] != null) { d.set(group[d.ordinal]); reverted++; }
    else { kept++; } // no base counterpart to revert to; leave as-is
  }
  return { json: tailoredJson, reworded: kept, reverted };
}

// Base bullet count drives the default cap: at most ~60% of bullets reworded.
const BASE_BULLET_COUNT = collectBullets(RESUME_BASE_JSON).length;
const MAX_TAILORED_BULLETS = parseInt(process.env.MAX_TAILORED_BULLETS, 10) > 0
  ? parseInt(process.env.MAX_TAILORED_BULLETS, 10)
  : Math.max(1, Math.ceil(BASE_BULLET_COUNT * 0.6));

// Default inversion judge: a targeted LLM pass. Returns { verdict, reason }.
// Wrapped safe so a parse/API hiccup degrades to PASS (non-fatal warning path).
async function defaultBulletJudge(bulletText, candidateFacts) {
  const prompt = `You are checking ONE resume bullet for DIRECTIONAL accuracy against the candidate's true facts.
Return ONLY JSON: {"verdict":"PASS"|"FAIL","reason":"short reason"}.
FAIL only if the bullet reverses the direction of a described decision, architecture, or migration versus the facts (for example, says lexical-first when the truth is vector-first, or reverses which system replaced which). Do not FAIL for wording or emphasis, only for a reversed direction or a contradicted claim.

CANDIDATE FACTS:
${candidateFacts}

BULLET:
${bulletText}`;
  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 200,
    messages: [{ role: 'user', content: prompt }],
  });
  const parsed = safeParseJSON(msg.content[0].text);
  if (parsed.error) return { verdict: 'PASS', reason: 'judge parse failed (non-fatal)' };
  return parsed.data;
}

// Default bullet-scoped regenerator. Rewrites ONLY the one failing bullet,
// naming the violation, and returns a single clean line of plain text.
async function defaultBulletRegenerate(bulletText, reasons, candidateFacts, jd, project) {
  const prompt = `Rewrite ONLY this one resume bullet to fix the issue(s) below. Keep every other bullet untouched.
Hard rules: introduce no tool, technology, framework, metric, number, or capability that is not in the CANDIDATE FACTS below. Do not move a metric or number from the project that earned it. Do not reverse the direction of any decision, architecture, or migration. No em-dashes or en-dashes. Lead with the user-facing outcome, let the stack trail.
Return ONLY the rewritten bullet as a single line of plain text: no quotes, no bullet marker, no commentary.

ISSUE(S) TO FIX:
${reasons.map(r => '- ' + r).join('\n')}

CANDIDATE FACTS:
${candidateFacts}

BULLET TO REWRITE:
${bulletText}`;
  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }],
  });
  let out = (msg.content[0] && msg.content[0].text) || '';
  out = stripMarkdown(sanitizeDashes(out)).trim().replace(/^["'`•\-\s]+/, '').trim();
  return out;
}

// ═════════════════════════════════════════════════════════════════════════════
// COVER-LETTER VALIDATOR (Fix 2)
//
// The cover letter had no source-fact validation at all. It runs the SAME three
// shared checks as the bullets (capability injection, directional inversion,
// cross-project metric contamination) plus a fourth cover-only LLM-judge check
// for invented incidents / unsupported claims. On any flag it regenerates once
// with the violations named (chef-drop-brief field-scoped pattern), re-validates,
// and if it still fails it BLOCKS: a flagged letter is never saved.
// ═════════════════════════════════════════════════════════════════════════════

/**
 * validateCoverLetter(coverText, candidateFacts, baseJson, jd, opts)
 * Returns { flags }. `opts.judge` is the inversion judge; `opts.incidentJudge`
 * is the invented-incident judge. Both optional (skipped if absent), so the
 * deterministic checks are always testable without an LLM.
 */
async function validateCoverLetter(coverText, candidateFacts, baseJson, jd, opts = {}) {
  const allowSet = buildBulletAllowlist(baseJson, candidateFacts);
  // The cover-letter prompt requires opening with the target company's name
  // and often echoes the job title back ("mirror the company's own
  // language"). Those words are not the candidate claiming a capability, so
  // they must not be checked against CANDIDATE_FACTS the way a technology
  // claim would be.
  for (const field of [jd && jd.company, jd && jd.title]) {
    if (!field) continue;
    for (const w of String(field).split(/\s+/)) {
      const n = normWord(w);
      if (n) allowSet.add(n);
    }
  }
  const flags = [];

  // Check 1: capability injection (deterministic). project=null means the global
  // allowlist plus synonym-conditional coverage; fragment topic-gating does not
  // apply to free prose.
  for (const f of checkCapabilityInjection(coverText, { project: null, allowSet })) flags.push(f);

  // Check 3: cross-project metric contamination (deterministic, prose mode).
  for (const f of checkMetricContamination(coverText, { project: null })) flags.push(f);

  // Check 2: directional inversion (LLM-judge over the whole letter, no gate).
  for (const f of await checkDirectionalInversion(coverText, { candidateFacts, judge: opts.judge, gate: null })) flags.push(f);

  // Check 4: invented-incident / unsupported-claim (cover-only LLM-judge).
  if (typeof opts.incidentJudge === 'function') {
    try {
      const verdict = await opts.incidentJudge(coverText, candidateFacts);
      if (verdict && String(verdict.verdict).toUpperCase() === 'FAIL') {
        flags.push({
          check: 'invented-incident', text: coverText,
          reason: verdict.reason || 'letter states a specific incident or claim not traceable to CANDIDATE_FACTS',
        });
      }
    } catch (e) {
      console.warn('[ai.cover-guard] incident judge threw (non-fatal):', e.message);
    }
  }

  return { flags };
}

/**
 * enforceCoverLetter(coverText, candidateFacts, baseJson, jd, opts)
 * Validate, regenerate once (opts.regenerate) if flagged, re-validate; if still
 * flagged, BLOCK. Returns { text, blocked, resolution, flags, warnings }.
 * When blocked, callers must NOT save `text`; it is the flagged content kept
 * only for reference.
 */
async function enforceCoverLetter(coverText, candidateFacts, baseJson, jd, opts = {}) {
  const warnings = [];
  const v1 = await validateCoverLetter(coverText, candidateFacts, baseJson, jd, opts);
  if (v1.flags.length === 0) {
    return { text: coverText, blocked: false, resolution: 'clean', flags: [], warnings };
  }
  const reasons1 = v1.flags.map(f => f.reason);
  warnings.push(`cover letter flagged: ${reasons1.join('; ')}`);

  if (typeof opts.regenerate === 'function') {
    let regen;
    try {
      regen = await opts.regenerate(coverText, reasons1, candidateFacts, jd);
    } catch (e) {
      console.warn('[ai.cover-guard] regenerate threw (non-fatal):', e.message);
    }
    if (regen && typeof regen === 'string') {
      const v2 = await validateCoverLetter(regen, candidateFacts, baseJson, jd, opts);
      if (v2.flags.length === 0) {
        warnings.push('cover letter regenerated once and passed');
        return { text: regen, blocked: false, resolution: 'regenerated', flags: [], warnings };
      }
      warnings.push(`cover letter still flagged after regeneration: ${v2.flags.map(f => f.reason).join('; ')}`);
      return { text: regen, blocked: true, resolution: 'blocked', flags: v2.flags, warnings };
    }
  }
  return { text: coverText, blocked: true, resolution: 'blocked', flags: v1.flags, warnings };
}

// Default cover-letter inversion judge (whole letter). Safe on parse failure.
async function defaultCoverInversionJudge(coverText, candidateFacts) {
  const prompt = `You are checking a COVER LETTER for DIRECTIONAL accuracy against the candidate's true facts.
Return ONLY JSON: {"verdict":"PASS"|"FAIL","reason":"short reason"}.
FAIL only if the letter explicitly states or clearly implies the WRONG order for a described decision, architecture, or migration versus the facts (for example, says the routing went vector-first-to-lexical-first when the facts say lexical-first-to-vector-first, or names the wrong system as the one that got replaced).
Do NOT FAIL for wording or emphasis. Do NOT FAIL just because the letter describes only the current/final state of a system without narrating what came before it, or uses an analogy/example from a different part of the work — an omitted "before" state is incompleteness, not a reversal. Only FAIL when a direction is actually asserted and it is backwards.

CANDIDATE FACTS:
${candidateFacts}

COVER LETTER:
${coverText}`;
  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 350,
    messages: [{ role: 'user', content: prompt }],
  });
  const parsed = safeParseJSON(msg.content[0].text);
  if (parsed.error) return { verdict: 'PASS', reason: 'judge parse failed (non-fatal)' };
  return parsed.data;
}

// Default invented-incident judge. Flags specific incidents/events/claims that
// do not trace to CANDIDATE_FACTS. Safe on parse failure.
async function defaultCoverIncidentJudge(coverText, candidateFacts) {
  const prompt = `You are fact-checking a COVER LETTER, but ONLY the parts of it that describe the CANDIDATE's own experience. You are not fact-checking anything else in the letter.

SCOPE — read this before anything else:
- IN SCOPE: any specific incident, event, dated anecdote, named customer, or quantified claim the letter attributes to the CANDIDATE (what they personally did, decided, built, or experienced).
- OUT OF SCOPE, always PASS regardless of whether it appears in CANDIDATE FACTS: (a) the salutation — who the letter is addressed to, and what company it names, (b) any fact about the TARGET COMPANY itself (its size, scale, product, mission, industry) that isn't a claim about the candidate. You cannot verify these against CANDIDATE FACTS and are not being asked to — do not treat "not in CANDIDATE FACTS" as suspicious for these two categories, and do not flag the letter as a possible template/mismatch on that basis.

Worked example: "Dear Chen, PlayStation reaches over 100 million people, and that scale is why I'm applying. At Enidus I built an AI copilot with zero hallucination incidents across 15 tenants." → PASS. "Chen" and "PlayStation" are salutation (out of scope). "100 million people" is a target-company fact (out of scope). "zero hallucination incidents across 15 tenants" traces to CANDIDATE FACTS. Nothing here is an invented claim about the candidate.

Return ONLY JSON: {"verdict":"PASS"|"FAIL","reason":"short reason naming the invented detail, or empty string if PASS"}.

FAIL only for the IN SCOPE category: a specific incident, event, dated anecdote, named customer, or quantified claim about the CANDIDATE that does NOT trace to CANDIDATE FACTS below (for example "last month I discovered a gap", a specific bug or outage, or a number not present in the facts).

Do NOT FAIL merely because a true, general fact from CANDIDATE FACTS is narrated with reflective or storytelling language (e.g. calling a real architectural decision "the moment that shaped my thinking," or describing a real tradeoff as if walking through the reasoning live). That framing is a legitimate writing style, not fabrication. Only FAIL that kind of passage if it also adds a specific invented detail on top of the true fact — a fake date, a named person or customer not in the facts, or a number not in the facts.

General motivation and opinions are fine. When unsure whether an IN SCOPE claim about the candidate is supported, FAIL; never apply that same doubt to the two OUT OF SCOPE categories above.

CANDIDATE FACTS:
${candidateFacts}

COVER LETTER:
${coverText}`;
  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 350,
    messages: [{ role: 'user', content: prompt }],
  });
  const parsed = safeParseJSON(msg.content[0].text);
  if (parsed.error) return { verdict: 'PASS', reason: 'judge parse failed (non-fatal)' };
  return parsed.data;
}

// Default cover-letter regenerator: rewrite fixing only the named violations.
async function defaultCoverRegenerate(coverText, reasons, candidateFacts, jd) {
  const prompt = `The cover letter below failed a fabrication check. Rewrite it to fix ONLY these issues, keeping the same structure, voice, and every correctly-sourced detail:
${reasons.map(r => '- ' + r).join('\n')}

Hard rules: name no technology, framework, tool, metric, or number that is not in the CANDIDATE FACTS below. Invent no incident, event, or anecdote. Do not reverse the direction of any decision, architecture, or migration. No em-dashes or en-dashes. Plain text, first person, start with "Dear" and end with "Best," then the name on the next line. Return ONLY the letter body.

CANDIDATE FACTS:
${candidateFacts}

COVER LETTER TO FIX:
${coverText}`;
  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 900,
    messages: [{ role: 'user', content: prompt }],
  });
  const out = (msg.content[0] && msg.content[0].text) || '';
  return stripMarkdown(sanitizeDashes(out)).trim();
}

// Compact accelerant hints for the tailoring prompt, generated from the maps so
// the prompt can never drift from what the validator enforces.
function buildAccelerantHints() {
  const lines = [];
  for (const [term, bases] of Object.entries(SYNONYM_MAP || {})) {
    lines.push(`- You may write "${term}" only in a bullet that already describes ${bases.slice(0, 2).join(' or ')}.`);
  }
  for (const [term, spec] of Object.entries(FACT_FRAGMENT_MAP || {})) {
    lines.push(`- "${term}": you may surface "${spec.fragment}" only on the ${spec.topics.join('/')} work.`);
  }
  return lines.join('\n');
}

// Fix 2: cap how many characters adjacency may add to the skills section, so it
// never grows beyond roughly one extra wrapped line. The length-fit step (Fix 1)
// reserves this exact growth out of the bullet budget, keeping bullets + grown
// skills inside the one-page envelope the base fits.
const SKILLS_GROWTH_CHAR_CAP = 90; // about one extra line of skills text

/**
 * lockSkillsSection(tailoredJson, baseJson, jdRequiredSkills, opts) (Fixes 1 + 2)
 * Rebuild the skills section deterministically: start from the BASE skills
 * section and re-append only the adjacency-justified skills (from applyAdjacency),
 * capped so the section grows by at most ~1 line, then overwrite the tailored
 * resume's skills section wholesale. The LLM-authored skills (labels and values)
 * are discarded entirely, so no hallucinated skill (e.g. "C++") can reach output
 * and the base's category labels are always preserved. Mutates `tailoredJson` in
 * place (callers pass a clone or the parsed LLM output, never the base itself).
 * Returns { json, added, skillsGrowth } where `skillsGrowth` is the exact extra
 * character count added to skill values (used to reserve bullet headroom).
 */
function lockSkillsSection(tailoredJson, baseJson, jdRequiredSkills, opts = {}) {
  const cap = opts.growthCap != null ? opts.growthCap : SKILLS_GROWTH_CHAR_CAP;
  const adj = applyAdjacency(baseJson, jdRequiredSkills); // deep-clones baseJson; adj.added is ordered
  const baseSkills = (baseJson.sections || []).find(s => s.type === 'skills');
  if (!baseSkills) return { json: tailoredJson, added: [], skillsGrowth: 0 };

  // Rebuild from a clean BASE clone so we control exactly what is appended and by
  // how much (applyAdjacency itself has no cap).
  const lockedSkills = JSON.parse(JSON.stringify(baseSkills));
  const kept = [];
  let growth = 0;
  for (const a of adj.added) {
    const addChars = (', ' + a.skill).length;
    // Always allow at least one addition; stop once the cap would be exceeded.
    if (kept.length >= 1 && growth + addChars > cap) break;
    const item = lockedSkills.items.find(i => i.label === a.addedTo);
    if (!item) continue;
    item.value = `${item.value}, ${a.skill}`;
    growth += addChars;
    kept.push(a);
  }

  const idx = tailoredJson.sections.findIndex(s => s.type === 'skills');
  if (idx !== -1) tailoredJson.sections[idx] = lockedSkills; // preserve LLM section order
  else tailoredJson.sections.push(lockedSkills);

  return { json: tailoredJson, added: kept, skillsGrowth: growth };
}

// ═════════════════════════════════════════════════════════════════════════════
// LENGTH-FIT ENFORCEMENT (Fix 1)
//
// The character budget used to be warn-only, so bullet rewording + the outcome
// nudge could push the tailored resume past one page, triggering the whole-resume
// render fallback (which discards all tailoring). This step makes length a hard,
// deterministic constraint: any bullet longer than its base counterpart beyond a
// small tolerance is shortened by one scoped regeneration (re-validated by the
// SAME bullet validator, so shortening can never introduce fabrication) or, if
// that fails, reverted to its base bullet. A final budget pass reverts the
// largest over-base bullets until the total is within the (skills-reserved)
// budget. Reverting to base is always safe, so the total is guaranteed at or
// below BASE_BULLET_CHAR_BUDGET.
// ═════════════════════════════════════════════════════════════════════════════

const LENGTH_TOLERANCE = 0.05; // a bullet may run up to 5% over base before we act

/**
 * enforceBulletLength(tailoredJson, baseJson, candidateFacts, jd, opts)
 * opts: { regenerate(bulletText, targetLen, facts, jd, project)->string,
 *         judge (inversion, forwarded to the bullet validator),
 *         skillsGrowth (chars adjacency added to skills; reserved from budget),
 *         tolerance }
 * Mutates `tailoredJson` in place (callers pass a clone or the LLM output).
 * Returns { json, resolutions, warnings, totalChars, budget }.
 */
async function enforceBulletLength(tailoredJson, baseJson, candidateFacts, jd, opts = {}) {
  const tolerance = opts.tolerance != null ? opts.tolerance : LENGTH_TOLERANCE;
  const skillsGrowth = Math.max(0, opts.skillsGrowth || 0);
  // Fix 2 reserve: bullets must leave room for the chars adjacency added to skills.
  const budget = Math.max(0, BASE_BULLET_CHAR_BUDGET - skillsGrowth);
  const allowSet = buildBulletAllowlist(baseJson, candidateFacts);
  const baseGroups = groupBaseBullets(baseJson);
  const warnings = [];
  const resolutions = [];

  const baseOf = (d) => {
    const g = baseGroups[d.project] || [];
    return g[d.ordinal] != null ? g[d.ordinal] : null;
  };
  const totalOf = () => collectBullets(tailoredJson).reduce((n, d) => n + d.text.length, 0);

  // Pass 1: shorten-or-revert every bullet that runs over base beyond tolerance.
  for (const d of collectBullets(tailoredJson)) {
    const base = baseOf(d);
    if (base == null) continue; // no positional counterpart; leave as-is
    if (d.text.length <= Math.ceil(base.length * (1 + tolerance))) continue;
    const before = d.text;
    let resolved = false;

    if (typeof opts.regenerate === 'function') {
      let regen;
      try {
        regen = await opts.regenerate(before, base.length, candidateFacts, jd, d.project);
      } catch (e) {
        console.warn('[ai.length-fit] shorten regenerate threw (non-fatal):', e.message);
      }
      // Accept only if it is actually shorter (at or below base) AND still clean.
      if (regen && typeof regen === 'string' && regen.length <= base.length) {
        const reFlags = await checkBullet(regen, d.project, allowSet, candidateFacts, opts);
        if (reFlags.length === 0) {
          d.set(regen);
          resolutions.push({ index: d.index, resolution: 'shortened', before, after: regen, baseLen: base.length });
          warnings.push(`bullet #${d.index} (${d.project}) shortened ${before.length} -> ${regen.length} chars (base ${base.length})`);
          resolved = true;
        }
      }
    }

    if (!resolved) {
      d.set(base);
      resolutions.push({ index: d.index, resolution: 'reverted-base', before, after: base, baseLen: base.length });
      warnings.push(`bullet #${d.index} (${d.project}) reverted to base after shorten failed (${before.length} > ${base.length} chars)`);
    }
  }

  // Pass 2: total-budget guarantee. Revert the largest over-base bullets (the
  // ones still above their base counterpart) until the total fits the reserved
  // budget. Reverting can only shrink the total, and reverting every over-base
  // bullet lands the total at sum(min(tailored, base)) <= BASE_BULLET_CHAR_BUDGET,
  // so this always converges to at or below the one-page budget.
  let total = totalOf();
  if (total > budget) {
    const over = collectBullets(tailoredJson)
      .map(d => ({ d, base: baseOf(d) }))
      .filter(x => x.base != null && x.d.text.length > x.base.length)
      .map(x => ({ ...x, excess: x.d.text.length - x.base.length }))
      .sort((a, b) => b.excess - a.excess);
    for (const x of over) {
      if (total <= budget) break;
      const before = x.d.text;
      x.d.set(x.base);
      total -= (before.length - x.base.length);
      resolutions.push({ index: x.d.index, resolution: 'reverted-budget', before, after: x.base, baseLen: x.base.length });
      warnings.push(`bullet #${x.d.index} (${x.d.project}) reverted to base to meet the total budget (${budget})`);
    }
    total = totalOf();
  }

  return { json: tailoredJson, resolutions, warnings, totalChars: total, budget };
}

// Default length-fit regenerator: shorten ONE bullet to at most `targetLen`
// characters while preserving every fact, number, and existing keyword. Returns
// a single clean plain-text line. Wrapped safe by the caller.
async function defaultBulletShorten(bulletText, targetLen, candidateFacts, jd, project) {
  const prompt = `Shorten this resume bullet to AT MOST ${targetLen} characters (it is currently ${bulletText.length}). Keep it a single sentence or two.
Preserve every fact, number, metric, and technology keyword already in the bullet. Introduce nothing new: no tool, technology, framework, metric, number, or capability that is not already in the bullet or in the CANDIDATE FACTS below. Do not reverse the direction of any decision, architecture, or migration. Lead with the outcome, keep it concise. No em-dashes or en-dashes.
Return ONLY the shortened bullet as a single line of plain text: no quotes, no bullet marker, no commentary.

CANDIDATE FACTS:
${candidateFacts}

BULLET TO SHORTEN:
${bulletText}`;
  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }],
  });
  let out = (msg.content[0] && msg.content[0].text) || '';
  out = stripMarkdown(sanitizeDashes(out)).trim().replace(/^["'`•\-\s]+/, '').trim();
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// HARDENED RESUME PROMPT — conservative, source-grounded, anti-fabrication
// ─────────────────────────────────────────────────────────────────────────────
function buildResumePrompt(job, emphasis) {
  // Never expose the real contact block to the LLM. It has mutated URLs before
  // (2026-07-08 Glean run typo'd the LinkedIn slug). Swap in a sentinel; the
  // real contact is pinned downstream by the identity lock. This removes the
  // chance to corrupt it at the source.
  const promptResume = JSON.parse(JSON.stringify(RESUME_BASE_JSON));
  promptResume.contact = ['CONTACT_INJECTED_DOWNSTREAM_DO_NOT_MODIFY'];
  return `You are tailoring a resume for a specific job. Your ONLY job is conservative editing — NOT rewriting.

You are tailoring a 1-page resume. Layout discipline matters as much as content relevance.

TARGET ROLE: ${job.title} at ${job.company}
REQUIRED SKILLS: ${job.tags.join(', ')}
JD: ${job.desc}
EMPHASIS: ${emphasis}

SOURCE RESUME (this is the canonical schema and the wording baseline, JSON):
${JSON.stringify(promptResume, null, 2)}

CANDIDATE FACTS (the full true record; some of this was trimmed from the SOURCE RESUME above to fit one page). You may surface any TRUE material from here to better match the REQUIRED SKILLS, but you may NOT add new roles, new projects, or new subsections beyond the SOURCE RESUME structure. This is a rephrasing license, not an expansion license:
${CANDIDATE_FACTS}

JD-VOCABULARY SURFACING (truth-bounded; these four rules are hard):
- You may rephrase and reorder bullets to surface the material most relevant to the REQUIRED SKILLS, using the JD's exact terminology WHERE IT ACCURATELY DESCRIBES WORK ALREADY PRESENT in the SOURCE RESUME or CANDIDATE FACTS.
- You may NOT introduce any tool, technology, framework, metric, number, or capability that does not appear in CANDIDATE FACTS or the SOURCE RESUME.
- Do not move a metric or number from the project that earned it to any other project.
- Do not reverse the direction of any described decision, architecture, or migration (for example, the routing pivot was lexical-first to vector-first; never state it the other way).
- Soft preference: lead with the outcome concisely and WITHOUT adding length. A tailored bullet must not grow versus its base wording; keep it at or below the base bullet's length. Let tool and stack names trail.
${buildAccelerantHints() ? `\nAPPROVED VOCABULARY SUBSTITUTIONS (use only as bounded below; a downstream validator enforces these and reverts violations):\n${buildAccelerantHints()}` : ''}

OUTPUT FORMAT: Return ONLY a JSON object matching the SAME SCHEMA as the source above. No markdown fences, no commentary, no prose explanation. The JSON will be parsed by JSON.parse() — anything other than valid JSON breaks the pipeline.

You may modify the values within bullets/skills (per rules below). You MUST preserve:
  - The top-level keys (name, contact, sections). Output the \`contact\` value
    EXACTLY as given (the sentinel string). It is replaced downstream. Never
    invent, reformat, expand, or "correct" any contact URL, email, or phone.
  - Section types and order keys
  - Item structure (title/date/location/subsections, etc.)
  - All numbers, percentages, dates, company names, and tool names exactly

JD FOCUS DETECTION:
Before generating the tailored resume, classify the TARGET role's primary focus into ONE of these buckets:
  - frontend: roles emphasizing React, UI/UX, mobile, accessibility, design systems (e.g., "Frontend Engineer", "UI Engineer", "Mobile Engineer", "Web Developer").
  - backend: roles emphasizing services, databases, APIs, distributed systems, infrastructure (e.g., "Backend Engineer", "Platform Engineer", "Infrastructure Engineer", "Site Reliability Engineer").
  - ai_infra: roles emphasizing LLM systems, agents, RAG, vector DBs, MLOps (e.g., "AI Engineer", "ML Engineer", "Applied AI", "Forward Deployed Engineer at AI shop").
  - fullstack: roles requiring both frontend and backend (e.g., "Software Engineer" with no specialization, "Full-Stack Engineer", "Founding Engineer").
  - data: roles emphasizing data pipelines, analytics, modeling, statistics (e.g., "Data Engineer", "Data Scientist", "ML Engineer with pipeline focus").

Classify based on the JD's bullet density — count how many JD bullets describe each area, pick the dominant one. The classification drives the SUBSECTION REORDERING and BULLET ORDERING rules below.

TIEBREAKER FOR HYBRID-FLAVOR TITLES:
If the JD title contains AI keywords (AI, ML, LLM, GenAI, Agentic, Intelligent) BUT primarily describes one of the other focus areas in the body, classify based on the BODY, not the title. Specifically:
  - "Frontend Engineer" / "UI Engineer" / "Mobile Engineer" / "Web Developer" / "Web Engineer" in the title (with or without AI qualifier) → classify as 'frontend' UNLESS the body explicitly says >50% of the work is on AI/ML infrastructure (model serving, vector DB ops, agent orchestration as primary).
  - "Backend Engineer" / "Platform Engineer" / "Infrastructure Engineer" in the title (with or without AI qualifier) → classify as 'backend' under the same rule.
  - "AI Experiences" / "AI Features" / "AI Platform" / "Intelligent X" qualifier in a frontend/backend title means "this team builds AI-flavored features" — the engineering work itself is still frontend/backend.
  - 'ai_infra' is reserved for roles where the JD body describes BUILDING the AI/ML platform itself (LLM serving, RAG indexing, agent runtimes, evaluation harnesses) as primary work.
  - When in doubt between two buckets, weight by the "WHAT YOU'LL DO" section: count keywords for each area (frontend: React, UI, mobile, accessibility, components; backend: services, databases, APIs, scaling; ai_infra: LLM, RAG, agents, MLOps, eval harness).

STRICT RULES — violations will cause rejection:

HARD CHARACTER BUDGET (most important rule — output is rejected if violated):
- The total character count of all bullet text across experience + projects sections must NOT exceed ${TAILOR_CHAR_CAP} characters.
- This budget sits deliberately BELOW the base resume's own char count, because the tailored skills section runs 1-2 lines taller than the base (JD-matched skills get appended and categories expand). Reserving those lines for skills is why bullets are capped here. Tailored versions that exceed this budget overflow page 1 and trigger fallback to the base resume — meaning your tailoring is discarded entirely.
- Count BEFORE submitting: sum the .length of every bullet string. If your output exceeds ${TAILOR_CHAR_CAP}, COMPRESS bullets: drop redundant clauses, tighten phrasing, or drop the lowest-relevance bullet entirely.
- Skills section is constrained separately (4 lines). This budget applies only to bullet content.
- This budget OVERRIDES all other content goals. If preserving a JD-keyword anchor or following verb diversity would push you over budget, COMPRESS something else FIRST. The budget is non-negotiable.

1. PRESERVE ALL FACTS EXACTLY. Every number, percentage, metric, date, company name, tool name, and claim must come directly from the source resume. Do not round, approximate, inflate, or invent any number or claim.

2. ALLOWED EDITS ONLY:
   - Reorder bullet points within a section to lead with the most relevant work
   - Reorder sections (e.g., put RAG chatbot subsection before BFF if the role is AI-focused)
   - Tighten wording by removing filler words (keep the meaning identical)
   - Swap in JD-relevant phrasing ONLY when the source already supports the claim
   - Highlight skills from the Skills section that match the JD by listing them first

3. NEVER DO ANY OF THESE:
   - Invent tools, frameworks, metrics, or responsibilities not in the source
   - Add scope, scale, or impact beyond what the source states
   - Use ANY of these banned phrases: leveraged, spearheaded, utilized, results-driven, dynamic professional, passionate about, excited to bring, proven track record, cutting-edge, synergized, revolutionized, transformative, game-changing, best-in-class, thought leader, self-starter, go-getter, drove innovation, deep expertise, seasoned, extensive experience
   - Expand weak evidence into stronger claims
   - Pretend the candidate has experience they don't have
   - Add a summary/objective section
   - Change the format, section headers, or structure
   - Use em-dashes (—) or en-dashes (–) ANYWHERE. They are a strong AI-writing tell and are strictly prohibited. Use a colon, semicolon, comma, parentheses, or period instead. This applies to every bullet without exception.

LAYOUT CONSTRAINTS (hard requirements — output is rejected if violated):
- The tailored resume MUST fit on exactly 1 page (A4, 17pt margins, Times-Roman 11pt, 13pt line height). Going to page 2 triggers fallback to the base resume — meaning your tailoring is discarded entirely. A roughly 90%-full page is fine; a half-page output is too sparse.
- HARD MAXIMUM ${TAILOR_CHAR_CAP} chars across experience + projects bullet content. This is set below the base resume's own char count on purpose, to reserve 1-2 lines for the taller tailored skills section. EVEN AT this cap your output may overflow because word-wrap depends on which specific words you choose, so do NOT ride the cap. TARGET ${TAILOR_CHAR_TARGET} chars to leave wrap-safety plus skills-growth margin. MINIMUM ${TAILOR_CHAR_MIN} chars — below this the page reads sparse.
- The acceptable window is ${TAILOR_CHAR_MIN} to ${TAILOR_CHAR_CAP}; aim for the MIDDLE of the window (~${TAILOR_CHAR_TARGET} chars), NOT the top. Aiming for the cap guarantees occasional overflow because word-wrap is non-deterministic across rephrasings and the skills section adds height the bullet count cannot see.
- PRESERVE every role, internship, and project from the base resume. Do NOT drop entire roles (e.g., GSPANN, Orahi) or subsections. Reorder is fine; deletion is not.
- PRESERVE bullet count per subsection. Tighten wording inside a bullet if needed; do not silently drop bullets. Dropping a bullet is acceptable ONLY if keeping it would force overflow to page 2.
- Each bullet should be 20-35 words. Bullets under 15 words read as filler and get rejected. Bullets over 40 words wrap to too many lines.
- NEVER write a bullet whose final rendered line will contain fewer than 4 words (a "widow line"). Specifically: avoid sentences that end with a short clause like "from days to minutes." or "stored Excel passwords." which would wrap such that the period falls alone on a final line. Instead, either tighten the sentence so it ends mid-line, or pad the final clause so the last line has 4+ words.
- For the Skills section: keep ALL skill categories from the base resume. The section must occupy EXACTLY 4 lines (matching the base resume's 4-category structure). See SKILLS SECTION LINE COUNT below.
- If your tailored output would push past 1 page, TIGHTEN wording inside bullets rather than dropping content. Cutting bullets or roles is a LAST resort, not the first move. The failure mode this brief is fixing is half-page output, not overflow — err toward keeping content.

SKILLS SECTION LINE COUNT (hard requirement — output is rejected if violated):
- The TECHNICAL SKILLS section must contain EXACTLY 4 category lines, matching the base resume's structure. The base has: AI / LLM Systems, Languages, Frameworks, Infra & Tools.
- You may RENAME and REORDER categories to match JD focus (e.g., "Frontend & Mobile: ..." instead of "Frameworks: ..." for frontend roles) but you may NOT add a 5th category line.
- If you need to surface both frontend AND backend frameworks for a fullstack JD, combine them under a single line: "Frameworks & APIs: React, Node.js, Express, FastAPI, ...".
- Total skills section height must fit within the 4-line budget the base resume uses. Adding a 5th line overflows the page and triggers fallback to base.

VERB DIVERSITY (hard requirement — output is rejected if violated):
- Across the entire resume, no more than 2 bullets may start with the same verb.
- Avoid the default "Built" lead. Specifically: rephrase bullets so the resume uses a variety of opening verbs. Draw from this pool, picking the verb that most accurately describes what the candidate did for that bullet:
  Architected, Authored, Designed, Drove, Engineered, Established, Hardened, Implemented, Instrumented, Integrated, Launched, Led, Migrated, Optimized, Owned, Productionized, Refactored, Reduced, Replaced, Shipped, Scaled, Stabilized, Streamlined.
- If a bullet's most accurate verb truly is "Built" or "Created," that is fine — but use it sparingly (max 2 across the whole resume).
- Do not fabricate scope to fit a verb. "Architected" implies design authority; "Led" implies you directed others. Use accurately.

JD-KEYWORD ANCHOR PRESERVATION (hard requirement):
When rewriting bullets for verb diversity or JD-focus reordering, PRESERVE any technology / framework keywords from the JD's required-skills section in the bullet text. Specifically:
- Identify the top 5-8 technology keywords from the JD's "What you'll be doing" / "Who you are looking for" / "Qualifications" sections (e.g., React, React Native, TypeScript, GraphQL, REST, accessibility, A/B testing, feature flags).
- For each Enidus subsection, ensure at least ONE bullet within that subsection mentions a relevant JD keyword in its body text (not just the skills section at the bottom of the resume — recruiters scan bullets, not just skills lists).
- If a bullet's original phrasing included a JD keyword (e.g., "React + TypeScript frontend UI"), DO NOT drop that keyword during the verb-diversity rewrite. Find a way to keep it in the new phrasing.
- Acceptable: "Shipped a React + TypeScript frontend for the AI assistant..." (preserved React+TS).
- Unacceptable: "Shipped an AI assistant enabling natural-language queries..." (lost React+TS anchor that was in the JD).
- The skills section listing is necessary but not sufficient. Bullets must demonstrate use of the JD keywords, not just claim them.

SUBSECTION REORDERING (JD-focus-aware):
Within the "AI/Full-Stack Engineer, Enidus USA LLC." experience item, the Enidus subsections (AI Chatbot & Agentic Copilot, Custom Reports & Dashboards Platform, and any others) should be ordered based on JD FOCUS:
  - frontend → lead with Custom Reports & Dashboards Platform (React frontend), then AI Copilot.
  - backend → lead with AI Copilot (FastAPI backend depth), then Reports.
  - ai_infra → lead with AI Copilot (the headline agentic work), then Reports.
  - fullstack → lead with AI Copilot, then Reports (both have full-stack but AI is the marquee).
  - data → lead with Reports (data infra + multi-tenant analytics), then AI Copilot.
Do not invent new subsections; reorder existing ones.

BULLET ORDERING WITHIN SUBSECTIONS (JD-focus-aware):
Within each subsection, order bullets to lead with the most JD-aligned content:
  - frontend → lead with bullets that mention React, TypeScript, UI, UX, mobile, accessibility. Demote backend infra bullets (hybrid retrieval, RLS, RBAC, SQL templates, validators) to the bottom of the subsection — or omit entirely if the subsection has 5+ bullets and the backend-infra one is the weakest signal for this JD.
  - backend → lead with bullets about services, databases, APIs, distributed systems. Demote pure-frontend bullets.
  - ai_infra → lead with bullets about agentic systems, LLM safety, evaluation, retrieval, governance. Demote pure-frontend bullets.
  - fullstack → preserve current ordering (both signals matter); minor tweaks only.
  - data → lead with bullets about data pipelines, transformations, analytics. Demote pure-frontend or pure-AI-eval bullets.

When demoting, do not delete bullets unless asked. Reordering only.

4. TONE: Write like a competent engineer describing what they built FOR USERS, not like a developer listing what they used. Concrete, specific, plain language. Lead with outcomes; let stack lists trail.

5. NARRATIVE BEFORE JARGON — every bullet must pass the "non-engineer test." A reader who doesn't know FastAPI from Flask should be able to read the first sentence of any bullet and understand what was built and who it helps. Technology stacks belong at the END of a bullet (in a trailing fragment) or in the SKILLS section — never as the opening clause.

   Apply this test to every bullet you write or edit:
   - Does the first 8 words name a user-facing outcome (what users can now do, or what problem is solved)? If no, rewrite.
   - Are 3+ of the first 10 words technology names (FastAPI, React, Pydantic, etc.)? If yes, rewrite.
   - Could a product manager understand what was shipped from sentence one alone? If no, rewrite.

   BAD (jargon stack, no user outcome):
   "Architected an agent-ready enterprise AI copilot on a FastAPI/Python backend with React 19 + TypeScript frontend, designed for hot-swap replacement of the intent router by an LLM planning agent."

   GOOD (outcome first, stack trails):
   "Built a conversational AI copilot for managing enterprise telecom accounts: users order devices, suspend lines, and upgrade plans through chat instead of clicking through 10+ portal screens. FastAPI + Python backend, React 19 + TypeScript frontend."

   BAD (NL-to-SQL is jargon for "asks questions"):
   "Architected a production NL-to-SQL AI assistant over live telecom account data using FastAPI, GPT-4o-mini, and Qdrant."

   GOOD (the system's actual job, then the stack):
   "Built a production AI assistant that lets account admins ask plain-English questions about their accounts ('how many lines on BAN 9234?') and get answers pulled live from the database. FastAPI, GPT-4o-mini, Qdrant."

6. If the JD requires skills or experience the source resume does NOT clearly demonstrate, DO NOT fabricate coverage. Simply omit or leave the resume as-is for that area.

7. Return ONLY a JSON object matching the source schema. No markdown fences, no commentary, no prose. The very first character of your response must be \`{\` and the very last must be \`}\`.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ai/pipeline-stream  — SSE streaming: JD → resume → cover → Q&A
// Query: job=<JSON encoded job object>
// ─────────────────────────────────────────────────────────────────────────────
router.get('/pipeline-stream', async (req, res) => {
  let job;
  try {
    // Express has already URL-decoded req.query — calling decodeURIComponent
    // again would double-decode any '%' in the JD (e.g. "20% YoY") and either
    // corrupt the JSON or throw URIError on malformed sequences like "%YoY".
    job = JSON.parse(req.query.job || '{}');
  } catch (e) {
    console.error('[pipeline-stream] JSON.parse failed:', e.message);
    return res.status(400).json({ error: 'Invalid job param — must be URL-encoded JSON' });
  }

  if (!job.title || !job.company || !job.tags) {
    return res.status(400).json({ error: 'Job object must have title, company, and tags' });
  }

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (data) => {
    try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch (e) {
      console.error('SSE write error:', e.message);
    }
  };

  // Handle client disconnect
  let aborted = false;
  req.on('close', () => { aborted = true; });

  try {
    // ── STEP 1: JD Analysis ───────────────────────────────────────────────────
    send({ step: 'jd', status: 'start' });

    const jdPrompt = `Analyze this job description and return structured JSON only.

JD: ${job.title} at ${job.company}
${job.desc}
Tags: ${job.tags.join(', ')}

Sahil's profile: Node.js, TypeScript, Python, PostgreSQL, AWS, PyTorch, RAG, Qdrant, Apache Spark, REST APIs, Docker, Flask, FastAPI, React, Angular, SQL Server, TimescaleDB, Kafka, gRPC.

Rules for "missing_skills":
- Only list recognizable technologies, languages, frameworks, libraries, or platforms (e.g., Python, Go, Kubernetes, GraphQL, vSphere, Terraform, Snowflake).
- Do NOT list product names, brand names, internal assistant names, or platform names that happen to appear capitalized in the JD (e.g., "Ruby AI", "Sage", "Copilot", "Einstein", "Watson"). These are products, not skills a candidate would learn.
- If a token appears in the JD only adjacent to words like "AI", "Cloud", "Assistant", "Platform", "Suite", or as the name of the hiring company's product, treat it as a proper noun and exclude it.
- When in doubt, omit — false positives here mislead the tailoring step downstream.

Return this JSON (no markdown fences, no commentary):
{
  "match_score": <0-100>,
  "matched_skills": ["skill1","skill2"],
  "missing_skills": ["gap1","gap2"],
  "key_themes": ["theme1","theme2"],
  "emphasis": "one of: AI/ML | Data Engineering | Backend | Full Stack",
  "headline": "one-line positioning statement for Sahil for this role"
}`;

    let jdRaw = '';
    if (!aborted) {
      await streamText(jdPrompt, 600, (chunk) => {
        jdRaw += chunk;
        if (!aborted) send({ step: 'jd', type: 'chunk', text: chunk });
      });
    }

    const jdParsed = safeParseJSON(jdRaw);
    if (jdParsed.error) {
      send({ step: 'jd', status: 'done', data: null, parseError: jdParsed.error });
      console.warn('JD analysis JSON parse failed:', jdParsed.error);
    } else {
      send({ step: 'jd', status: 'done', data: jdParsed.data });
    }

    const jdData = jdParsed.data;

    // ── STEP 2: Resume Tailoring (JSON-out) ───────────────────────────────────
    // The LLM emits JSON matching RESUME_BASE_JSON's schema. We parse, apply
    // adjacency-skill injection (deterministic, not LLM), then render the text
    // version for UI display + validation. PDF generation later uses the JSON
    // directly via generate_resume.py — text never round-trips.
    if (aborted) { res.end(); return; }
    send({ step: 'resume', status: 'start' });

    const emphasis = jdData?.emphasis || 'Backend';
    const resumePrompt = buildResumePrompt(job, emphasis);

    // Stream into a buffer instead of pushing chunks to UI — JSON tokens look
    // ugly mid-flight, and we render the polished text in one shot at the end.
    let resumeJsonRaw = '';
    await streamText(resumePrompt, 4000, (chunk) => {
      resumeJsonRaw += chunk;
      // Keep UI alive with a heartbeat that doesn't dump JSON tokens to it.
      if (!aborted && resumeJsonRaw.length % 400 < chunk.length) {
        send({ step: 'resume', type: 'progress', generated: resumeJsonRaw.length });
      }
    });

    let tailoredJson;
    const parsed = safeParseJSON(resumeJsonRaw);
    if (parsed.error) {
      console.warn('[resume] LLM did not return valid JSON, falling back to base. Error:', parsed.error);
      // Deep-clone the base: the skills lock and bullet guard below mutate
      // tailoredJson in place, so aliasing RESUME_BASE_JSON here would corrupt
      // the module-level base for subsequent requests.
      tailoredJson = JSON.parse(JSON.stringify(RESUME_BASE_JSON));
      send({ step: 'resume', type: 'warning', message: 'LLM JSON parse failed — using base resume. ' + parsed.error });
    } else {
      tailoredJson = parsed.data;
    }

    // LOCK identity fields. The tailoring LLM has mutated contact/name despite
    // the "preserve" instruction (2026-07-08 Glean run typo'd the LinkedIn slug
    // to ...87357b1b1b9, which flowed into both PDFs). Contact and name are
    // never tailored, so pin them to the base every run. Deep-clone so no
    // downstream mutation can leak back into RESUME_BASE_JSON. saveBundle.js
    // reads resumeJson.contact, so this also protects the cover PDF header.
    tailoredJson.contact = JSON.parse(JSON.stringify(RESUME_BASE_JSON.contact));
    tailoredJson.name = RESUME_BASE_JSON.name;

    // Post-LLM character-budget audit. Warn-only — the 3-tier render fallback
    // in pdfRender.js is the real safety net. This log gives a clear signal
    // BEFORE the render attempts, so prompt drift (LLM ignoring the budget
    // rule) is visible in the server console without waiting for a fallback.
    try {
      const tailoredChars = sumBulletChars(tailoredJson);
      // Audit against the margin-adjusted cap the prompt actually asks for, not
      // the raw base char count — the cap is what keeps the skills section on page.
      const overBudget = tailoredChars - TAILOR_CHAR_CAP;
      if (overBudget > 0) {
        console.warn(
          `[ai.tailoring] tailored output exceeds char budget by ${overBudget} chars ` +
          `(${tailoredChars} of ${TAILOR_CHAR_CAP} cap; base ${BASE_BULLET_CHAR_BUDGET}) — render fallback likely to fire`
        );
      } else if (overBudget < -200) {
        // Tailored is significantly under-budget — flag for the opposite
        // reason: page will render with bottom whitespace (the underfill gap
        // expansion in pdfRender was disabled because it produced visibly
        // puffy spacing vs the BASE render; tailored output now renders at
        // baseline gaps and any shortfall lands below the last section).
        console.log(
          `[ai.tailoring] tailored output is ${-overBudget} chars under budget ` +
          `(${tailoredChars} of ${TAILOR_CHAR_CAP} cap) — page may underfill`
        );
      }
    } catch (e) {
      console.warn('[ai.tailoring] budget audit threw:', e.message);
    }

    // Fix 1: LOCK the skills section (deterministic, root cause of the C++ leak).
    // The LLM must not author the skills section. Discard whatever it produced
    // for skills (labels and values) and rebuild from the BASE skills run through
    // applyAdjacency(jd tags): base categories are preserved and no skill token
    // can appear unless it is in the base or justified by ADJACENCY_MAP. Skills
    // NOT in the curated map are never added, so there is no fabrication path.
    const jdRequiredSkills = (jdData?.matched_skills || [])
      .concat(jdData?.missing_skills || [])
      .concat(job.tags || []);
    const adjacencyResult = lockSkillsSection(tailoredJson, RESUME_BASE_JSON, jdRequiredSkills);
    tailoredJson = adjacencyResult.json;
    // Chars adjacency added to the skills section: reserved from the bullet
    // budget below (Fix 2) so bullets plus grown skills stay in the one-page box.
    const skillsGrowth = adjacencyResult.skillsGrowth || 0;

    // Bullet-keyword guard (Part 3). Runs AFTER tailoring, BEFORE render/save.
    // Three checks, bullet-scoped one-shot regeneration, then base fallback.
    // Every flag is non-fatal: logged to console and surfaced on the SSE as a
    // warning. Gated by ENABLE_BULLET_KEYWORDS and wrapped so a hiccup here can
    // never break the pipeline (the tailored/base JSON still renders).
    let bulletKeywordResolutions = [];
    if (ENABLE_BULLET_KEYWORDS) {
      try {
        const enforced = await enforceBulletKeywords(
          tailoredJson, RESUME_BASE_JSON, CANDIDATE_FACTS,
          jdData || { tags: job.tags },
          { judge: defaultBulletJudge, regenerate: defaultBulletRegenerate }
        );
        tailoredJson = enforced.json;
        bulletKeywordResolutions = enforced.resolutions;
        for (const w of enforced.warnings) {
          console.warn('[ai.bullet-keywords] ' + w);
          if (!aborted) send({ step: 'resume', type: 'warning', message: 'Bullet keyword guard: ' + w });
        }
        // Cap reworded bullets to prevent keyword stuffing; revert the excess.
        const capped = capRewordedBullets(tailoredJson, RESUME_BASE_JSON, MAX_TAILORED_BULLETS);
        tailoredJson = capped.json;
        if (capped.reverted > 0) {
          const m = `reverted ${capped.reverted} bullet(s) to base wording to respect MAX_TAILORED_BULLETS=${MAX_TAILORED_BULLETS}`;
          console.log('[ai.bullet-keywords] ' + m);
          if (!aborted) send({ step: 'resume', type: 'warning', message: 'Bullet keyword guard: ' + m });
        }
      } catch (e) {
        console.warn('[ai.bullet-keywords] guard threw (non-fatal):', e.message);
      }
    }

    // Length-fit enforcement (2026-07-30 brief). Runs AFTER tailoring, skills
    // lock, and the keyword pass, and BEFORE render. Deterministically shortens
    // or reverts over-length bullets so the total stays within the one-page
    // budget (minus the skills-growth reserve), so the tailored resume ships
    // instead of falling back to base. Runs regardless of ENABLE_BULLET_KEYWORDS
    // (the outcome nudge can lengthen bullets even with the keyword guard off).
    // Wrapped non-fatal: the render fallback remains the final safety net.
    let lengthResolutions = [];
    try {
      const lenFit = await enforceBulletLength(
        tailoredJson, RESUME_BASE_JSON, CANDIDATE_FACTS,
        jdData || { tags: job.tags },
        { regenerate: defaultBulletShorten, judge: defaultBulletJudge, skillsGrowth }
      );
      tailoredJson = lenFit.json;
      lengthResolutions = lenFit.resolutions;
      for (const w of lenFit.warnings) {
        console.warn('[ai.length-fit] ' + w);
        if (!aborted) send({ step: 'resume', type: 'warning', message: 'Length fit: ' + w });
      }
      console.log(`[ai.length-fit] total bullet chars ${lenFit.totalChars} of budget ${lenFit.budget} (base ${BASE_BULLET_CHAR_BUDGET}, skills reserve ${skillsGrowth})`);
    } catch (e) {
      console.warn('[ai.length-fit] length enforcement threw (non-fatal):', e.message);
    }

    // Render text version for UI display + validation.
    const resumeText = renderResumeText(tailoredJson);
    const validation = validateResumeOutput(resumeText);
    const diff = generateResumeDiff(RESUME_BASE, resumeText);

    // Send the rendered text as a single chunk so the UI shows the final resume.
    send({ step: 'resume', type: 'chunk', text: resumeText });
    send({
      step: 'resume',
      status: 'done',
      validation,
      diff,
      adjacencyAdded: adjacencyResult.added,
      bulletKeywordResolutions,
      lengthResolutions,
    });

    // ── STEP 3: Cover Letter ───────────────────────────────────────────────────
    if (aborted) { res.end(); return; }
    send({ step: 'cover', status: 'start' });

    const coverPrompt = `Write a cover letter for Sahil Mehta applying to ${job.title} at ${job.company}.

Current date: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}.

CANDIDATE FACTS (use ONLY these — do not invent):
${CANDIDATE_FACTS}

JD-specific tech tags from this listing: ${job.tags.join(', ')}.

TARGET: ${job.title} at ${job.company}
JD: ${job.desc}

VOICE:
You're writing a letter that sounds like Sahil — a competent engineer who's thought carefully about why he wants this specific role — not a recruiter pitch optimized for keyword density. The reader should feel like they're meeting the candidate, not reading a stat sheet.

STRUCTURE (4 short paragraphs):
1. Opening — "Dear [hiring team or specific person]," then 2-3 sentences saying why THIS role specifically — what's distinctive about the work this company does, what about it pulled you in. Use the company's own language where natural. No "I'm applying because I'm excited about..."
2. The one specific moment — build the letter around exactly ONE concrete moment of judgment from the candidate's work. A bug caught, a tradeoff made, a wrong path corrected. Show the THINKING, not just the outcome. ~5-7 sentences. This paragraph carries the letter's credibility — everything else is scaffolding.
3. Conviction transfer — 2-3 sentences mapping that conviction to what the company is hiring for. What's the principle you'd bring? Where would it apply in their specific work?
4. Brief stack + close — 2-3 sentences naming the relevant tools (Python, TypeScript, etc.). Personal-project references are DOMAIN-GATED per the matrix below. If the JD's company description spent real words on values/culture (words like "humble", "hungry", "ownership", "transparency", "bring the weather"), mirror 1-2 of those values back in plain language. If the JD is purely transactional, skip the values mirror — don't force it. End with "Best,\\nSahil Mehta".

PERSONAL-PROJECT DOMAIN GATING (HARD RULE):
Reference a specific personal project with its GitHub URL ONLY when the JD's domain directly matches the project's domain. Default behavior is NO project reference — the eval-driven conviction from Enidus T-Mobile carries the safety/quality anchor for most letters. Use the matrix:

- chef-drop-brief (github.com/sahilmehta17/chef-drop-brief) — Growth/Lifecycle/Marketing-AI/CRM/Braze/Klaviyo/Customer.io/Postscript/Iterable/DTC subscription roles. Anything where the JD names lifecycle marketing, copy generation at scale, audience segmentation, or marketing-automation platforms. Outside this domain, drop entirely — referencing a marketing-AI project on a Rubrik security or Applied Intuition AV resume reads as bolted on and pattern-matches the candidate as a Growth-AI person to readers who don't care.

- ClaudeJob (github.com/sahilmehta17/claudejob) — forward-deployed-engineer, agentic-tool-building, LLM-pipeline-orchestration, AI-DevTools, or implementation-engineer roles where the meta-flex ("I use AI to apply to AI jobs") is on-tone. Skip for traditional backend, infra, or non-AI engineering roles.

- Denari RAG (capstone, no public repo) — explicit RAG / retrieval / vector-DB / enterprise-search roles. Reference by name + scale ("300K-embedding RAG over 22K docs, 73% QA accuracy") without a URL.

If none of the above projects match the JD domain cleanly, do NOT manufacture a project reference. The Enidus T-Mobile copilot is already the centerpiece of paragraph 2; that's sufficient credibility. A forced "I also built X" sentence at the end weakens an otherwise focused letter.

HARD RULES — violations cause rejection:
- Maximum 3 specific numbers across the entire letter. Each number must be a concrete anchor (specific scope or specific outcome), not a generic count. "Zero hallucination incidents" counts as a number. "15 tenants, 100+ users, 52 evals, 400+ invocations" is 4 numbers and would be rejected. Pick the 2-3 that matter most for this JD; drop the rest.
- ZERO em-dashes (—) or en-dashes (–) anywhere in the letter. They are a strong AI-writing tell and are strictly prohibited. Use commas, periods, colons, semicolons, or parentheses instead. Not even one is acceptable.
- No bullet lists or numbered lists. Prose only.
- NO markdown formatting of any kind: no **bold**, no *italics*, no \`code\` backticks, no headers. The letter is rendered as plain text, so any asterisk or backtick shows up literally and looks broken. Write emphasis through word choice, not symbols.
- No banned phrases: "leveraged", "spearheaded", "utilized", "results-driven", "dynamic professional", "passionate about", "excited to bring", "proven track record", "cutting-edge", "synergized", "revolutionized", "transformative", "game-changing", "best-in-class", "thought leader", "self-starter", "go-getter", "drove innovation", "deep expertise", "seasoned", "extensive experience", "ports the pattern", "stands out", "different domain", "the model".
- No "I'm excited to apply" / "I would be a great fit" / "I am writing to express my interest" — that whole register is forbidden.
- Write as Sahil, first person, plain language. A reader who doesn't know FastAPI from Flask should still be able to follow the story in paragraph 2.

DO NOT fabricate any claim, metric, or experience not listed in CANDIDATE FACTS. Do not embellish scope. Do not round numbers.

REGULATED-DOMAIN NOTE (use only if it fits the narrative — do NOT bolt it on as a separate paragraph):
If the TARGET company is in financial services, banking, telecom, healthcare, insurance, government, fintech, regtech, or compliance tech, the production-AI-against-regulated-enterprise-data signal is legitimately load-bearing — work it into paragraph 2 as part of the specific moment (e.g., "the dataset was customer billing data, where a hallucinated tool argument means a wrong invoice"). If the TARGET is general-purpose tooling or pure AI research, skip this signal entirely.

REGULATED-DOMAIN CANDIDATE-FACT ANCHORS (use sparingly, only when relevant):
T-Mobile billing accounts, device identifiers, line state transitions, multi-tenant reseller hierarchies, audit-traceable state-mutating operations.

OUTPUT FORMAT:
Return ONLY the letter body. Start with "Dear [salutation]," and end with "Best,\\nSahil Mehta". No date, no contact-info header, no commentary outside the letter. The saveBundle step adds the header and date.`;

    let coverText = '';
    await streamText(coverPrompt, 900, (chunk) => {
      coverText += chunk;
      if (!aborted) send({ step: 'cover', type: 'chunk', text: chunk });
    });
    // Hard guarantee: strip any em/en-dashes AND markdown emphasis markers the
    // model slipped past the prompt ban. Re-send the cleaned text so the UI's
    // final state and the saved bundle both use the clean version (the streamed
    // chunks above may have shown a dash or asterisk mid-flight; this overwrites
    // with the clean copy).
    coverText = stripMarkdown(sanitizeDashes(coverText));

    // Cover-letter fabrication guard (Fix 2). Four checks; one-shot regeneration
    // naming the violations; if it still fails, BLOCK and never save the flagged
    // letter. Wrapped non-fatal so a judge/API hiccup cannot break the pipeline.
    let coverBlocked = false;
    try {
      const enforcedCover = await enforceCoverLetter(
        coverText, CANDIDATE_FACTS, RESUME_BASE_JSON,
        { ...(jdData || {}), tags: job.tags, company: job.company, title: job.title },
        { judge: defaultCoverInversionJudge, incidentJudge: defaultCoverIncidentJudge, regenerate: defaultCoverRegenerate }
      );
      for (const w of enforcedCover.warnings) console.warn('[ai.cover-guard] ' + w);
      if (enforcedCover.blocked) {
        coverBlocked = true;
        const reasons = enforcedCover.flags.map(f => f.reason).join('; ');
        console.warn('[ai.cover-guard] BLOCKED after regeneration: ' + reasons);
        // Do not ship the fabricated letter. Replace with a truthful placeholder
        // so the saved bundle never contains fabricated claims.
        coverText = `Cover letter generation was blocked by the fabrication validator after one regeneration attempt. Reasons: ${reasons}. Please regenerate or edit this letter manually before sending.`;
        if (!aborted) send({ step: 'cover', status: 'blocked', message: 'Cover letter blocked by fabrication guard: ' + reasons, flags: enforcedCover.flags });
      } else {
        coverText = enforcedCover.text;
        if (enforcedCover.resolution === 'regenerated' && !aborted) {
          send({ step: 'cover', type: 'warning', message: 'Cover letter regenerated once to remove flagged content.' });
        }
      }
    } catch (e) {
      console.warn('[ai.cover-guard] guard threw (non-fatal):', e.message);
    }

    send({ step: 'cover', status: 'done', text: coverText, blocked: coverBlocked });

    // ── STEP 4: Q&A ────────────────────────────────────────────────────────────
    if (aborted) { res.end(); return; }
    send({ step: 'qa', status: 'start' });

    const defaultQs = [
      'Why are you interested in this role?',
      'Describe a challenging technical project you led end-to-end.',
      'How do you approach debugging a complex production issue?',
      `Tell us about your experience with ${job.tags[0] || 'your primary tech stack'}.`,
      'Where do you see yourself in 3 years?',
    ];

    const qaPrompt = `Answer these job application questions for Sahil Mehta applying to ${job.title} at ${job.company}.

CANDIDATE FACTS (use ONLY these — do not invent):
${CANDIDATE_FACTS}

QUESTIONS:
${defaultQs.map((q, i) => `${i + 1}. ${q}`).join('\n')}

RULES:
- 3-5 sentences per answer, first person, specific and concrete
- Cite real achievements with exact numbers from the candidate facts above
- Sound like a confident human, not a chatbot
- Never fabricate claims or metrics
- Tailor to ${job.company} specifically
- Return valid JSON array: [{"q":"...","a":"..."}]
- Return ONLY valid JSON. No markdown fences, no commentary.
- For questions about your background or fit, if the company is in a regulated-enterprise domain (financial services, telecom, healthcare, insurance, government, fintech), explicitly note the candidate's production experience with regulated enterprise data — billing data, customer identifiers, audit-traceable transactions, multi-tenant reseller hierarchies. This is rare experience at the 0-3yr level and a real differentiator for these domains.`;

    let qaRaw = '';
    await streamText(qaPrompt, 1800, (chunk) => {
      qaRaw += chunk;
      if (!aborted) send({ step: 'qa', type: 'chunk', text: chunk });
    });

    const qaParsed = safeParseJSON(qaRaw);
    if (qaParsed.error) {
      send({ step: 'qa', status: 'done', data: null, parseError: qaParsed.error });
      console.warn('Q&A JSON parse failed:', qaParsed.error);
    } else {
      send({ step: 'qa', status: 'done', data: qaParsed.data });
    }

    // ── STEP 5: Save bundle to ~/Desktop/JobApplications/{slug}/ ──────────────
    // Best-effort — if save fails (e.g., disk full, permissions), pipeline still
    // completes successfully and surfaces the error to the UI as a warning.
    let saveResult = null;
    try {
      saveResult = await saveApplicationBundle({
        company: job.company,
        title: job.title,
        resumeJson: tailoredJson,
        coverText,
        jdAnalysis: jdData,
        jdText: job.desc,
        candidateName: RESUME_BASE_JSON.name,
      });
      send({
        step: 'save',
        status: 'done',
        folder: saveResult.folder,
        files: saveResult.files,
        renderInfo: saveResult.renderInfo,
      });

      // Surface 3-tier render fallback to the UI. When the resume couldn't
      // render at adjusted spacing (or at all), the saved PDF on disk differs
      // from the tailored output the user just saw stream in — they MUST be
      // told before they submit, otherwise they ship the wrong artifact.
      const fb = saveResult.renderInfo && saveResult.renderInfo.resumeFallback;
      if (fb && fb !== 'none') {
        send({
          step: 'resume',
          status: 'warning',
          fallback: fb,
          fillPct: saveResult.renderInfo.resumeFillPct,
          message: fb === 'base-content'
            ? 'Tailored content was too long for 1 page — fell back to BASE resume. The PDF saved is your canonical base, not the tailored version shown above.'
            : 'Tailored content overflowed at adjusted spacing — fell back to default spacing. PDF is tailored but with reduced page fill.',
        });
      }

      // ── Post-generation validator ───────────────────────────────────────
      // Runs 12 deterministic checks against the saved bundle (file integrity,
      // identity drift, resume structure, cover salutation/signoff, JD
      // relevance). Catches the failure mode where Rubrik's resume shipped
      // as 0 bytes plus the FreedomCare-class issues (missing salutation,
      // wrong company spelling). Hard fails surface as a 'validation' SSE
      // event marked status:'fail' so the UI can block submit. We do NOT
      // auto-retry — the user decides.
      try {
        send({ step: 'validation', status: 'start' });
        const valResult = await runBundleChecks(saveResult.folder);
        const hardFails = valResult.checks.filter(c => !c.passed && c.severity !== 'warn');
        const warns     = valResult.checks.filter(c => !c.passed && c.severity === 'warn');
        const status    = hardFails.length === 0 ? 'done' : 'fail';
        send({
          step: 'validation',
          status,
          passed: valResult.checks.length - hardFails.length - warns.length,
          total:  valResult.checks.length,
          hardFails: hardFails.map(c => ({ name: c.name, reason: c.reason })),
          warns:     warns.map(c => ({ name: c.name, reason: c.reason })),
          checks:    valResult.checks,
        });
        if (hardFails.length > 0) {
          console.warn(
            `[validate] ${saveResult.folder} failed ${hardFails.length} check(s): ` +
            hardFails.map(c => `${c.name} (${c.reason})`).join('; ')
          );
        }
      } catch (e) {
        console.error('[validate] Validator threw:', e.message);
        send({ step: 'validation', status: 'error', message: e.message });
      }
    } catch (e) {
      console.error('[save] Failed to save application bundle:', e.message);
      send({ step: 'save', status: 'error', message: e.message });
    }

    // ── DONE ──────────────────────────────────────────────────────────────────
    send({
      step: 'complete',
      status: 'done',
      resume: resumeText,
      cover: coverText,
      qa: qaParsed.data,
      jd: jdData,
      resumeValidation: validation,
      resumeDiff: diff,
      savedTo: saveResult?.folder || null,
      adjacencyAdded: adjacencyResult.added,
      bulletKeywordResolutions,
      lengthResolutions,
    });
    res.end();

  } catch (e) {
    console.error('Pipeline stream error:', e.message, e.stack);
    send({ step: 'error', message: e.message });
    res.end();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ai/tailor-resume  (non-streaming fallback)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/tailor-resume', async (req, res) => {
  const { job } = req.body;
  if (!job) return res.status(400).json({ error: 'job object required' });
  if (!job.title || !job.company || !job.tags) {
    return res.status(400).json({ error: 'job must have title, company, and tags' });
  }

  const prompt = buildResumePrompt(job, 'Backend');

  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1800,
      messages: [{ role: 'user', content: prompt }],
    });
    const resumeText = msg.content[0].text;
    const validation = validateResumeOutput(resumeText);
    const diff = generateResumeDiff(RESUME_BASE, resumeText);
    res.json({ resume: resumeText, validation, diff });
  } catch (e) {
    console.error('tailor-resume error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ai/cover-letter
// ─────────────────────────────────────────────────────────────────────────────
router.post('/cover-letter', async (req, res) => {
  const { job, tone = 'Confident & direct' } = req.body;
  if (!job) return res.status(400).json({ error: 'job object required' });

  const prompt = `Write a cover letter for Sahil Mehta applying to ${job.title} at ${job.company}.

CANDIDATE FACTS (use ONLY these — do not invent):
- CS + Data Science UW-Madison 2025
- Enidus AI/Full-Stack Engineer: Node.js BFF (OAuth/PoP), multi-tenant RBAC reporting, RAG chatbot (FastAPI/Qdrant/GPT-4o-mini)
- RAG capstone: 73% accuracy, 40% latency reduction, 22K+ docs
- Core skills: ${job.tags.join(', ')}
JD: ${job.desc}
TONE: ${tone}

3 tight paragraphs. No filler openers ("excited to apply", "passionate about", etc.). Specific achievements with exact numbers. Direct close. Do not fabricate.
ZERO em-dashes (—) or en-dashes (–) anywhere; they are an AI-writing tell and are strictly prohibited. Use commas, periods, colons, or semicolons instead.
NO markdown: no **bold**, *italics*, or backticks. Plain text only (it renders literally otherwise).
Return ONLY the letter body (no date/header).`;

  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 900,
      messages: [{ role: 'user', content: prompt }],
    });
    res.json({ letter: stripMarkdown(sanitizeDashes(msg.content[0].text)) });
  } catch (e) {
    console.error('cover-letter error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ai/qa
// ─────────────────────────────────────────────────────────────────────────────
router.post('/qa', async (req, res) => {
  const { job, questions } = req.body;
  if (!job) return res.status(400).json({ error: 'job object required' });

  const defaultQs = [
    'Why are you interested in this role?',
    'Describe a challenging technical project you led end-to-end.',
    'How do you handle debugging a complex production issue?',
    `Tell us about your experience with ${job.tags?.[0] || 'your primary tech stack'}.`,
    'Where do you see yourself in 3 years?',
  ];
  const qs = questions?.length ? questions : defaultQs;

  const prompt = `Answer these questions for Sahil Mehta applying to ${job.title} at ${job.company}.
CANDIDATE FACTS (use ONLY these — do not invent): AI/Full-Stack Engineer at Enidus (Node.js BFF, OAuth, RBAC, RAG chatbot w/ 52 tests). RAG capstone (73% accuracy, 40% latency, 22K+ docs). Orahi (80% manual effort reduction). GSPANN (97% CNN accuracy). Skills: ${job.tags.join(', ')}.
QUESTIONS:
${qs.map((q, i) => `${i + 1}. ${q}`).join('\n')}
3-5 sentences each, first person, cite exact numbers. Do not fabricate claims. Return JSON array [{"q":"...","a":"..."}] only. No markdown fences.`;

  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    });
    const parsed = safeParseJSON(msg.content[0].text);
    if (parsed.error) {
      return res.status(502).json({ error: 'Model returned invalid JSON', detail: parsed.error });
    }
    res.json({ qa: parsed.data });
  } catch (e) {
    console.error('qa error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ai/custom-question
// ─────────────────────────────────────────────────────────────────────────────
router.post('/custom-question', async (req, res) => {
  const { question, job } = req.body;
  if (!question) return res.status(400).json({ error: 'question required' });

  const prompt = `Answer this application question for Sahil Mehta${job ? ` applying to ${job.title} at ${job.company}` : ''}.

QUESTION: ${question}

CANDIDATE FACTS (use ONLY these — do not invent): CS + DS grad UW-Madison 2025. Full-time AI/Full-Stack Engineer at Enidus (Node.js BFF, OAuth/PoP, multi-tenant RBAC reporting, RAG AI chatbot with FastAPI/Qdrant, 52 pytest tests). RAG capstone (22K docs, 73% accuracy, 40% latency reduction). Core skills: Node.js, TypeScript, Python, PostgreSQL, AWS, PyTorch, Apache Spark.

3-5 sentences, first person, cite specific achievements with exact numbers from the facts above. Do not fabricate. Confident, human tone. Return ONLY the answer text.`;

  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
    });
    res.json({ answer: msg.content[0].text });
  } catch (e) {
    console.error('custom-question error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ai/analyze-jd  — analyze a pasted JD
// ─────────────────────────────────────────────────────────────────────────────
router.post('/analyze-jd', async (req, res) => {
  const { jd } = req.body;
  if (!jd) return res.status(400).json({ error: 'jd text required' });
  if (jd.length < 50) return res.status(400).json({ error: 'JD text too short — paste the full description' });

  const prompt = `Analyze this job description and return structured JSON only.

JD TEXT: ${jd}

Sahil's profile: Node.js, TypeScript, Python, PostgreSQL, AWS, PyTorch, RAG, Qdrant, Apache Spark, REST APIs, Docker, Flask, FastAPI, React, Angular, SQL Server, TimescaleDB.

Return this JSON (no markdown fences, no commentary):
{
  "title": "inferred title",
  "company": "company name if visible",
  "skills": ["skill1","skill2"],
  "experience_years": "e.g. 0-2",
  "role_type": "one of: AI Engineer | Software Engineer | Data Engineer | Data Scientist | ML Engineer",
  "key_themes": ["theme1","theme2"],
  "match_score": <0-100>,
  "matched_skills": ["matched1"],
  "missing_skills": ["gap1"],
  "headline": "one-line positioning statement for Sahil"
}`;

  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    });
    const parsed = safeParseJSON(msg.content[0].text);
    if (parsed.error) {
      return res.status(502).json({ error: 'Model returned invalid JSON', detail: parsed.error });
    }
    res.json(parsed.data);
  } catch (e) {
    console.error('analyze-jd error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ai/bulk-qa — answer any list of questions in one call
// Body: { questions: string[], job?: object }
// Returns: { qa: [{q, a}] }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/bulk-qa', async (req, res) => {
  const { questions, job } = req.body;
  if (!questions || !Array.isArray(questions) || questions.length === 0) {
    return res.status(400).json({ error: 'questions array required' });
  }
  if (questions.length > 25) {
    return res.status(400).json({ error: 'Max 25 questions per call' });
  }

  const roleCtx = job ? `${job.title} at ${job.company}` : 'a software engineering role';
  const skillCtx = job?.tags?.length ? job.tags.join(', ') : 'Node.js, TypeScript, Python, PostgreSQL, AWS, PyTorch, RAG, Docker';

  const prompt = `You are answering job application questions on behalf of Sahil Mehta, applying for ${roleCtx}.

CANDIDATE FACTS — use ONLY these, never invent:
- CS + Data Science double major, University of Wisconsin-Madison, May 2025
- AI/Full-Stack Engineer at Enidus USA LLC (full-time, Jun 2025–present, NYC):
  • RAG AI Chatbot: FastAPI, GPT-4o-mini, Qdrant, 3-layer security (parameterized SQL + session scoping + RLS), 8 RBAC roles, 6-intent classifier, 9 audit tables, 52 pytest tests; React/TypeScript chat UI; Dockerized
  • Node.js BFF for T-Mobile carrier APIs: OAuth/PoP auth, secure header signing, Axios orchestration with retry/fallback
  • Multi-tenant reporting system: RBAC enforcement, parameterized queries, cron scheduling, CSRF/XSS protection
- RAG capstone (Denari, Jan–May 2025): 22K+ docs, 300K+ embeddings, 73% QA accuracy, 40% latency reduction, 25+ features, TypeScript/TimescaleDB/Docker/S3/OpenAI
- Orahi internship (Jul–Aug 2024): bus route algorithm (80% manual effort reduction), Flask REST APIs (15% latency improvement), K-means clustering (10% crash reduction)
- GSPANN internship (Jun–Aug 2023): CNN pneumonia detection, 97% test accuracy
- Core skills: ${skillCtx}
- Work authorization: US authorized, no sponsorship needed

QUESTIONS TO ANSWER:
${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}

RULES:
- Answer each question in 3–5 sentences, first person, conversational but professional
- Cite specific numbers and achievements from the facts above — never round or inflate them
- Tailor each answer to ${job ? `${job.company} and ` : ''}the question asked
- If a question is personal preference (e.g. pronouns, salary, availability), provide a direct factual answer based on: pronouns=he/him, salary=open to market rate, availability=2 weeks notice or immediate
- If it's a values/culture question, answer authentically based on Sahil's actual work (collaboration, clear systems, ownership)
- Sound human — not corporate, not a chatbot, not a resume bullet list
- Never fabricate tools, metrics, or experience not in the facts above

Return ONLY a valid JSON array with no markdown fences:
[{"q": "exact question text", "a": "answer text"}, ...]`;

  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300 * questions.length + 200,
      messages: [{ role: 'user', content: prompt }],
    });
    const parsed = safeParseJSON(msg.content[0].text);
    if (parsed.error) {
      return res.status(502).json({ error: 'Model returned invalid JSON', detail: parsed.error, raw: msg.content[0].text.slice(0, 500) });
    }
    res.json({ qa: parsed.data });
  } catch (e) {
    console.error('bulk-qa error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ai/resume-base — return the source resume for diff display
// ─────────────────────────────────────────────────────────────────────────────
router.get('/resume-base', (req, res) => {
  res.json({ resume: RESUME_BASE });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ai/validate-resume — validate resume text against guardrails
// ─────────────────────────────────────────────────────────────────────────────
router.post('/validate-resume', (req, res) => {
  const { resume } = req.body;
  if (!resume) return res.status(400).json({ error: 'resume text required' });
  const validation = validateResumeOutput(resume);
  const diff = generateResumeDiff(RESUME_BASE, resume);
  res.json({ validation, diff });
});

module.exports = router;
module.exports.RESUME_BASE = RESUME_BASE;
module.exports.validateResumeOutput = validateResumeOutput;
module.exports.generateResumeDiff = generateResumeDiff;
module.exports.safeParseJSON = safeParseJSON;
module.exports.BANNED_RESUME_PHRASES = BANNED_RESUME_PHRASES;
// Bullet-keyword validator surface (Part 3).
module.exports.validateTailoredBullets = validateTailoredBullets;
module.exports.enforceBulletKeywords = enforceBulletKeywords;
module.exports.capRewordedBullets = capRewordedBullets;
module.exports.TECH_VOCAB = TECH_VOCAB;
module.exports.METRIC_OWNERSHIP = METRIC_OWNERSHIP;
module.exports.ENABLE_BULLET_KEYWORDS = ENABLE_BULLET_KEYWORDS;
module.exports.MAX_TAILORED_BULLETS = MAX_TAILORED_BULLETS;
// Skills lock (Fix 1).
module.exports.lockSkillsSection = lockSkillsSection;
// Cover-letter validator (Fix 2).
module.exports.validateCoverLetter = validateCoverLetter;
module.exports.enforceCoverLetter = enforceCoverLetter;
// Length-fit enforcement (2026-07-30 brief).
module.exports.enforceBulletLength = enforceBulletLength;
