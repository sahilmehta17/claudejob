# Claude Code Working Brief — ClaudeJob: hard character budget for tailored resume bullets

**Date:** 2026-05-14
**Working directory:** `/Users/sahilmehtx/Desktop/Internships and Resume/ClaudeJob/files`
**Branch:** `main`
**Repo remote:** `https://github.com/sahilmehta17/claudejob.git`
**Parallel context:** Sahil is actively applying to jobs. Don't ask him questions mid-execution; surface findings at the end.

## Context

After the frontend-JD fixes brief (`2026-05-14-frontend-jd-fixes-prompt.md`, commits f0a29f5 + b1ae1fa + dc33e4e + 8956a94), the Box "Frontend Engineer II, AI Experiences" submission STILL hit the third-tier fallback. Console output:

```
[pdfRender] tailored render overflowed despite projection; retrying with default spacing
[pdfRender] tailored content too long for 1 page even at default spacing — falling back to RESUME_BASE_JSON. Tailoring discarded for this submission.
```

The LLM is satisfying individual rules (verb diversity, anchor preservation, 4-line skills) but not the aggregate page budget. Each rule independently makes the output BETTER but adds CHARACTERS — verb-diverse rewriting expands word count, anchor preservation requires keyword inclusion, skill renames produce longer category labels. Combined, the output exceeds what fits on 1 page.

The render pipeline's safety net (3-tier fallback) is doing its job — preventing empty PDFs and 2-page submissions. But the user-visible result is "tailoring discarded" which makes the whole tailoring system feel non-functional for content-dense JDs.

This brief adds a HARD character budget computed from `RESUME_BASE_JSON`. The base is known to fit on 1 page; its total bullet character count is the budget. The LLM gets that number in the prompt as a strict ceiling.

## Standing rules

1. **Read `routes/resumeContent.js` and `routes/ai.js` end-to-end before editing.**
2. **No emojis. Default to no comments unless WHY is non-obvious.**
3. **Don't auto-commit until told.** Pre-authorized commits in §"Commit plan" — proceed without re-confirming.
4. **Don't change `RESUME_BASE_JSON`.** Base content is canonical.
5. **Don't change the 3-tier fallback in pdfRender.js.** It's the safety net for cases this brief can't fully prevent.
6. **Run `node tests/ai.test.js` after edits.** 47/47 must pass.

## Fix 1 — Export `BASE_BULLET_CHAR_BUDGET` from resumeContent.js

### File: `routes/resumeContent.js`

Add a function near the bottom (after `RESUME_BASE_JSON` is defined, before the module exports) that computes total bullet character count for a resume JSON structure:

```js
/**
 * Sum character count of all bullet text across experience + projects sections.
 * Used by the resume tailoring prompt as the hard upper bound for tailored
 * output — the base is known to fit 1 page, so its total bullet char count is
 * the budget tailored variants must not exceed.
 *
 * Skills section is excluded because it's constrained separately (4 lines).
 * Section headers, job titles, dates, subsection names also excluded — they're
 * structural and don't shrink under tailoring.
 */
function sumBulletChars(resumeJson) {
  let total = 0;
  for (const section of resumeJson.sections || []) {
    if (section.type === 'experience') {
      for (const item of section.items || []) {
        for (const sub of item.subsections || []) {
          for (const b of sub.bullets || []) total += String(b).length;
        }
      }
    } else if (section.type === 'projects') {
      for (const item of section.items || []) {
        for (const b of item.bullets || []) total += String(b).length;
      }
    }
  }
  return total;
}

const BASE_BULLET_CHAR_BUDGET = sumBulletChars(RESUME_BASE_JSON);
```

Export the function and the constant:

```js
module.exports = {
  RESUME_BASE_JSON,
  CANDIDATE_FACTS,
  renderResumeText,
  ADJACENCY_MAP,
  applyAdjacency,
  extractUserSkills,
  sumBulletChars,
  BASE_BULLET_CHAR_BUDGET,
};
```

After this lands, `BASE_BULLET_CHAR_BUDGET` will be the canonical number — approximately 2700-3000 characters based on the current base bullets. It updates automatically if `RESUME_BASE_JSON` is edited.

## Fix 2 — Inject the budget into the tailoring prompt

### File: `routes/ai.js`

Import the new constant alongside the existing `CANDIDATE_FACTS` import:

```js
const { RESUME_BASE_JSON, CANDIDATE_FACTS, BASE_BULLET_CHAR_BUDGET } = require('./resumeContent');
```

In `buildResumePrompt`, add a hard rule near the top of the STRICT RULES block (above the existing LAYOUT CONSTRAINTS):

```
HARD CHARACTER BUDGET (most important rule — output is rejected if violated):
- The total character count of all bullet text across experience + projects sections must NOT exceed ${BASE_BULLET_CHAR_BUDGET} characters.
- This is the budget the base resume uses, which fits on exactly 1 page. Tailored versions that exceed this budget overflow page 1 and trigger fallback to the base resume — meaning your tailoring is discarded entirely.
- Count BEFORE submitting: sum the .length of every bullet string. If your output exceeds ${BASE_BULLET_CHAR_BUDGET}, COMPRESS bullets: drop redundant clauses, tighten phrasing, or drop the lowest-relevance bullet entirely.
- Skills section is constrained separately (4 lines). This budget applies only to bullet content.
- This budget OVERRIDES all other content goals. If preserving a JD-keyword anchor or following verb diversity would push you over budget, COMPRESS something else FIRST. The budget is non-negotiable.
```

