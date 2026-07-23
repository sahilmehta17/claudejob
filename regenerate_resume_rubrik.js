// One-off: regenerate the Rubrik resume PDF for the 20:51 re-run.
//
// Why: the original tailoring run produced a 0-byte PDF (tailoring discarded,
// fallback path failed too). The current RESUME_BASE_JSON has chef-drop-brief
// added but no compensating trim, so it overflows to 2 pages — the tier-3
// fallback throws. This script builds a Rubrik-tailored variant of the base
// JSON: keeps the chef-drop-brief project (cover letter relies on it),
// trims it to one tight bullet, drops the lowest-RBAC-relevance Reports bullet,
// and renders via the existing pdfkit renderer.
//
// Conservative edits only: every fact (numbers, tools, companies, claims)
// is preserved verbatim from RESUME_BASE_JSON. No LLM in the loop.

const path = require('path');
const fs = require('fs');
const { RESUME_BASE_JSON } = require('./routes/resumeContent');
const { renderResumePdf } = require('./routes/pdfRender');

const OUT = path.join(
  process.env.HOME,
  'Desktop/Internships and Resume/JobApplications',
  'Rubrik_Software-Engineer-Ruby-AI_2026-05-16-2051',
  'Sahil_Mehta_Resume.pdf'
);

// Deep clone so we don't mutate the shared base.
const tailored = JSON.parse(JSON.stringify(RESUME_BASE_JSON));

// Three projects (chef-drop-brief + ClaudeJob + RAG) overflows page 1 because
// the budget in resumeContent.js was set when only 2 projects existed and
// hasn't been recalibrated since chef-drop-brief was added. Drop chef-drop-brief
// from the resume — the cover letter cites it by URL and carries the eval-gated
// narrative there, so the recruiter still sees it. ClaudeJob (agentic pipeline)
// and RAG (retrieval) cover the rest of the Rubrik JD's themes.
const projectsSection = tailored.sections.find(s => s.type === 'projects');
projectsSection.items = projectsSection.items.filter(
  i => !i.title.startsWith('chef-drop-brief')
);

// Even after dropping chef-drop-brief the current renderer constants (gaps
// loosened from 4→7pt) still overflow by a few lines. Drop the lowest-RBAC
// relevance Reports bullet too — the AI Copilot subsection already carries
// the multi-tenant defense-in-depth story (Pydantic + RLS + 8-role RBAC) that
// the Rubrik JD's "honoring RBAC and security boundaries" line calls out.
const enidus = tailored.sections.find(s => s.type === 'experience')
  .items.find(i => i.title.startsWith('Software Developer, Enidus'));
const reports = enidus.subsections.find(s => s.name.startsWith('Custom Reports'));
reports.bullets = reports.bullets.filter(
  b => !b.startsWith('Hardened against multi-tenant attack classes')
);

(async () => {
  try { fs.unlinkSync(OUT); } catch (_) { /* ok if absent */ }
  const result = await renderResumePdf(tailored, OUT);
  const sizeBytes = fs.statSync(OUT).size;
  console.log(JSON.stringify({
    path: result.path,
    fallback: result.fallback,
    fillPct: Number(result.fillPct?.toFixed?.(3) ?? result.fillPct),
    sizeBytes,
  }, null, 2));
})().catch(e => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
