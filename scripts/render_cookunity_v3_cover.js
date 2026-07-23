// One-off: render the CookUnity v3 cover letter to PDF using ClaudeJob's
// existing renderCoverPdf. Pure local — no API call.

const fs = require('fs');
const path = require('path');
const { renderCoverPdf } = require('../routes/pdfRender');
const { RESUME_BASE_JSON } = require('../routes/resumeContent');

// Resolve the JobApplications folder by walking up from __dirname. This is
// portable between the user's Mac (~/Desktop/Internships and Resume/...) and
// any sandbox mount (/sessions/.../mnt/Internships and Resume/...).
const folder = path.resolve(
  __dirname, '..', '..', '..',
  'JobApplications',
  'Cook-Unity_AI-Native-Engineer-Growth-Marketing_2026-05-16-2013',
);

const bodyPath = path.join(folder, 'Sahil_Mehta_CoverLetter_v3_body.txt');
const outPdf = path.join(folder, 'Sahil_Mehta_CoverLetter.pdf');
const outTxt = path.join(folder, 'Sahil_Mehta_CoverLetter.txt');

const body = fs.readFileSync(bodyPath, 'utf8').trim();

const content = {
  name: RESUME_BASE_JSON.name,
  contact: RESUME_BASE_JSON.contact,
  date: new Date('2026-05-16').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
  body,
};

(async () => {
  console.log('[render] writing PDF to', outPdf);
  await renderCoverPdf(content, outPdf);
  const stat = fs.statSync(outPdf);
  console.log('[done] PDF size:', stat.size, 'bytes');
  // Also overwrite the .txt for consistency
  fs.writeFileSync(outTxt, body + '\n');
  console.log('[done] TXT also updated');
})();
