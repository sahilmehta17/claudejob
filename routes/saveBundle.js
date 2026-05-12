// ─────────────────────────────────────────────────────────────────────────────
// saveBundle.js — Persist a completed pipeline run to ~/Desktop/JobApplications/{slug}/
//
// Files written per job:
//   - {Candidate}_Resume.pdf         (via generate_resume.py)
//   - {Candidate}_CoverLetter.txt    (raw text for paste-into-form)
//   - {Candidate}_CoverLetter.pdf    (via generate_cover_letter.py)
//   - JD_Analysis.json               (the structured JD breakdown)
//
// Folder name format: {Company}_{Title}_{YYYY-MM-DD-HHMM}
// Date suffix prevents collisions when re-running the same job.
// ─────────────────────────────────────────────────────────────────────────────

const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { renderResumePdf, renderCoverPdf } = require('./pdfRender');

// Where to save bundles. Override with JOB_BUNDLE_DIR env var if you want to
// keep them somewhere else (e.g. straight on the Desktop).
const BUNDLE_ROOT = process.env.JOB_BUNDLE_DIR
  || path.join(os.homedir(), 'Desktop', 'Internships and Resume', 'JobApplications');

// ─────────────────────────────────────────────────────────────────────────────
// Sanitize a string into a filesystem-safe slug component.
// Keeps letters, digits, and hyphens; collapses everything else to a single '-'.
// ─────────────────────────────────────────────────────────────────────────────
function slug(s) {
  return String(s || '')
    .normalize('NFKD')                           // strip accents
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')              // non-alphanumerics → hyphen
    .replace(/^-+|-+$/g, '')                     // trim leading/trailing hyphens
    .slice(0, 60)                                // cap length per segment
    || 'unknown';
}

function timestamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
         `-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function buildFolderName(company, title) {
  return `${slug(company)}_${slug(title)}_${timestamp()}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// saveApplicationBundle({ company, title, resumeJson, coverText, jdAnalysis, candidateName })
// Returns { folder, files: { resumePdf, coverTxt, coverPdf, jdJson } }
//
// PDF generation is in-process via pdfkit (no Python, no spawn). Writes are
// awaited so the function only resolves once both PDFs are flushed to disk.
// ─────────────────────────────────────────────────────────────────────────────
async function saveApplicationBundle({
  company, title, resumeJson, coverText, jdAnalysis, candidateName,
}) {
  if (!resumeJson || !coverText) {
    throw new Error('saveApplicationBundle requires resumeJson and coverText');
  }

  // Create the bundle folder.
  await fs.mkdir(BUNDLE_ROOT, { recursive: true });
  const folder = path.join(BUNDLE_ROOT, buildFolderName(company, title));
  await fs.mkdir(folder, { recursive: true });

  const namePrefix = slug(candidateName || resumeJson.name || 'Candidate').replace(/-/g, '_');
  const resumePdf = path.join(folder, `${namePrefix}_Resume.pdf`);
  const coverTxt  = path.join(folder, `${namePrefix}_CoverLetter.txt`);
  const coverPdf  = path.join(folder, `${namePrefix}_CoverLetter.pdf`);
  const jdJson    = path.join(folder, 'JD_Analysis.json');

  // Write JD analysis JSON.
  if (jdAnalysis) {
    await fs.writeFile(jdJson, JSON.stringify(jdAnalysis, null, 2), 'utf8');
  }

  // Write cover letter as plain text.
  await fs.writeFile(coverTxt, coverText.trim() + '\n', 'utf8');

  // Build the cover letter content payload (letterhead + date + body).
  const coverContent = {
    name: resumeJson.name || candidateName || 'Candidate',
    contact: resumeJson.contact || [],
    date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    body: coverText.trim(),
  };

  // Generate both PDFs in parallel — pure JS, no spawn.
  const errors = [];
  await Promise.all([
    renderResumePdf(resumeJson, resumePdf).catch(e => errors.push(`resume: ${e.message}`)),
    renderCoverPdf(coverContent, coverPdf).catch(e => errors.push(`cover: ${e.message}`)),
  ]);

  if (errors.length) {
    throw new Error(`PDF generation failed: ${errors.join('; ')}`);
  }

  return {
    folder,
    files: { resumePdf, coverTxt, coverPdf, jdJson: jdAnalysis ? jdJson : null },
  };
}

module.exports = { saveApplicationBundle, slug, buildFolderName };
