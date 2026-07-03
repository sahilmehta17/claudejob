## generate-pii-safe.js

One-off generator producing a recruiter-safe resume PDF with phone, personal
email, and specific city stripped. Keeps name, LinkedIn, GitHub, portfolio.

Run: `npm run generate:pii-safe`

Output: `../active/Sahil_Mehta_Resume_PII_SAFE.pdf` (in the "Internships and
Resume" folder root, alongside `Sahil_Mehta_Resume_BASE.pdf`).

Re-run whenever `RESUME_BASE_JSON` in `routes/resumeContent.js` changes — the
PII-safe variant is a derived artifact, not a source of truth.
