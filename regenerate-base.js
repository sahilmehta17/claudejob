// ─────────────────────────────────────────────────────────────────────────────
// regenerate-base.js — Standalone base-resume regenerator.
//
// Reads RESUME_BASE_JSON from routes/resumeContent.js and writes a fresh PDF
// + DOCX to ../../JobApplications/_BASE_PREVIEW/. Run this whenever the
// canonical resume content changes (e.g., after editing resumeContent.js).
//
// Usage:
//   node regenerate-base.js
//   node regenerate-base.js /custom/output/dir
// ─────────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');

const { RESUME_BASE_JSON } = require('./routes/resumeContent');
const { renderResumePdf } = require('./routes/pdfRender');
const { renderResumeDocx } = require('./routes/docxRender');

async function main() {
  // Default output: ../../JobApplications/_BASE_PREVIEW relative to this file.
  // Layout is: Internships and Resume/{ClaudeJob/files, JobApplications, Portfolio}
  // so going up two from this script lands on "Internships and Resume".
  const here = __dirname; // .../ClaudeJob/files
  const root = path.resolve(here, '..', '..'); // .../Internships and Resume
  const defaultOut = path.join(root, 'JobApplications', '_BASE_PREVIEW');
  const outDir = process.argv[2] || defaultOut;
  fs.mkdirSync(outDir, { recursive: true });

  const pdfPath = path.join(outDir, 'Sahil_Mehta_Resume_BASE.pdf');
  const docxPath = path.join(outDir, 'Sahil_Mehta_Resume_BASE.docx');

  console.log(`→ Regenerating base resume from RESUME_BASE_JSON`);
  console.log(`  Output dir: ${outDir}`);

  const t0 = Date.now();
  await Promise.all([
    renderResumePdf(RESUME_BASE_JSON, pdfPath).then(() =>
      console.log(`  ✓ PDF:  ${pdfPath}`)
    ),
    renderResumeDocx(RESUME_BASE_JSON, docxPath).then(() =>
      console.log(`  ✓ DOCX: ${docxPath}`)
    ),
  ]);

  // Also mirror the PDF into the portfolio's public folder so the live site's
  // "Resume PDF" link serves the latest version. Relative-path resolution
  // again, for sandbox + machine portability.
  const portfolioPdf = path.join(
    root,
    'Portfolio',
    'sahilmehta-portfolio',
    'public',
    'Sahil_Mehta_Resume.pdf'
  );
  if (fs.existsSync(path.dirname(portfolioPdf))) {
    fs.copyFileSync(pdfPath, portfolioPdf);
    console.log(`  ✓ Mirrored PDF → ${portfolioPdf}`);
  }

  console.log(`\n✓ Done in ${Date.now() - t0}ms`);
}

main().catch((err) => {
  console.error('Failed to regenerate base:', err);
  process.exit(1);
});
