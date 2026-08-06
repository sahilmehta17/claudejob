// ─────────────────────────────────────────────────────────────────────────────
// layout_harness.js — offline verification harness for resume LAYOUT work.
//
// Why this exists: layout changes cannot be verified by unit tests alone. The
// only honest check is "render real tailored output for real JDs and measure the
// page." This harness replays the same post-LLM pipeline the SSE route runs
// (identity lock -> skills lock -> bullet-keyword guard -> length fit -> render)
// against a saved JD bundle, and reports the numbers that matter for layout:
// which render tier landed, the realized page fill, and the page count.
//
// The LLM tailoring call is CACHED per JD (--cache) so a before/after comparison
// measures the layout change and not LLM sampling noise. Delete the cache file
// to force a fresh tailoring call.
//
// The JD analysis step is read from the bundle's own JD_Analysis.json rather
// than re-prompted, so the harness cannot drift from the route's analysis prompt
// and every run for a given JD sees identical jdRequiredSkills.
//
// Usage:
//   node scripts/layout_harness.js --jd=<bundleFolderName> --out=<dir> \
//        [--cache=<file>] [--label=<before|after>]
// ─────────────────────────────────────────────────────────────────────────────

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const {
  RESUME_BASE_JSON, CANDIDATE_FACTS, renderResumeText, enforceSectionOrder,
  ENTRY_POOL, selectEntries, BASE_BULLET_CHAR_BUDGET, enforceProjectDateOrder,
} = require('../routes/resumeContent');
const ai = require('../routes/ai');
const { renderResumePdf } = require('../routes/pdfRender');

const BUNDLE_ROOT = path.join(
  os.homedir(), 'Desktop', 'Internships and Resume', 'JobApplications'
);

