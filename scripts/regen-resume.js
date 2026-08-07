// ─────────────────────────────────────────────────────────────────────────────
// regen-resume.js — rebuild ALL canonical base-resume files from RESUME_BASE_JSON.
//
// One command to refresh the three artifacts under ../../active/ after editing
// resumeContent.js:
//   - Sahil_Mehta_Resume_BASE.pdf       (full contact)
//   - Sahil_Mehta_Resume_BASE.docx      (Word)
//   - Sahil_Mehta_Resume_PII_SAFE.pdf   (phone/email/city removed)
//
// Run: npm run regen-resume   (from ClaudeJob/files)
//
// The PII-safe file is delegated to the maintained scripts/generate-pii-safe.js
// so the redaction rules live in exactly one place.
// ─────────────────────────────────────────────────────────────────────────────

const path = require('path');
const { execFileSync } = require('child_process');
const { RESUME_BASE_JSON } = require('../routes/resumeContent');
const { renderResumePdf } = require('../routes/pdfRender');
const { renderResumeDocx } = require('../routes/docxRender');

// __dirname = ClaudeJob/files/scripts → ../../.. = "Internships and Resume"
const ACTIVE = path.resolve(__dirname, '../../..', 'active');

async function main() {
  const basePdf = path.join(ACTIVE, 'Sahil_Mehta_Resume_BASE.pdf');
  const r = await renderResumePdf(RESUME_BASE_JSON, basePdf);
  console.log(`BASE.pdf   -> ${basePdf}  (fallback=${r.fallback}, fill=${(r.fillPct * 100).toFixed(1)}%)`);
  if (r.fallback && r.fallback !== 'none') {
    console.warn(`WARN: renderer fell back to "${r.fallback}" — base may have grown beyond one page`);
  }

  const baseDocx = path.join(ACTIVE, 'Sahil_Mehta_Resume_BASE.docx');
  await renderResumeDocx(RESUME_BASE_JSON, baseDocx);
  console.log(`BASE.docx  -> ${baseDocx}`);

  // Reuse the maintained PII-safe generator (single source of truth for redaction).
  execFileSync('node', [path.join(__dirname, 'generate-pii-safe.js')], { stdio: 'inherit' });

  console.log('\nAll base-resume files regenerated.');
}

main().catch((err) => {
  console.error('regen-resume failed:', err);
  process.exit(1);
});
