# Claude Code Working Brief — ClaudeJob: tune page-fill aggression to match base density

**Date:** 2026-05-11
**Working directory:** `/Users/sahilmehtx/Desktop/Internships and Resume/ClaudeJob/files`
**Branch:** `main`
**Repo remote:** `https://github.com/sahilmehta17/claudejob.git`
**Parallel context:** Sahil is actively applying to jobs while you run this. Don't ask him questions mid-execution; surface findings at the end.

## Context

The previous brief shipped widow elimination + underfill distribution (commits `fcdfc0f` and `2cb08f6`). The widow fix is working perfectly. The underfill fix is working but undershoots the target — Code's report noted 87% fill against the spec's 92% target on sparse content, attributing it to the distribution weights and the 2× cap.

Sahil's actual requirement, which I underspecified in the prior brief: **tailored resumes should fill at least as much of the page as the base resume does (~95%). Never less.** The current 87% leaves visible whitespace that makes tailored versions look thinner than the canonical base.

This brief is a small tuning patch — no new logic, just adjusting the constants and weights in the existing two-pass renderer.

## Standing rules

1. **Read `routes/pdfRender.js` end-to-end before editing.** Focus on the constants and the `renderResumePdf` two-pass logic added in commit `2cb08f6`.
2. **No emojis. Default to no comments unless WHY is non-obvious.**
3. **Don't auto-commit until told.** Pre-authorized commit in §"Commit plan" — proceed without re-confirming.
4. **Don't touch the widow fix.** It's working; leave it alone.
5. **Run `node tests/ai.test.js` and `node regenerate-base.js` after edits.** Both must pass. BASE must remain 1 page.

## Fix — Tune fill aggression

### File: `routes/pdfRender.js`

Locate the constants added in the underfill commit (`TARGET_FILL_PCT` and `MAX_GAP_MULTIPLIER`) and the distribution weights inside `renderResumePdf`. Make these changes:

**Constant changes:**

```js
// Was: const TARGET_FILL_PCT = 0.92;
const TARGET_FILL_PCT = 0.95;  // Target ≥95% fill; matches base resume density

// Was: const MAX_GAP_MULTIPLIER = 2.0;
const MAX_GAP_MULTIPLIER = 4.0;  // Allow up to 4× base gaps for very sparse tailored resumes
```

**Distribution weight changes:**

In the gap-distribution block (where `extraPerGap` is computed and applied to `section` / `postItem` / `subPre`), change the weights so all gap types expand more aggressively:

```js
// Was:
// gaps = {
//   section: baseGaps.section + extraPerGap,           // 1.0×
//   postItem: baseGaps.postItem + extraPerGap * 0.4,   // 0.4×
//   subsectionPre: baseGaps.subsectionPre + extraPerGap * 0.3,  // 0.3×
// };

// New:
gaps = {
  section: baseGaps.section + extraPerGap,           // 1.0× — unchanged, anchors the inter-section visual
  postItem: baseGaps.postItem + extraPerGap * 0.7,   // 0.7× — bullets get more breathing room
  subsectionPre: baseGaps.subsectionPre + extraPerGap * 0.6,  // 0.6× — subsections also breathe
};
```

The rationale: section gaps already do the most heavy lifting at 1.0×. The post-item and sub-section gap weights were too conservative — bumping them lets the algorithm absorb the underfill across MORE distinct points instead of forcing only the section gaps to do all the work.

### Fallback — line-height expansion when gap expansion isn't enough

After the gap distribution, check if the projected fill is STILL below `TARGET_FILL_PCT`. If so, add a small additional bump to `LINE_H` (capped at +2pt above base):

```js
// After computing gaps:
const projectedHeight = simulateContentHeight(content, gaps);
const projectedFillPct = projectedHeight / pageContentHeight;

let lineH = LINE_H;
if (projectedFillPct < TARGET_FILL_PCT) {
  // Compute the extra height needed
  const stillNeeded = (TARGET_FILL_PCT * pageContentHeight) - projectedHeight;
  // Estimate line count in document (sum of bullet lines + headers + skills)
  const lineCount = countTotalLinesInContent(content);
  if (lineCount > 0) {
    const extraPerLine = Math.min(2.0, stillNeeded / lineCount);  // cap at 2pt
    lineH = LINE_H + extraPerLine;
  }
}

// Then pass lineH into the final render pass alongside gaps.
```

