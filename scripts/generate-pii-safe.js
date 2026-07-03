// ─────────────────────────────────────────────────────────────────────────────
// generate-pii-safe.js — one-off generator for a recruiter-safe resume PDF.
//
// Purpose: produce a resume variant with phone, personal email, and specific
// city removed. Keeps name, LinkedIn, GitHub, portfolio — recruiters can still
// verify identity and reach out via LinkedIn.
//
// Run: node scripts/generate-pii-safe.js
// Output: ../../active/Sahil_Mehta_Resume_PII_SAFE.pdf (path relative to
//         ClaudeJob/files/scripts/ — resolves to
//         /Users/sahilmehtx/Desktop/Internships and Resume/active/)
// ─────────────────────────────────────────────────────────────────────────────

const path = require('path');
const { RESUME_BASE_JSON } = require('../routes/resumeContent');
const { renderResumePdf } = require('../routes/pdfRender');

const OUTPUT_PATH = path.resolve(
  __dirname,
  '../../..',
  'active',
  'Sahil_Mehta_Resume_PII_SAFE.pdf'
);

const PII_SAFE_CONTACT = [
  'Open to relocation',
  { text: 'sahilmehta.dev', url: 'https://sahilmehta.dev' },
  { text: 'Github', url: 'https://github.com/sahilmehta17' },
  { text: 'Linkedin', url: 'https://www.linkedin.com/in/sahil-mehta-87357b1b9/' },
];

async function main() {
  const piiSafeJson = JSON.parse(JSON.stringify(RESUME_BASE_JSON));
  piiSafeJson.contact = PII_SAFE_CONTACT;

  const result = await renderResumePdf(piiSafeJson, OUTPUT_PATH);
  console.log('Generated:', OUTPUT_PATH);
  // renderResumePdf returns fallback as a string enum: 'none' means the
  // tailored render landed cleanly; anything else means it fell back a tier.
  if (result && result.fallback && result.fallback !== 'none') {
    console.warn('WARN: renderer fell back to', result.fallback, '— PII-safe PDF may look thin');
  }
  if (result && typeof result.fillPct === 'number') {
    console.log('Fill %:', (result.fillPct * 100).toFixed(1));
  }
}

main().catch((err) => {
  console.error('generate-pii-safe failed:', err);
  process.exit(1);
});
