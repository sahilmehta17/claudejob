# Selective Underfill Distribution — Tailored Resume PDF Layout

**Date:** 2026-05-26 (superseded 2026-05-27 — see v4 addendum at bottom)
**Files touched:** `routes/pdfRender.js`
**Status:** Superseded by v4 (adaptive leading). The v3 selective section-gap
inflation described below was implemented and USER-REJECTED — inflating
GAP_SECTION floated sections apart ("too much whitespace between sections, sits
weird"). The final shipped approach is the **v4 addendum** at the end of this
doc. The v3 body is retained for history.

---

## Problem

Tailored resume PDFs render with one of two visual defects:

1. **State 1 (before this session):** Renderer inflated every gap — `gaps.section`, `gaps.postItem`, `gaps.subsectionPre` — plus a `LINE_H` bump, to force ~98% page fill on shorter LLM-tailored content. Bullets and items looked puffy with "extra lines between points." User-rejected.

2. **State 2 (mid-session — `TARGET_FILL_PCT = 0`):** All gap inflation disabled. Bullets sit at baseline rhythm, but tailored output (which the LLM trims to ~2400 chars vs BASE's 3030) renders with ~25% bottom whitespace. User-rejected.

Both states are reachable from the same source: the LLM tailors content shorter than BASE. There is no honest layout where you get tight bullets, full page, AND under-budget content all at once.

## Insight

The original gap-inflation code conflated four independent dials into one knob:

| Dial | What it controls | Visually puffy? |
|---|---|---|
| `gaps.postItem` | Gap between experience entries (Enidus → Orahi → GSPANN) and between project items | **Yes** — direct cause of "extra lines between points" |
| `gaps.subsectionPre` | Gap before subsection title ("Custom Reports & Dashboards Platform") | **Yes** — fragments the Enidus block |
| `gaps.section` | Extra gap AFTER section separators (between EDUCATION / EXPERIENCE / PROJECTS / SKILLS) | **No** — separator rule already creates a visual break, extra breathing room here reads natural |
| `LINE_H` bump | Uniform per-line height increase | **Minimally** if capped tight — stretches every line evenly with no per-item discontinuity |

The fix: inflate only the bottom two (section gaps + capped LINE_H bump). Leave `postItem` and `subsectionPre` at baseline always.

## Design

### Constants

```js
const TARGET_FILL_PCT = 0.94;       // match BASE's natural fill, was 0.98
const MAX_SECTION_GAP_BUMP = 30;    // pt per section boundary, was effective ~72pt
const MAX_LINE_H_BUMP = 1.5;        // pt per line, was 2.0
```

`TARGET_FILL_PCT` drops from 0.98 → 0.94 because BASE itself renders at 94%. Aiming higher than BASE just over-strains the dials.

### Distribution algorithm

```
if usedHeight < targetHeight:
  deficit = targetHeight - usedHeight

  # Phase 1: absorb deficit via section-gap inflation only.
  # Section boundaries are separated by horizontal rules; extra space there
  # reads as breathing room, not "extra lines between points."
  sectionBoundaries = max(0, sections.length - 1)
  sectionGapBump = min(MAX_SECTION_GAP_BUMP, deficit / sectionBoundaries)
  remainingDeficit = deficit - (sectionGapBump * sectionBoundaries)

  gaps = {
    section:        sectionGapBump,             # inflated
    postItem:       R.GAP_POST_ITEM,            # BASELINE — never inflated
    subsectionPre:  R.GAP_SUBSECTION_PRE,       # BASELINE — never inflated
  }

  # Phase 2: any remaining deficit goes into uniform LINE_H bump.
  # Capped at 1.5pt (~12% increase) so the per-line stretch stays sub-perceptual.
  if remainingDeficit > 0:
    lineH = R.LINE_H + min(MAX_LINE_H_BUMP, remainingDeficit / lineCount)
```

### Worst-case math

BASE: 3030 bullet chars → ~94% fill (~760pt of 808pt usable).
Tailored low-end (observed in the Hive 23:07 run): ~2400 bullet chars → ~76% fill (~614pt) → deficit ~146pt.

Selective absorption capacity on a 4-section resume (3 section boundaries, ~31 rendered lines per `countTotalLinesInContent` on the typical BASE shape):
- Section gap bump: 3 × 30pt = **90pt**
- LINE_H bump: ~31 lines × 1.5pt = **~47pt**
- Total max: **~137pt**

A 146pt deficit lands ~95% absorbed (~10pt bottom whitespace remaining, ~92% page fill). If the LLM produces even less content (deficit > 137pt), bottom whitespace grows but bullets stay tight — graceful degradation rather than visual puffing. If absorption is consistently under-shooting in practice, the next iteration loosens `MAX_SECTION_GAP_BUMP` to 40pt (one knob, isolated effect).

### Pass C tier loop interaction

The 3-tier overflow fallback at `pdfRender.js:636–683` is untouched. Pass C tier 1 runs with `{ gaps, lineH }`. If the combined measurement overflows (caught by Pass B2 backoff), `lineH` is dropped and tier 1 retries with just section-gap inflation. If THAT still overflows, tier 2 (default-spacing) runs unchanged.

### Files changed

- `routes/pdfRender.js`: replace the `gaps` object construction in `renderResumePdf` (lines ~570–580) with the selective version. Set `TARGET_FILL_PCT = 0.94`. Add `MAX_SECTION_GAP_BUMP = 30`. Reduce `MAX_LINE_H_BUMP = 2.0 → 1.5`. Update the header comment block (lines ~428–444) to reflect the selective strategy.

No changes to: `routes/ai.js` (prompt fix stays — it's an independent improvement), `routes/resumeContent.js`, validators, `saveBundle.js`, the 3-tier fallback loop.

### Acceptance

1. BASE renders unchanged at ~94% fill (Pass A measures usedHeight ≈ targetHeight → no inflation needed → same `{}` opts as before).
2. Tailored content at ~2400 chars renders at ~92–94% fill (selective absorption closes the deficit).
3. Bullets per subsection retain baseline spacing (`postItem`, `subsectionPre` unchanged from BASE).
4. Section breaks (EDUCATION → EXPERIENCE → PROJECTS → SKILLS) breathe slightly more than baseline — by ~30pt at worst case, ~15pt at typical case. Acceptable per the user's complaint (which targeted `postItem` / `subsectionPre`, not `section`).
5. 47 unit tests still pass.
6. 3-tier overflow fallback unchanged.

### Risk

`MAX_LINE_H_BUMP = 1.5` is the main risk. A 12% line-height increase IS perceptible side-by-side with BASE. If the user spots it, the next iteration tightens to 1.0pt (8% increase, sub-perceptual) and accepts more bottom whitespace.

## Why this isn't the same mistake twice

State 1's failure mode was identifiable and isolable. The user complained specifically about "extra lines between points/entries" — which maps to `postItem` and `subsectionPre`. State 3 leaves those two dials at baseline. The remaining dials (section gaps and uniform LINE_H) operate on visual elements that don't carry the same puffy reading.

---

# v4 Addendum — Adaptive Leading (shipped 2026-05-27)

v3 (selective section-gap inflation) was rejected: growing `GAP_SECTION` to fill
the page floated the four sections apart, reading as "too much whitespace
between sections, sits weird." Diagnosis confirmed by viewing the user's
reference resume (`Sahil_Mehta_Resume_BASE.pdf`) — its section breaks are tight.

## Decisions (locked with the user)

- **Keep** the underscore separator rules between sections.
- **Section gap fixed tight** at `R.GAP_SECTION = 2pt` (down from 18). The
  separator's own one-line advance plus 2pt = ~14pt break below each separator.
  Never inflated.
- **Page-fill via leading only.** The single dial used to fill an underfilled
  page is `lineH` (leading) — a uniform per-line stretch that fills the page
  without changing the relative rhythm between sections / items / bullets. This
  is the one mechanism that doesn't reproduce any prior rejected reading (v1
  puffy per-item gaps, v3 floaty section gaps).

## Mechanism

Empirically there is a hard 1→2-page overflow cliff just above the fill sweet
spot (e.g. at 2pt section gaps, ~2836-char content fills 99% at lineH 13.0 but
overflows to 2 pages at 13.5; full BASE fills 98% at 12.5, overflows at 13.0).
So leading is found by a **measure-and-stop search**, not a computed bump:

1. Measure baseline (lineH 12). If it already overflows, skip to the 3-tier
   fallback. If it already meets target, render at baseline.
2. Otherwise grow leading in `LINE_H_STEP` (0.25pt) increments. After each step,
   measure. Stop when used height reaches `TARGET_FILL_PCT` (0.97) OR the next
   step would spill to page 2 / cross `safeMax = usable − LINE_H_SAFETY_BUFFER`.
   Keep the largest leading verified to fit.
3. Cap growth at `MAX_LINE_H_BUMP` (2.0pt → 14pt max, ~17%). On genuinely sparse
   content the search hits the cap and the page keeps some bottom whitespace
   rather than stretching into "spaced-out" territory — graceful degradation,
   and the signal that the LLM under-produced (fix the prompt, not the renderer).

## Constants

```js
const TARGET_FILL_PCT = 0.97;
const LINE_H_STEP = 0.25;
const MAX_LINE_H_BUMP = 2.0;
const LINE_H_SAFETY_BUFFER = 6;
R.GAP_SECTION = 2;             // was 18
// ResumeWriter ctor default gaps.section = R.GAP_SECTION (was hardcoded 0)
```

## Verification (render-tested)

| Content | chars | fill | pages |
|---|---|---|---|
| BASE (full) | 3030 | 98% | 1 |
| Proxy (live-equivalent) | 2836 | 99% | 1 |
| Sparse (extreme undershoot) | 1798 | 86% | 1 (leading capped) |
| Overflow (3× bullets) | — | 95% via base-content fallback | 1 |

47/47 unit tests pass. 3-tier overflow fallback unchanged. Dead helpers
`countResumeGaps` / `countTotalLinesInContent` removed (no longer called).

## Residual

Bottom whitespace can still appear when the LLM produces well under ~2800 chars
(leading caps out). That's a content problem, not a layout one — the standing
follow-up is the tailoring-prompt char floor (already nudged in `ai.js`), and if
it keeps undershooting, programmatic enforcement (reject + retry on under-budget
output). The renderer's job is done: it fills the page when it can and degrades
gracefully when it can't, without ever floating the sections apart.