**Note on `countTotalLinesInContent`**: an approximation is acceptable. Sum over all bullets: `Math.ceil(bullet.length / 80)` as a rough estimate of wrapped lines. Plus 1 per section header, 1 per subsection name, 1 per skills row. The exact number doesn't matter for tuning — the algorithm self-corrects on the second pass.

### What stays the same

- Widow elimination (NBSP injection) — untouched
- Two-pass render structure — untouched, just tuned
- Hard 1-page fail — untouched (still catches overflow)
- Underfill logging — untouched

## Safety constraints (must hold)

1. **BASE resume must still render to exactly 1 page.** The BASE fills naturally at ~95-100% with default constants; the new logic should be a no-op on BASE (no underfill detected, no expansion applied). If BASE goes to 2 pages after these changes, the cap or weights are too aggressive — back off.
2. **Tailored resumes must never overflow to 2 pages.** The existing hard fail catches this; the new tuning should aim for 95% fill without crossing into 100%+.
3. **Line height bump capped at +2pt** above base. Beyond that, the resume looks "stretched" and the typography reads as padded.

## Verification before commit

1. `node regenerate-base.js` — BASE PDF regenerates, exactly 1 page (confirm via `pdfinfo`), no widow warnings. `[pdfRender] page filled at NN%` should still log ~100% on BASE (no expansion needed because BASE is naturally full).
2. `node tests/ai.test.js` — 47/47 pass.
3. Run the pipeline against a saved JD (any in `data/tracker.json` — Speechmatics if you have it, or any AI Engineer JD). Tailored PDF should:
   - Be exactly 1 page
   - Show no widow warnings on its new content
   - Show `[pdfRender] page filled at NN%` ≥ 92% (target was 95%; some content shapes won't quite hit 95% even with aggressive tuning, but should beat the previous 87%)
4. **Eyeball check**: open the tailored PDF in Preview. Bottom whitespace should be ≤ 10% of page height (single section gap's worth, not 3 sections' worth like before).

## Commit plan (pre-authorized — proceed without re-confirming)

Single commit:

```
pdfRender: tune page-fill aggression — target 95% fill, 4× gap cap, line-height fallback
```

Body line: previous fill target (92%) + 2× cap + 0.3-0.4× weights produced 87% fill on sparse content. Bumped TARGET_FILL_PCT → 0.95, MAX_GAP_MULTIPLIER → 4.0, postItem weight → 0.7, subPre weight → 0.6. Added line-height bump fallback (+2pt cap) when gap expansion alone can't reach target. BASE renders unchanged at ~100% fill (no expansion path triggers).

Push to `origin/main`:
```bash
git push origin main
```

Note: the previous brief noted a "no direct push to default branch" rule blocked the push. If it still bounces, Sahil will need to push from his Terminal or clear the rule. Don't try to bypass it.

## What to do AFTER this lands

1. Surface anything you discovered:
   - If the line-height fallback triggers on BASE (it shouldn't), the `projectedFillPct` calculation is off — flag.
   - If tailored output STILL hits 87% even after the tuning, the bottleneck might be the `MAX_GAP_MULTIPLIER` — flag with the actual computed gap multipliers.
   - If anything looks visually weird (typography stretched, sections spread too far), flag with a before/after.
2. **Do not** modify the widow fix.
3. **Do not** add more typography knobs (font size, kerning, etc.). Stick to gaps + LINE_H.

## Operating model reminder

Cowork writes briefs. You execute. Sahil is applying in parallel — surface findings concisely at the end.

---

End of brief. Read the `renderResumePdf` two-pass logic first, then apply the constant + weight changes, then add the line-height fallback.
