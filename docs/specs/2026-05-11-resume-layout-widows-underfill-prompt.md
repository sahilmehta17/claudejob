# Claude Code Working Brief — ClaudeJob: hard widow elimination + underfill page distribution

**Date:** 2026-05-11
**Working directory:** `/Users/sahilmehtx/Desktop/Internships and Resume/ClaudeJob/files`
**Branch:** `main`
**Repo remote:** `https://github.com/sahilmehta17/claudejob.git`
**Parallel context:** Sahil is actively applying to jobs while you run this. Don't ask him questions mid-execution; surface findings at the end.

## Context

Sahil ran the pipeline against a Forward Deployed Engineer JD at Speechmatics. The tailored resume rendered correctly on 1 page but has two visible layout problems:

1. **Widow lines**: several bullets end with 1-3 words alone on the last line (e.g., "improve model generalization.", "credentials.", "daily portal users.").
2. **Underfill**: the page has substantial empty space at the bottom — the rendered content sits high on the page and looks thin.

The widow detector already logs warnings (from the prior 1-page brief) but doesn't intervene. The underfill detector also logs (from the same brief) but doesn't fix. This brief converts both from log-only to render-side fixes.

**Sahil's framing**: "I don't mind the content — the whitespace bothers me. No single line with just 1-2 words. Full or at-least-looks-full page."

## Standing rules

1. **Read `routes/pdfRender.js` end-to-end before editing.** Both fixes are in this file. The widow detector and underfill detector helpers should already exist from prior briefs.
2. **No emojis. Default to no comments unless WHY is non-obvious.**
3. **Don't auto-commit until told.** Pre-authorized commits in §"Commit plan" — proceed without re-confirming.
4. **Don't touch `routes/ai.js` LLM prompts.** This is a render-side fix only. The LLM constraint approach has limits (LLM can't precisely predict pdfkit line breaks); fixing at render time is more reliable.
5. **Verify on the BASE resume after edits.** `node regenerate-base.js` must succeed, BASE PDF stays 1 page, widow warnings reduce to zero or near-zero, and the BASE PDF looks fuller.
6. **Run `node tests/ai.test.js` after edits.** 47/47 must pass.

## Fix 1 — Hard widow elimination via non-breaking-space injection

### File: `routes/pdfRender.js`

The widow detector already predicts the last line of each bullet. Extend it from log-only to active fix: when a widow is detected, inject Unicode non-breaking spaces (U+00A0, in cp1252 at 0xA0 so pdfkit handles it correctly) between the last 3 words. This forces them to stay together — pdfkit will line-break BEFORE the group rather than splitting it.

### Add a helper function near `predictLastLine` and `isWidow`

```js
/**
 * Prevent widow lines by joining the last 3 words with non-breaking spaces.
 * Forces pdfkit to wrap the entire 3-word phrase together — if it doesn't
 * fit on the current line, the whole phrase moves to a new line as a unit,
 * giving the last line at least 3 words.
 *
 * Returns the text unchanged if the bullet is too short (< 4 words) or
 * if no widow is predicted.
 */
function preventWidow(text, doc, fontSize, maxWidth) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 4) return text;

  const lastLine = predictLastLine(doc, text, fontSize, maxWidth);
  const lastLineWords = lastLine.split(/\s+/).filter(Boolean);
  if (lastLineWords.length >= 3) return text;

  // Inject NBSP between the LAST 3 words. Find the last 2 spaces and replace.
  const NBSP = ' ';
  // We need to replace only the last two ASCII spaces, not earlier ones.
  // Build the new string by working back from the end.
  const lastSpace = text.lastIndexOf(' ');
  if (lastSpace < 0) return text;
  const secondLastSpace = text.lastIndexOf(' ', lastSpace - 1);
  if (secondLastSpace < 0) return text;

  return (
    text.slice(0, secondLastSpace) +
    NBSP +
    text.slice(secondLastSpace + 1, lastSpace) +
    NBSP +
    text.slice(lastSpace + 1)
  );
}
```

