# Claude Code Working Brief — ClaudeJob: PII-safe resume generator script

**Date:** 2026-07-02
**Working directory:** `/Users/sahilmehtx/Desktop/Internships and Resume/ClaudeJob/files`
**Branch:** `main`
**Repo remote:** `https://github.com/sahilmehta17/claudejob.git`
**Parallel context:** Sahil is actively applying to jobs. Don't ask him questions mid-execution; surface findings at the end.

## Context

Sahil needs a resume variant to send to cold recruiters that strips direct-contact PII (phone, personal email, specific city) but keeps professional identity (name, LinkedIn, GitHub, portfolio). Recruiters use LinkedIn to verify + reach out; that's the intended contact surface.

This brief adds a one-off script `scripts/generate-pii-safe.js` that reuses the existing renderer (`renderResumePdf` in `routes/pdfRender.js`) with a modified contact array. Every time `RESUME_BASE_JSON` changes, re-run the script to keep the PII-safe variant in sync.

Output lives outside the repo, in the parent folder's newly-organized `active/` directory. That path is:

```
/Users/sahilmehtx/Desktop/Internships and Resume/active/Sahil_Mehta_Resume_PII_SAFE.pdf
```

## Standing rules

1. **Read `routes/resumeContent.js` (contact array) and `routes/pdfRender.js` (renderResumePdf signature + return shape) before editing.**
2. **No emojis. No em-dashes. Default to no comments unless WHY is non-obvious.**
3. **Don't auto-commit until told.** Pre-authorized commits in §"Commit plan" — proceed without re-confirming.
4. **Do NOT modify `RESUME_BASE_JSON`.** The script deep-clones it and mutates only the clone.
5. **Do NOT put the PII-safe variant on any hot path.** The tailoring pipeline continues to use the full base. This script is a one-off generator run manually or on demand.

## Fix 1 — Create `scripts/generate-pii-safe.js`

### File: `scripts/generate-pii-safe.js`

Create the file with the following contents. Adjust the `renderResumePdf` call to match the signature currently exported from `pdfRender.js` — if it takes `(resumeJson, outputPath)` positional, use that; if it takes an options object, use that. Read the source first.

```js
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
  if (result && result.fallback) {
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
```

### Key decisions

- **`Open to relocation`** replaces the current `'New York City, NY · Open to relocation'`. Removes the city (which is direct-mail-level PII when combined with name + LinkedIn) but keeps the relocation signal. Recruiters filtering by "NYC candidate" will still find him via LinkedIn's location field.
- **`Github` / `Linkedin` as displayed text** (not the full URLs) matches the current base's display convention — the URL is embedded via the `{ text, url }` object shape so the link is clickable in the PDF.
- **`sahilmehta.dev`** is public and intentional — it's a professional portfolio URL, not "PII" in the traditional sense. Kept.
- **`sahilmehta0204@gmail.com`** dropped. Recruiters reach out via LinkedIn.
- **`608-960-5508`** dropped. This is the highest-value PII — prevents recruiter-list resale from producing spam calls.

## Fix 2 — Add npm script alias in `package.json`

### File: `package.json`

Under `"scripts"`, add:

```json
"generate:pii-safe": "node scripts/generate-pii-safe.js"
```

Position it alphabetically or grouped with other one-off generator scripts. So invocation becomes:

```bash
npm run generate:pii-safe
```

## Fix 3 — Add `scripts/README.md` note (append-only)

### File: `scripts/README.md`

If this file doesn't exist, create it. If it does, append. Add:

```markdown
## generate-pii-safe.js

One-off generator producing a recruiter-safe resume PDF with phone, personal
email, and specific city stripped. Keeps name, LinkedIn, GitHub, portfolio.

Run: `npm run generate:pii-safe`

Output: `../active/Sahil_Mehta_Resume_PII_SAFE.pdf` (in the "Internships and
Resume" folder root, alongside `Sahil_Mehta_Resume_BASE.pdf`).

Re-run whenever `RESUME_BASE_JSON` in `routes/resumeContent.js` changes — the
PII-safe variant is a derived artifact, not a source of truth.
```

## Verification before commit

1. `node scripts/generate-pii-safe.js` — expect `Generated: /Users/sahilmehtx/Desktop/Internships and Resume/active/Sahil_Mehta_Resume_PII_SAFE.pdf` and non-zero fill %.
2. Open the generated PDF. Verify:
   - Name "Sahil Mehta" still present at top.
   - NO phone number anywhere.
   - NO gmail address anywhere.
   - NO "New York City" (or any specific city) in the contact line.
   - LinkedIn, GitHub, sahilmehta.dev links all present and clickable.
   - All experience/projects/skills content matches the base.
3. `npm run generate:pii-safe` also works (verifies the package.json entry).
4. Run `node tests/ai.test.js` to confirm nothing else broke. Should still be 47/47.
5. `git diff` — expect changes only in `scripts/generate-pii-safe.js` (new), `scripts/README.md` (new or appended), and `package.json` (one script line added). Nothing else.

## Commit plan (pre-authorized — proceed without re-confirming)

One commit:

```
scripts: add generate-pii-safe.js for recruiter-safe resume variant

Contact-strip only: removes phone, personal email, specific city from
RESUME_BASE_JSON via deep clone; keeps name, LinkedIn, GitHub, portfolio
so recruiters can still verify identity and reach out. Output lands at
../active/Sahil_Mehta_Resume_PII_SAFE.pdf. Base resume unchanged.
```

Push to `origin/main`:
```bash
git push origin main
```

If branch protection blocks: surface to user — they'll push from Terminal.

## What to do AFTER this lands

1. Confirm the generated PDF is at `/Users/sahilmehtx/Desktop/Internships and Resume/active/Sahil_Mehta_Resume_PII_SAFE.pdf`.
2. Surface the render fill % — should be similar to the base (LinkedIn/GitHub/portfolio row is shorter than the base contact row by one line's worth of chars, so the PII-safe variant may be marginally under-budget).
3. If `renderResumePdf` signature differs from what this brief assumed, note the actual signature in the commit body and adapt the script accordingly.
4. **Do not** add PII-safe generation into the tailoring pipeline or any per-JD path. Full base contact stays default. This is a manual out-of-band artifact.

## Operating model reminder

Cowork writes briefs. You execute. Sahil is applying in parallel — surface findings concisely at the end.

---

End of brief. Read `routes/resumeContent.js` (contact array format) and `routes/pdfRender.js` (renderResumePdf signature), then proceed with Fix 1.
