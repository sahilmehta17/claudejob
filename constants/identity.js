// ─────────────────────────────────────────────────────────────────────────────
// constants/identity.js — Canonical identity strings.
//
// Single source of truth for the candidate's public identity URLs, email, and
// phone. Used by the post-generation validator (scripts/validate.js) to detect
// "identity drift" — when a tailoring or rendering bug produces a PDF that
// links to a stale or typo'd profile URL.
//
// These values must match the contact items rendered by RESUME_BASE_JSON in
// routes/resumeContent.js and the cover-letter contact payload built in
// routes/saveBundle.js. If you rotate any of these (new LinkedIn slug, new
// phone number, etc.), update this file AND the corresponding entry in
// routes/resumeContent.js — the validator will start failing on the next run
// and surface the discrepancy.
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  LINKEDIN_URL: 'https://www.linkedin.com/in/sahil-mehta-87357b1b9/',
  GITHUB_URL:   'https://github.com/sahilmehta17',
  EMAIL:        'sahilmehta0204@gmail.com',
  PHONE:        process.env.RESUME_PHONE || '608-960-5508',
};
