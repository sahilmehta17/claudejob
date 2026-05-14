# Claude Code Working Brief — ClaudeJob: enforce 1-page resume + prevent widow lines

**Date:** 2026-05-11
**Working directory:** `/Users/sahilmehtx/Desktop/Internships and Resume/ClaudeJob/files`
**Branch:** `main`
**Repo remote:** `https://github.com/sahilmehta17/claudejob.com`
**Parallel context:** Sahil is actively applying to jobs while you run this. Don't ask him questions mid-execution; surface findings at the end.

## Context

Sahil ran the pipeline against the Amex AI Engineer II - Agentic AI JD. The tailored resume overflowed to 2 pages, AND multiple bullets ended with single-word final lines (widows). Specific widows observed in the screenshot:

- Custom Reports bullet 1: last line is "minutes."
- Custom Reports bullet 2: last line is "passwords."
- Copilot agentic-workflow bullet: last line is "access."
- Copilot Qdrant bullet: last line is "isolation."

The base resume (rendered from `RESUME_BASE_JSON` via `regenerate-base.js`) fits 1 page comfortably with ~50pt headroom. The widows + overflow are introduced by the **per-JD tailoring step in `routes/ai.js`** that rewrites bullets and re-orders/expands the skills section. The LLM has no awareness of rendered line breaks or page count.

This brief adds two guardrails: an LLM-side constraint (prompt addition) and a post-render validator (hard fail on > 1 page).

## Standing rules

1. **Read `routes/ai.js` (focus on the resume tailoring prompt — not the cover letter or Q&A prompts) and `routes/pdfRender.js` end-to-end before editing.**
2. **No emojis. Default to no comments unless WHY is non-obvious.**
3. **Don't auto-commit until told.** Pre-authorized commits in §"Commit plan" — proceed without re-confirming.
4. **Don't change `RESUME_BASE_JSON` itself.** The base is canonical. The fix is about tailored OUTPUT, not base content.
5. **Run `node tests/ai.test.js` after edits.** 47 tests should pass.

## Fix 1 — Add LLM-side constraints to the resume tailoring prompt

### File: `routes/ai.js`

Locate the **resume tailoring prompt** — the one that takes `RESUME_BASE_JSON` + JD and produces a per-JD modified JSON. (NOT the cover letter prompt at ~line 414, NOT the Q&A prompt at ~line 456.) This will be the prompt that includes language like "tailor this resume" or "modify the resume bullets to match the JD."

Add the following constraints to the prompt's RULES block (or wherever the per-bullet rules live). Insert after the existing banned-phrase rules:

```
LAYOUT CONSTRAINTS (hard requirements — output is rejected if violated):
- The tailored resume MUST fit on exactly 1 page (A4, 17pt margins, Times-Roman 11pt, 13pt line height). Total bullet character count across all sections combined should not exceed ~3200 characters.
- Each bullet must be between 18 and 32 words. Shorter bullets are fine; longer bullets are rejected.
- NEVER write a bullet whose final rendered line will contain fewer than 4 words (a "widow line"). Specifically: avoid sentences that end with a short clause like "from days to minutes." or "stored Excel passwords." which would wrap such that the period falls alone on a final line. Instead, either tighten the sentence so it ends mid-line, or pad the final clause so the last line has 4+ words.
- If a base bullet is already widow-safe and at the word ceiling, prefer leaving it unchanged over rewriting.
- If tailoring would push the resume over 1 page, prefer CUTTING low-relevance bullets (e.g. interning roles that don't match the JD) over shortening high-relevance ones. Total bullet count can drop; bullet quality cannot.
- For the Skills section: keep section labels and ordering matched to the JD priority, but the entire Skills section should fit in 4-6 lines total (≤ ~600 characters including labels).
```

Also add a single-line directive near the top of the prompt's role definition:

```
You are tailoring a 1-page resume. Layout discipline matters as much as content relevance.
```

## Fix 2 — Post-render 1-page hard validator

### File: `routes/pdfRender.js`

After `renderResumePdf` completes rendering, check the actual page count. If > 1, throw an error. This is the safety net for when Fix 1 fails (LLM ignores the constraint).

Locate the end of `renderResumePdf` — the function should currently call `doc.end()` or similar to finalize the PDF. Before that final close:

```js
// Hard guard: tailored resume MUST be 1 page. The LLM-side constraint in
// ai.js asks for this but doesn't enforce it; this is the safety net.
// pdfkit tracks pages via doc.bufferedPageRange() — { start, count }.
const pageRange = doc.bufferedPageRange();
if (pageRange.count > 1) {
  // Don't render the overflow PDF. Tear down and surface the failure
  // so the caller can either retry with stricter brevity or fall back
  // to the base resume.
  throw new Error(
    `Resume overflow: tailored output rendered to ${pageRange.count} pages. ` +
    `LLM-side layout constraint failed. Either retry tailoring with stricter ` +
    `brevity guidance, or fall back to RESUME_BASE_JSON.`
  );
}
```

**Note on placement:** if `renderResumePdf` writes to a file stream, you may need to check `bufferedPageRange()` BEFORE calling `doc.end()` since `end()` flushes the stream. Verify the exact API path with pdfkit's docs at `node_modules/pdfkit/` if needed.

### File: `routes/saveBundle.js`

The bundler calls `renderResumePdf` in `Promise.all` and catches errors. Currently the error message gets aggregated into `errors[]` and re-thrown. That's fine — the page-overflow error will propagate. But add a small enhancement: when the error message includes "Resume overflow", surface it more loudly in the response so Sahil sees it in the ClaudeJob UI:

Find the existing error handling in `saveApplicationBundle`:
```js
if (errors.length) {
  throw new Error(`PDF generation failed: ${errors.join('; ')}`);
}
```

Leave this unchanged — it's correct. The detailed message will reach the caller. (If you spot a place in `routes/ai.js` that catches this error and you want to add a retry path, that's a future enhancement, not in this brief.)

## Fix 3 — Widow detection in pdfRender.js (defensive log)

This is a softer guard. It detects widow lines AFTER render and logs a warning per bullet, so Sahil can see in the server logs whether the LLM-side constraint is working without it being a hard failure.

### File: `routes/pdfRender.js`

When rendering each bullet, the current code uses pdfkit's text wrapping. To detect widows, calculate the wrap manually for each bullet before rendering and check the last line word count.

Add a helper near the top of the file:

```js
/**
 * Predict the rendered wrap of a string in a given font/size/width and
 * return the last line. Used to detect widow lines (final line < 4 words)
 * before they ship.
 */
function predictLastLine(doc, text, fontSize, maxWidth) {
  const words = text.split(/\s+/);
  let currentLine = '';
  let lastLine = '';
  for (const word of words) {
    const trial = currentLine ? `${currentLine} ${word}` : word;
    const trialWidth = doc.widthOfString(trial, { size: fontSize });
    if (trialWidth <= maxWidth) {
      currentLine = trial;
    } else {
      lastLine = currentLine;
      currentLine = word;
    }
  }
  lastLine = currentLine; // the final accumulating line is the actual last line
  return lastLine;
}

function isWidow(lastLine) {
  return lastLine.split(/\s+/).filter(Boolean).length < 4;
}
```

Then, inside the bullet rendering loop (where each bullet is drawn), before drawing, predict and log:

```js
const bulletText = /* the bullet string about to be rendered */;
const lastLine = predictLastLine(doc, bulletText, BODY_SIZE, contentWidth);
if (isWidow(lastLine)) {
  console.warn(`[pdfRender] widow detected: bullet ends with "${lastLine}" (${lastLine.split(/\s+/).filter(Boolean).length} words on last line)`);
  console.warn(`[pdfRender] full bullet: ${bulletText.slice(0, 100)}...`);
}
```

**Don't fail on widow detection** — log only. The hard 1-page check is the real guard; widows are a quality signal that helps Sahil see when the LLM-side constraint is slipping. If widow logs appear frequently after this brief lands, future work can promote it to a hard fail or trigger a re-tailoring retry.

## Verification before commit

1. `node tests/ai.test.js` — 47 tests pass.
2. Restart `node server.js`. Run the pipeline against the same Amex AI Engineer II JD that triggered this report. Expected behavior:
   - **Best case:** tailored resume now fits 1 page with no widow warnings.
   - **Acceptable case:** tailored resume fits 1 page; 1-2 widow warnings logged but resume looks fine visually.
   - **Failure case:** post-render validator throws "Resume overflow: tailored output rendered to 2 pages." This is a SUCCESS for this brief — the guard caught a regression. Sahil can then either re-run (the LLM is non-deterministic, next run may succeed) or fall back to base.
3. Spot-check the rendered PDF visually: open in Preview, confirm 1 page, scan for single-word last lines on bullets.
4. Run `node regenerate-base.js` to confirm the BASE resume still renders cleanly to 1 page (nothing should have regressed).

## Commit plan (pre-authorized — proceed without re-confirming)

Three commits, in order:

```
ai: enforce 1-page layout constraints in resume tailoring prompt
pdfRender: hard-fail on resume overflow past 1 page
pdfRender: log widow lines during bullet render for quality signal
```

For commit 1, body line explaining the failure mode: the Amex AI Engineer II tailored resume overflowed to 2 pages and shipped widows; the LLM had no awareness of rendered line breaks.

For commit 2, body short: the LLM-side constraint can fail (model is non-deterministic); this is the safety net.

For commit 3, body short: widow detection logs only — promote to hard fail in a follow-up if logs are noisy.

Push to `origin/main` after all three land:
```bash
git push origin main
```

## What to do AFTER this lands

1. Surface anything you discovered:
   - If the resume tailoring prompt doesn't exist in `ai.js` (i.e. tailoring happens elsewhere), flag this — the brief assumed it lives in `ai.js` based on the file structure.
   - If `pdfkit`'s `bufferedPageRange()` doesn't work as documented (rare), surface the actual API path used.
   - If widow detection logs fire on the BASE resume (which should be widow-clean), the predictLastLine() math is off and needs tuning.
2. **Do not** attempt to auto-fix widows by trimming words — that's content surgery and belongs to the LLM, not pdfRender.
3. **Do not** add a re-tailoring retry loop on overflow. That's a future enhancement; for now, hard fail is the right behavior.
4. **Do not** modify `RESUME_BASE_JSON`. Base content is canonical; this brief is about TAILORED output.

## Operating model reminder

Cowork writes briefs. You execute. Sahil is applying in parallel — don't pull him out of flow. Surface findings concisely at the end. If the candidate-facts brief (2026-05-11-candidate-facts-single-source-prompt.md) hasn't run yet, run that one FIRST since it changes the prompt structure these constraints sit inside. If it has run, this brief picks up cleanly on top.

---

End of brief. Read `routes/ai.js` (resume tailoring prompt) and `routes/pdfRender.js` first, then proceed with Fix 1.