### Wire it into the bullet render path

Locate where each bullet is rendered (the loop inside `renderResumePdf` that draws each bullet via `doc.text(...)`). BEFORE the draw call, pass the bullet text through `preventWidow`:

```js
// Existing:
// doc.text(bulletText, BULLET_TEXT_X, y, { width: contentWidth });

// Add the widow guard right before:
const safeBulletText = preventWidow(bulletText, doc, BODY_SIZE, contentWidth);
doc.text(safeBulletText, BULLET_TEXT_X, y, { width: contentWidth });
```

Apply the same wrapping to whichever other render paths produce widow warnings — the existing `predictLastLine` warning logs identify which bullet types are affected. The Custom Reports hardening bullet, GSPANN, ClaudeJob project bullet, RAG capstone, and copilot pilot bullet are the known offenders per prior brief.

### Edge cases

- If the last 3 words include the punctuation period (e.g., "ingestion at scale."), the period travels with "scale." — keep that intact. The split on `/\s+/` handles this naturally.
- If `preventWidow` produces a line that overflows the column width because the 3-word group is too long, the page guard already catches this via the 1-page hard fail. Re-renderwould be ideal but is out of scope; the hard-fail behavior is acceptable.
- Test against a bullet that's exactly 3 words on the last line currently: should be a no-op. Test against a 1-word widow: should fix to 3 words. Test against a 2-word widow: should fix to 3.

## Fix 2 — Underfill page distribution

### File: `routes/pdfRender.js`

When the rendered content uses less than ~85% of the page, expand the inter-section gaps proportionally so the page LOOKS fuller without changing the typography. Strict invariants:

- Never expand gaps so much that content overflows (already guarded by the 1-page hard fail, but the underfill fix must respect a safety margin).
- Never change `LINE_H` or font sizes — those affect readability.
- Expand only inter-section gaps (`GAP_SECTION`) and post-item gaps (`GAP_POST_ITEM`) proportionally.

### Strategy

Run a TWO-PASS render:

**Pass 1 (measurement)**: render to a discarded buffer using the existing constants. Measure the total used height (last drawn-y minus top margin).

**Pass 2 (adjusted)**: if `usedHeight < TARGET_FILL_PCT * pageContentHeight`, compute extra space to distribute and add it to each gap. Render the real PDF with adjusted constants.

### Implementation

```js
const TARGET_FILL_PCT = 0.92;  // Aim for 92% page-fill
const MAX_GAP_MULTIPLIER = 2.0; // Don't scale gaps beyond 2x to avoid weird spacing

/**
 * Pre-compute rendered content height by running a measurement pass.
 * Returns the y-position of the last drawn line, accounting for all
 * sections, bullets, and gaps as currently configured.
 *
 * Implementation: render to a throwaway PDFDocument with the same
 * geometry but never finalize. Return doc.y at the end.
 */
function measureContentHeight(content, baseGapConfig) {
  // Use a throwaway PDFDocument with the same dimensions and margins.
  // Walk through the same render logic without writing to disk.
  // Track doc.y as the final used height.
  // [Implementation detail: clone the render loop into a measurement-only
  // path that takes a config and returns the y-position at the end.]
  // ...
  return finalY;
}

async function renderResumePdf(content, outPath) {
  const baseGaps = {
    section: GAP_SECTION,
    postItem: GAP_POST_ITEM,
    subsectionPre: GAP_SUBSECTION_PRE,
  };

  // Pass 1: measure
  const usedHeight = measureContentHeight(content, baseGaps);
  const pageContentHeight = PAGE_HEIGHT - MARGIN_T - MARGIN_B;
  const targetHeight = TARGET_FILL_PCT * pageContentHeight;

  // Adjust gaps proportionally if underfilled
  let gaps = baseGaps;
  if (usedHeight < targetHeight) {
    const extra = targetHeight - usedHeight;
    // Count the number of inter-section gaps + post-item gaps in this resume.
    const gapCount = countGapsInContent(content); // walk sections + items
    if (gapCount > 0) {
      const extraPerGap = Math.min(
        extra / gapCount,
        baseGaps.section * (MAX_GAP_MULTIPLIER - 1)
      );
      gaps = {
        section: baseGaps.section + extraPerGap,
        postItem: baseGaps.postItem + extraPerGap * 0.4,
        subsectionPre: baseGaps.subsectionPre + extraPerGap * 0.3,
      };
    }
  }

  // Pass 2: real render with adjusted gaps
  await renderWithGaps(content, outPath, gaps);
}
```

