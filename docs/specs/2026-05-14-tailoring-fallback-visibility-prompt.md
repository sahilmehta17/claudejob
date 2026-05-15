# Claude Code Working Brief — ClaudeJob: tailoring fallback visibility + skill line budget + frontend-with-AI-flavor classification

**Date:** 2026-05-14
**Working directory:** `/Users/sahilmehtx/Desktop/Internships and Resume/ClaudeJob/files`
**Branch:** `main`
**Repo remote:** `https://github.com/sahilmehta17/claudejob.git`
**Parallel context:** Sahil is actively applying to jobs. Don't ask him questions mid-execution; surface findings at the end.

## Context

Three related bugs surfaced after the tailoring prompt restructure (commit `7a6a8a3`):

**Bug 1 — Silent BASE fallback in UI.** When tailored content is too long for 1 page, `renderResumePdf` cascades through three tiers: adjusted spacing → default spacing → BASE content. The third tier renders `RESUME_BASE_JSON` and silently writes that to disk. The UI continues to show the LLM's tailored output. Sahil thought he was about to submit a tailored resume for Box; the actual PDF was BASE. Critical UX bug — the user can submit the wrong artifact thinking it's tailored.

**Bug 2 — New tailoring rules added a 5th skill category line.** The base resume has 4 skill categories (AI / LLM Systems, Languages, Frameworks, Infra & Tools). The new tailored output split into 5 (Frontend & UI, Backend & APIs, AI / LLM Systems, Infrastructure & Tools, Languages). One extra line pushed total content past 1 page on the Box submission, triggering the cascade and BASE fallback.

**Bug 3 — JD-focus classification missed "Frontend Engineer II, AI Experiences" at Box.** The role is frontend-focused but the title includes "AI Experiences." The new JD FOCUS DETECTION rule didn't pick `frontend` — likely classified as `ai_infra` because of the title keyword. Result: subsection reordering rule didn't fire (AI Copilot still leads, Reports still follows).

## Standing rules

1. **Read `routes/ai.js` and `routes/pdfRender.js` end-to-end before editing.** Focus on `buildResumePrompt` (the resume tailoring prompt) in ai.js and the three-tier fallback in `renderResumePdf` in pdfRender.js.
2. **Read `routes/saveBundle.js` to understand the API response shape** — the fallback signal needs to surface through the bundle to the UI.
3. **No emojis. Default to no comments unless WHY is non-obvious.**
4. **Don't auto-commit until told.** Pre-authorized commits in §"Commit plan" — proceed without re-confirming.
5. **Don't touch the cover letter prompt or Q&A prompt.** Resume-side only.
6. **Don't change `RESUME_BASE_JSON`.** Base is canonical.
7. **Run `node tests/ai.test.js` after edits.** 47/47 must pass.

## Fix 1 — Surface the fallback signal to the UI

### File: `routes/pdfRender.js`

Modify `renderResumePdf` to return additional metadata about which render tier produced the output. Currently returns `outPath`. Change to return an object:

```js
return {
  path: outPath,
  fallback: 'none' | 'default-spacing' | 'base-content',
  fillPct: number,
};
```

Each tier sets the appropriate `fallback` value:
- Tier 1 (adjusted): `fallback: 'none'`
- Tier 2 (default spacing): `fallback: 'default-spacing'`
- Tier 3 (BASE_JSON): `fallback: 'base-content'`

This is a breaking change to the function's return shape — every caller must be updated.

### File: `routes/saveBundle.js`

Update the call to `renderResumePdf` to consume the new return shape. Plumb the `fallback` value into the bundle's API response:

```js
// Before: const resumePath = await renderResumePdf(...)
const resumeResult = await renderResumePdf(...);
// then: resumeResult.path, resumeResult.fallback, resumeResult.fillPct
```

Add to the bundle return object:

```js
return {
  folder,
  files: { ... },
  renderInfo: {
    resumeFallback: resumeResult.fallback,
    resumeFillPct: resumeResult.fillPct,
  },
};
```

### File: route handler that calls saveBundle

Find the route (likely in `routes/ai.js` or `routes/apply.js`) that calls `saveBundle.saveApplicationBundle`. Surface the `renderInfo.resumeFallback` value in the SSE stream payload sent to the UI. When `fallback === 'base-content'`, emit a clearly-visible step event:

```js
send({
  step: 'resume',
  status: 'warning',
  message: 'Tailored content too long for 1 page — fell back to base resume. The tailored version is shown below but the PDF saved is your base resume.',
});
```

### File: `public/index.html` (or wherever the SSE consumer lives in the frontend)

Add a visible warning banner in the UI when the resume step emits `status: 'warning'`. Yellow background, clear text, NOT dismissable until the user clicks "I understand — submit base anyway" or "Re-run tailoring." Make it impossible to miss.

If the frontend SSE consumer is a separate file (e.g., `public/app.js`), update it accordingly. Find the existing step-status handler and add a `'warning'` branch.

## Fix 2 — Hard skill-section line count constraint

### File: `routes/ai.js` (buildResumePrompt)

The new tailoring rules expanded the skills section into 5 lines on frontend JDs (split Backend & Frameworks into Backend & APIs + Frontend & UI). The base resume has 4 lines. The page budget assumed 4.

Add to the STRICT RULES block in `buildResumePrompt`:

```
SKILLS SECTION LINE COUNT (hard requirement):
- The TECHNICAL SKILLS section must contain EXACTLY 4 category lines, matching the base resume's structure: one for AI/LLM, one for Languages, one for Frontend/Frameworks/Backend (combined as appropriate for the JD), and one for Infrastructure/Tools.
- You may RENAME the categories to match JD focus (e.g., "Frontend & UI" instead of "Frameworks" for frontend roles) but you may NOT add a 5th category line.
- If you need to surface both frontend AND backend frameworks for a fullstack JD, combine them under a single line: "Frameworks & APIs: React, Node.js, Express, FastAPI, ..." rather than splitting into two lines.
- Total skills section height must fit within the 4-line budget the base resume uses.
```

This is a soft constraint (LLM self-policed). If observed drift after this lands, promote to a programmatic post-tailoring check that counts skill items.

## Fix 3 — JD focus tiebreaker for hybrid roles

### File: `routes/ai.js` (JD FOCUS DETECTION section)

The current classification looks at JD bullet density. For roles with hybrid titles like "Frontend Engineer II, AI Experiences" or "Software Engineer, AI Platform," the title contains AI keywords but the BODY of the JD is frontend-focused. The LLM picked `ai_infra` based on title keywords.

Add a tiebreaker rule to JD FOCUS DETECTION:

```
TIEBREAKER FOR HYBRID-FLAVOR ROLES:
If the JD title contains AI keywords (AI, ML, LLM, GenAI, Agentic) BUT the body of the JD primarily describes one of the other focus areas, classify based on the BODY, not the title. Specifically:
  - If "Frontend Engineer" / "UI Engineer" / "Mobile Engineer" appears in the title (with or without "AI" qualifier), classify as 'frontend' UNLESS the JD body explicitly says >50% of the work is on AI/ML infrastructure (not just AI features).
  - If "Backend Engineer" / "Platform Engineer" appears in the title (with or without "AI" qualifier), classify as 'backend' under the same rule.
  - The "AI Experiences" / "AI Features" / "AI Platform" qualifier in a frontend/backend title means "this team builds AI-flavored features" — the engineering work itself is still frontend/backend.
  - 'ai_infra' is reserved for roles where the JD body describes building the AI/ML platform itself (LLM serving, vector DB ops, model training, agent orchestration as primary work).

When in doubt between two buckets, classify based on the JD's "WHAT YOU'LL DO" section, weighting frontend keywords (React, UI, mobile, accessibility, components) vs backend keywords (services, databases, APIs, scaling) vs ai_infra keywords (LLM, RAG, agents, MLOps, evaluation harnesses).
```

This should fix the Box classification (title mentions AI Experiences, body describes React/React Native/frontend work → should classify as `frontend`).

## Verification before commit

1. `node tests/ai.test.js` — 47/47 pass.
2. Restart `node server.js`. Run the pipeline against the Box JD. Verify:
   - Tailored output has EXACTLY 4 skill category lines (not 5)
   - Custom Reports leads, AI Copilot follows (frontend classification works)
   - PDF saved matches the UI preview content (no fallback to BASE)
   - Console logs `[pdfRender] page filled at NN%` with the tailored fillPct, no "tailored content too long" warning
3. Run the pipeline against an AI-infra JD (Anthropic, Cursor, or saved Amex AI Engineer II). Verify:
   - AI Copilot leads, Reports follows (correct classification on actual AI role)
   - 4 skill lines
4. Force a fallback scenario: create a contrived JD that pulls maximum content, run the pipeline. Verify:
   - When fallback fires (any tier), the SSE stream emits a `warning` status
   - The UI banner appears with clear messaging
   - The user has to acknowledge before submitting

## Commit plan (pre-authorized — proceed without re-confirming)

Three commits, in order:

```
ai: hard 4-line skill section budget + tiebreaker for hybrid-flavor frontend/backend titles
pdfRender: return fallback metadata from renderResumePdf; surface tier through saveBundle
ui: yellow warning banner when tailoring falls back to base content
```

For commit 1, body line: the tailoring prompt restructure (commit 7a6a8a3) inadvertently allowed the skills section to grow to 5 lines on frontend JDs, pushing total content past page 1 and triggering the silent BASE fallback. Constrained to 4 lines matching base. Also added title-vs-body tiebreaker so "Frontend Engineer II, AI Experiences" classifies as frontend (not ai_infra) since the JD body describes React/RN work.

For commit 2, body line: render fallback was silent — the UI showed tailored output while the PDF saved was BASE. Plumbed fallback tier through saveBundle's response so the route handler can surface it via SSE.

For commit 3, body line: yellow banner in the UI when the resume render falls back to base content; user must acknowledge before submitting. Prevents the "thought I was submitting tailored, actually submitted base" failure mode.

Push to `origin/main`:
```bash
git push origin main
```

## What to do AFTER this lands

1. Surface anything you discovered:
   - If the skills 4-line constraint causes information loss (skills crammed into 4 lines look cluttered), flag with examples.
   - If the tiebreaker still mis-classifies edge cases (e.g., "Founding Engineer" titles where the JD is fullstack), flag the JDs that produced the wrong bucket.
   - If the UI warning banner is visually weak or dismissable too easily, flag.
2. **Do not** modify the source-fact validator or banned-cliché regex.
3. **Do not** touch the cover letter or Q&A prompts.
4. **Do not** change layout constants.

## Operating model reminder

Cowork writes briefs. You execute. Sahil is applying in parallel — surface findings concisely at the end.

---

End of brief. Read `routes/ai.js` (buildResumePrompt + JD FOCUS DETECTION), `routes/pdfRender.js` (renderResumePdf + 3-tier fallback), and `routes/saveBundle.js` first. Then proceed with Fix 1.