The `${BASE_BULLET_CHAR_BUDGET}` interpolation must be a real JS template literal inside the prompt-building function — the LLM sees the actual number (e.g., "2847"), not the variable name.

## Fix 3 — Post-tailoring validation with budget warning

### File: `routes/ai.js`

After the LLM produces the tailored JSON (look for where the JSON is parsed and validated), add a budget check using `sumBulletChars` from resumeContent.js. This is a warn-only check (not a hard reject) since the 3-tier render fallback will catch actual overflow:

```js
const { sumBulletChars, BASE_BULLET_CHAR_BUDGET } = require('./resumeContent');

// After parsing the tailored JSON:
const tailoredChars = sumBulletChars(tailoredJson);
const overBudget = tailoredChars - BASE_BULLET_CHAR_BUDGET;
if (overBudget > 0) {
  console.warn(
    `[ai.tailoring] tailored output exceeds char budget by ${overBudget} chars ` +
    `(${tailoredChars} of ${BASE_BULLET_CHAR_BUDGET}) — render fallback likely to fire`
  );
} else if (overBudget < -200) {
  // Tailored is significantly under-budget — flag for opposite reason (page may look thin)
  console.log(
    `[ai.tailoring] tailored output is ${-overBudget} chars under budget ` +
    `(${tailoredChars} of ${BASE_BULLET_CHAR_BUDGET}) — page may underfill`
  );
}
```

This logs a clear signal in the server console BEFORE the render attempts. If the budget rule isn't being respected by the LLM, you'll see consistent warnings here. If you see warnings on most tailored outputs, the prompt rule needs stronger wording.

## What stays the same

- `RESUME_BASE_JSON` content (just verb-diversified earlier today)
- 3-tier render fallback in pdfRender.js (still the safety net)
- All other tailoring rules (verb diversity, JD-focus reordering, anchor preservation, 4-line skills)
- Cover letter and Q&A prompts
- Source-fact validator and banned-cliché regex

## Verification before commit

1. `node tests/ai.test.js` — 47/47 pass.
2. Confirm the computed budget number by running:
   ```bash
   node -e "const { BASE_BULLET_CHAR_BUDGET } = require('./routes/resumeContent'); console.log('budget:', BASE_BULLET_CHAR_BUDGET);"
   ```
   Expect a number between 2500 and 3200. If it's outside that range, something's off with `sumBulletChars`.
3. Restart `node server.js`. Run the pipeline against the Box JD (or any saved JD). Verify:
   - Server console shows the new warn log if the LLM overshot, OR no log if under budget
   - Render fallback either does not fire (tailored fits) or still fires for genuinely-too-dense JDs
4. Run the pipeline against the AI Engineer Amex JD. Verify the budget rule doesn't cause the AI-Copilot-leading output to lose meaningful content.

## Commit plan (pre-authorized — proceed without re-confirming)

Two commits:

```
resumeContent: export sumBulletChars + BASE_BULLET_CHAR_BUDGET as the tailoring budget
ai: hard character budget rule in tailoring prompt + post-LLM budget validation log
```

For commit 1, body line: budget is computed from RESUME_BASE_JSON at module load; updates automatically if base changes. Used by the tailoring prompt to give the LLM a hard upper bound that's known to fit on 1 page.

For commit 2, body line: previous tailoring rules (verb diversity, anchor preservation, JD-focus reorder) each independently improved output but combined exceeded the page budget. Hard character budget gives the LLM a number to stay under and a clear instruction to compress when over. Post-LLM validation logs over/under-budget so prompt drift is visible in server console.

Push to `origin/main`:
```bash
git push origin main
```

If branch protection blocks: surface to user — they'll push from Terminal.

## What to do AFTER this lands

1. Surface anything you discovered:
   - The computed `BASE_BULLET_CHAR_BUDGET` value — flag if it seems unreasonable (< 2000 or > 3500).
   - If 3 consecutive pipeline runs all overshoot the budget by >100 chars, the prompt rule isn't strong enough — promote from soft constraint to hard rejection with re-prompt.
   - If the budget is too tight (most JDs need to drop content to fit), consider raising by ~5% — the base might be at the conservative end of the renderable range.
2. **Do not** modify any other rules. This brief is the budget rule ONLY.
3. **Do not** change the 3-tier fallback in pdfRender.js. It stays as the ultimate safety net.

## Operating model reminder

Cowork writes briefs. You execute. Sahil is applying in parallel — surface findings concisely at the end.

---

End of brief. Read `routes/resumeContent.js` (export structure + RESUME_BASE_JSON shape) and `routes/ai.js` (buildResumePrompt) first, then proceed with Fix 1.