function arg(name, fallback) {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

async function main() {
  const bundle = arg('jd');
  const outDir = arg('out', path.join(os.tmpdir(), 'layout-harness'));
  const label = arg('label', 'run');
  const cacheFile = arg('cache');
  if (!bundle) throw new Error('--jd=<bundleFolderName> is required');

  const bundleDir = path.join(BUNDLE_ROOT, bundle);
  const jdText = fs.readFileSync(path.join(bundleDir, 'JD_Original.txt'), 'utf8').trim();
  const jdData = JSON.parse(fs.readFileSync(path.join(bundleDir, 'JD_Analysis.json'), 'utf8'));

  // Reconstruct the job object the SSE route receives. `tags` on a live posting
  // is the platform's skill-tag list; the saved analysis's matched_skills is the
  // faithful stand-in and keeps jdRequiredSkills identical across runs.
  const job = {
    title: jdData.title,
    company: jdData.company,
    desc: jdText,
    tags: jdData.matched_skills || [],
  };

  fs.mkdirSync(outDir, { recursive: true });

  // ── Deterministic entry selection (matches routes/ai.js) ───────────────────
  const jdRequiredSkills = (jdData.matched_skills || [])
    .concat(jdData.missing_skills || [])
    .concat(job.tags || []);
  const jdText = `${job.title || ''} ${job.desc || ''} ${(job.tags || []).join(' ')}`;
  const selection = selectEntries(ENTRY_POOL, jdRequiredSkills, jdText, BASE_BULLET_CHAR_BUDGET);
  const jdBaseJson = selection.json;
  console.log('[harness] selected: ' + selection.selected.map(s => s.id).join(', '));
  console.log('[harness] dropped: ' + selection.dropped.map(d => d.id).join(', '));

  // ── STEP 2 equivalent: LLM resume tailoring (cached) ───────────────────────
  let tailoredJson;
  if (cacheFile && fs.existsSync(cacheFile)) {
    tailoredJson = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    console.log(`[harness] tailored JSON loaded from cache: ${path.basename(cacheFile)}`);
  } else {
    const emphasis = jdData.emphasis || 'Backend';
    const prompt = ai.buildResumePrompt(job, emphasis, jdBaseJson);
    let raw = '';
    await ai.streamText(prompt, 4000, (c) => { raw += c; });
    const parsed = ai.safeParseJSON(raw);
    if (parsed.error) throw new Error(`LLM JSON parse failed: ${parsed.error}`);
    tailoredJson = parsed.data;
    if (cacheFile) {
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify(tailoredJson, null, 2), 'utf8');
      console.log(`[harness] tailored JSON cached: ${path.basename(cacheFile)}`);
    }
  }

  // ── Identity lock (contact + name are never tailored) ──────────────────────
  tailoredJson.contact = JSON.parse(JSON.stringify(RESUME_BASE_JSON.contact));
  tailoredJson.name = RESUME_BASE_JSON.name;

  // ── Skills lock (deterministic adjacency, LLM skills discarded) ────────────
  // Skills are identical across selections, so lock against the canonical base.
  const adjacency = ai.lockSkillsSection(tailoredJson, RESUME_BASE_JSON, jdRequiredSkills);
  tailoredJson = adjacency.json;
  const skillsGrowth = adjacency.skillsGrowth || 0;

  // ── Section order lock (Fix 3) + project date-order lock ───────────────────
  tailoredJson = enforceSectionOrder(tailoredJson);
  tailoredJson = enforceProjectDateOrder(tailoredJson);

  // ── Bullet-keyword guard + reword cap ──────────────────────────────────────
  // Validate against the per-JD selected base so swapped-in entries are in scope.
  if (ai.ENABLE_BULLET_KEYWORDS) {
    const enforced = await ai.enforceBulletKeywords(
      tailoredJson, jdBaseJson, CANDIDATE_FACTS, jdData,
      { judge: ai.defaultBulletJudge, regenerate: ai.defaultBulletRegenerate }
    );
    tailoredJson = enforced.json;
    const capped = ai.capRewordedBullets(tailoredJson, jdBaseJson, ai.MAX_TAILORED_BULLETS);
    tailoredJson = capped.json;
  }

  // ── Length fit ─────────────────────────────────────────────────────────────
  const lenFit = await ai.enforceBulletLength(
    tailoredJson, jdBaseJson, CANDIDATE_FACTS, jdData,
    { regenerate: ai.defaultBulletShorten, judge: ai.defaultBulletJudge, skillsGrowth }
  );
  tailoredJson = lenFit.json;

  // ── Render ─────────────────────────────────────────────────────────────────
  const pdfPath = path.join(outDir, `${bundle}__${label}.pdf`);
  try { fs.unlinkSync(pdfPath); } catch (_) { /* fine if absent */ }
  const render = await renderResumePdf(tailoredJson, pdfPath);

  // Page count straight off the artifact, independent of the renderer's own
  // measurement, so a measure/render divergence cannot hide here.
  let pages = null;
  try {
    const info = execFileSync('pdfinfo', [pdfPath], { encoding: 'utf8' });
    const m = info.match(/^Pages:\s+(\d+)/m);
    pages = m ? Number(m[1]) : null;
  } catch (_) { /* pdfinfo optional */ }

  const resumeText = renderResumeText(tailoredJson);
  fs.writeFileSync(path.join(outDir, `${bundle}__${label}.txt`), resumeText, 'utf8');
  fs.writeFileSync(
    path.join(outDir, `${bundle}__${label}.json`),
    JSON.stringify(tailoredJson, null, 2), 'utf8'
  );

  const validation = ai.validateResumeOutput(resumeText);
  const result = {
    jd: bundle,
    label,
    emphasis: jdData.emphasis,
    fallback: render.fallback,
    fillPct: Number((render.fillPct * 100).toFixed(1)),
    pages,
    bulletChars: lenFit.totalChars,
    budget: lenFit.budget,
    skillsGrowth,
    selectedEntries: selection.selected.map(s => s.id),
    droppedEntries: selection.dropped.map(d => d.id),
    adjacencyAdded: adjacency.added.map(a => a.skill),
    sectionOrder: (tailoredJson.sections || []).map(s => s.header),
    validationValid: validation.valid,
    validationWarnings: validation.warnings || [],
    bannedFound: validation.bannedFound || [],
    pdf: pdfPath,
    sizeBytes: fs.statSync(pdfPath).size,
  };
  console.log('RESULT ' + JSON.stringify(result));
}

main().catch(e => { console.error('HARNESS ERROR:', e.message); process.exit(1); });
