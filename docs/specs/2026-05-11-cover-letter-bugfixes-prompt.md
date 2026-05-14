# Claude Code Working Brief — ClaudeJob: cover letter bugfixes (ship-blockers)

**Date:** 2026-05-11
**Working directory:** `/Users/sahilmehtx/Desktop/Internships and Resume/ClaudeJob/files`
**Branch:** `main`
**Repo remote:** `https://github.com/sahilmehta17/claudejob.git`
**Priority:** Sahil is about to send an application. These bugs would visibly embarrass him in the cover letter. Fix and push within 15 minutes.

## Context

Sahil ran the pipeline for AI Engineer II - Agentic AI at American Express. The generated cover letter has three concrete problems visible in the rendered PDF:

1. `[object Object]` appears three times in the contact line where `sahilmehta.dev`, `Github`, and `Linkedin` should appear.
2. The letter says "I'm graduating May 2025" — but it's currently May 2026. Should be "graduated" or past-completion phrasing.
3. (Not flagged by Sahil — I caught this audit-side) The cover letter prompt in `ai.js` still has the OLD GSPANN and Orahi stats that were trimmed from the resume in §9.3. The prompt is the only source the LLM has for these facts.

The tone — "less enthusiastic, more showing what I've done" — is **deliberate** per the prompt's `TONE: Confident & direct` + banned-phrase list. Sahil's instinct to soften it is real but the previous council session (council-transcript-2026-05-11-2230.md, same workspace root) explicitly identified tone optimization as the procrastination trap. **Do not change the tone or the banned-phrase list in this brief.** Tone is parked.

## Standing rules

1. **Read `routes/pdfRender.js` and `routes/ai.js` end-to-end before editing.** Both files have multiple unrelated functions; you only change the cover-letter ones.
2. **No emojis. Default to no comments unless WHY is non-obvious.**
3. **Don't change the prompt's `TONE:` directive or banned phrases.** Tone is by design.
4. **Pre-authorized commits** in §"Commit plan" below — proceed without re-confirming.
5. **Run `node tests/ai.test.js` after edits.** 47 tests should pass (they cover validator paths, not the cover letter PDF — but a regression suite is a regression suite).

## Fix 1 — `[object Object]` in cover letter contact line

### File: `routes/pdfRender.js` (around line 370, inside `renderCoverPdf`)

Current (broken):
```js
const contact = (content.contact || []).join(' | ');
const contactW = doc.widthOfString(contact);
doc.text(contact, (C.PAGE_W - contactW) / 2, y - C.CONTACT_SIZE * 0.85, { lineBreak: false });
```

Root cause: `String({ text: 'Github', url: '...' })` evaluates to `"[object Object]"`. The contact array now contains 3 such objects (sahilmehta.dev, Github, Linkedin) alongside 3 plain strings (location, email, phone). The resume renderer at line 285 uses a `drawContact` method that handles both shapes; the cover letter renderer was never updated.

Fix:
```js
// Contact items can be plain strings or { text, url } objects (resume PDF
// makes the latter clickable). For the cover letter we only need the visible
// text — render all entries as plain strings, joined by ' | '.
const contactStrs = (content.contact || []).map(c =>
  typeof c === 'string' ? c : (c && c.text) || ''
).filter(Boolean);
const contact = contactStrs.join(' | ');
const contactW = doc.widthOfString(contact);
doc.text(contact, (C.PAGE_W - contactW) / 2, y - C.CONTACT_SIZE * 0.85, { lineBreak: false });
```

**Optional polish (skip if it adds time):** make the Github / Linkedin / sahilmehta.dev entries clickable in the cover letter PDF the same way they are in the resume PDF. Cover letter render uses pdfkit's `doc.text` directly; you'd need to break the contact line into segments and use `link` option per segment. Skip unless trivial — non-blocker.

## Fix 2 — "I'm graduating" tense bug

### File: `routes/ai.js` (around lines 414–435, the `coverPrompt` template literal)

Current `CANDIDATE` block (line 416-421):
```
CANDIDATE (use ONLY these facts — do not invent):
- CS + Data Science grad, UW-Madison, May 2025
- ~1 year full-time SWE at Enidus USA LLC: Node.js BFF for T-Mobile carrier APIs with OAuth/PoP auth; governed multi-tenant reporting system with RBAC; production RAG AI chatbot (FastAPI, GPT-4o-mini, Qdrant) with 3-layer security model
- RAG capstone: 22K+ docs, 300K+ embeddings, 73% QA accuracy, 40% latency reduction
- Orahi internship: dynamic route algo (80% manual effort reduction), Flask REST APIs
- Core skills: ${job.tags.join(', ')}, Node.js, TypeScript, Python, PostgreSQL, AWS S3, PyTorch, Apache Spark
```

Two changes:

1. **Anchor "now"** at the top of the prompt so the model has temporal context. Add this line right above the CANDIDATE block:

```js
Current date: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}.
```

2. **Change** the education line from:
   `- CS + Data Science grad, UW-Madison, May 2025`
   to:
   `- B.S. Computer Science + B.S. Data Science, UW-Madison (graduated May 2025; ~1 year full-time experience since)`

The explicit "graduated" plus the "1 year since" anchor makes the timing unambiguous.

## Fix 3 — Stale candidate facts (GSPANN 97%, Orahi 15%)

### File: `routes/ai.js`

The §9.3 resume restructure removed two specific stats from the resume: the GSPANN "97% CNN accuracy" claim and the Orahi "15% latency improvement" metric. The prompt still feeds these to the LLM as facts. If the model uses them, the cover letter / Q&A contradicts the resume.

**Two spots to edit:**

### Cover letter prompt (line 420)

Current:
```
- Orahi internship: dynamic route algo (80% manual effort reduction), Flask REST APIs
```

Already correct for cover letter prompt — the 15% claim isn't here. ✓ Leave this line.

### Q&A prompt (lines 459-463)

Current:
```
- Full-time SWE at Enidus: Node.js BFF for T-Mobile APIs (OAuth/PoP auth), multi-tenant RBAC reporting, RAG AI chatbot (FastAPI/Qdrant/GPT-4o-mini, 3-layer security, 8 RBAC roles, 52 pytest tests)
- RAG capstone: 22K docs, 300K+ embeddings, 73% accuracy, 40% latency reduction, 25+ features
- Orahi: 80% manual effort reduction, 15% latency improvement
- GSPANN: 97% CNN accuracy
```

Change to:
```
- Full-time SWE at Enidus: Node.js BFF for T-Mobile APIs (OAuth/PoP auth), multi-tenant RBAC reporting, RAG AI chatbot (FastAPI/Qdrant/GPT-4o-mini, 3-layer security, 8 RBAC roles, 52 pytest cases parametrized to 400+ invocations)
- RAG capstone: 22K docs, 300K+ embeddings, 73% accuracy, 40% latency reduction, 25+ features
- Orahi: 80% manual student-assignment effort reduction via K-means clustering, Flask REST APIs
- GSPANN: CNN-based pneumonia detection on chest X-rays; iterated on preprocessing and data augmentation
```

Three changes inside that block:
- "52 pytest tests" → "52 pytest cases parametrized to 400+ invocations" (matches the resume's exact phrasing)
- Orahi: drop the "15% latency" claim, add the "K-means clustering" + "Flask REST APIs" detail to match the resume
- GSPANN: drop the "97% CNN accuracy" claim entirely; replace with the qualitative description the resume now uses

## Verification before commit

1. `node tests/ai.test.js` — 47 tests pass.
2. Restart `node server.js` if running. Run the pipeline against any saved job listing (one in `data/tracker.json` or via the Search tab). Check the rendered cover letter PDF:
   - Contact line shows `New York City, NY · Open to relocation | sahilmehta0204@gmail.com | +1 (608) 960-5508 | sahilmehta.dev | Github | Linkedin` (NOT `[object Object]`)
   - Body says "graduated May 2025" or equivalent past-tense, NOT "graduating"
3. Q&A output (the `Q&A` tab) — verify no answer cites 97% or 15% metrics.

## Commit plan (pre-authorized — proceed without re-confirming)

Three commits, in order:

```
cover-letter: render { text, url } contact entries as plain text in PDF
ai: anchor current date in cover-letter prompt; mark grad as past-tense
ai: sync candidate facts in Q&A prompt with §9.3 resume restructure
```

For the first commit, body line explaining the root cause is worth including (the resume PDF has its own clickable-link renderer; the cover letter PDF was missed when contact objects were added).

For the second and third: short, no body needed.

Push to `origin/main` after all three land:
```bash
git push origin main
```

## What to do AFTER this lands

1. Surface anything you discovered that wasn't in the brief.
2. **Do not** touch the cover letter `TONE:` directive or banned-phrase list. Sahil flagged the tone but the council session 30 min ago categorically said don't optimize. Tone is parked.
3. **Do not** refactor the prompt to pull candidate facts from `resumeContent.js` dynamically. That's a real future improvement (single source of truth would prevent future drift like this), but it's a separate Cowork decision — write a note about it instead of doing it.
4. **Do not** start the JSearch ATS fan-out (the previous council vetoed it). If Sahil asks you about it, the answer is: not until 20 manual applications have gone out.

## Operating model reminder

Cowork sessions write briefs like this. You (Claude Code) execute. If you find yourself wanting to make a strategic call — change the tone directive, refactor the prompt structure, expand the scope — write the finding into a short note and stop, don't decide. The user takes findings back to Cowork.

---

End of brief. Read the two files first, then proceed with Fix 1 (rgba's bigger cousin — same shape of mistake, single file change).