**Note on implementation pragmatism**: the cleanest implementation is to refactor the existing single-pass render into a function that takes a `gaps` config object, then call it twice (once for measurement, once for real). If that refactor is too invasive, an acceptable alternative is to do a single render pass tracking `doc.y` increments, then if underfill is detected at the end, RE-RENDER with adjusted gaps by deleting the output file and starting over. The two-render approach is slower but simpler to implement.

### Verification of underfill fix

After Fix 2:
- BASE resume should fill at least 85% of the page (eyeball — open the regenerated PDF in Preview).
- Tailored resumes against the Speechmatics JD should fill similarly.
- The pdfRender's underfill detector should log "page filled at NN%" with NN ≥ 85.
- Hard 1-page guard must still pass.

## Verification before commit

1. `node regenerate-base.js` — BASE PDF + DOCX regenerate; BASE PDF is 1 page; eyeball it for widows and underfill.
2. Run `pdfinfo` to confirm 1-page count.
3. `node tests/ai.test.js` — 47/47 pass.
4. Restart `node server.js` (Sahil should be done with his current application session by the time this brief runs — if not, surface and wait). Run the pipeline against a saved JD from `data/tracker.json` (Speechmatics if available). Spot-check the tailored resume:
   - No bullet ends with a final line of < 3 words
   - Page fills at least 85%
   - No content overflows to page 2
5. Read the regenerate console output: should see "widow detected" log lines drop to zero or near-zero on the BASE.

## Commit plan (pre-authorized — proceed without re-confirming)

Two commits, in order:

```
pdfRender: hard-eliminate widow lines via non-breaking-space injection on last 3 words
pdfRender: distribute underfill into proportional inter-section gaps for full-page-fill appearance
```

For commit 1, body line explaining: previous widow detector was log-only; this promotes to active fix by inserting U+00A0 between the last 3 words of any bullet that would otherwise widow. pdfkit respects NBSP in cp1252 via Times-Roman's WinAnsi encoding.

For commit 2, body line: two-pass render — measurement pass to compute used height, then adjust GAP_SECTION / GAP_POST_ITEM / GAP_SUBSECTION_PRE proportionally to fill the page to ~92% of content height. MAX_GAP_MULTIPLIER caps the expansion at 2x base to avoid weird spacing.

Push to `origin/main` after both land:
```bash
git push origin main
```

## What to do AFTER this lands

1. Surface anything you discovered:
   - If pdfkit's NBSP rendering is unexpected (e.g., doesn't wrap as a unit), flag the actual behavior so the rule can be tuned.
   - If the two-pass measurement is significantly slower than single-pass (>200ms), flag — may want to optimize later.
   - If certain bullets STILL widow even after the NBSP fix (very long last words, edge cases), flag with examples.
2. **Do not** touch ai.js prompt constraints related to widows. The render-side fix should make those constraints redundant for the widow problem specifically.
3. **Do not** change font sizes or LINE_H — those are typography choices and not under scope here.
4. **Do not** start the portfolio updates or any other parallel work.

## Operating model reminder

Cowork writes briefs. You execute. Sahil is applying in parallel — surface findings concisely at the end.

---

End of brief. Read `routes/pdfRender.js` first (focus on the widow + underfill detector helpers from prior brief), then proceed with Fix 1.
