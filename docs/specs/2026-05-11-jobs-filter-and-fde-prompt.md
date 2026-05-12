# Claude Code Working Brief — ClaudeJob: FDE role + seniority filter fix

**Date:** 2026-05-11
**Working directory:** `/Users/sahilmehtx/Desktop/Internships and Resume/ClaudeJob/files`
**Branch:** `main`
**Repo remote:** `https://github.com/sahilmehta17/claudejob.git`

## Context

Sahil opened the Search tab at `localhost:3000`, filtered to "AI Engineer" / "New York, NY" / "Last 24 hours" / "0–3 years (Junior/Mid)" / "$100k+", and got back "Principal Data Scientist, AI Foundations" at Capital One. Two issues:

1. Senior-titled roles are slipping past the junior/mid experience cap.
2. He wants Forward Deployed Engineer as a selectable role type (Anthropic/Palantir/Decagon-style hybrid eng+customer roles).

This brief addresses both. They're independent changes but small enough to ship in one push.

## Standing rules

1. **Read `package.json` and the existing `routes/jobs.js` end-to-end before editing.** The file has both the JSearch API client AND the local post-filter logic — change the post-filter without touching the score function.
2. **No emojis. Default to no comments unless WHY is non-obvious.**
3. **Don't auto-commit until told.** The user has pre-authorized the commits in §"Commit plan" — proceed without re-confirming.
4. **No new dependencies.** Both changes are in existing files.
5. **Run `node tests/ai.test.js` after edits.** 47 tests should still pass (they cover the AI pipeline, not jobs.js — but a regression suite is a regression suite).

## Change 1: Add Forward Deployed Engineer to role lookup

Two surgical edits.

### File: `public/index.html` (around line 410)

Current:
```html
<option>AI Engineer</option>
<option>Software Engineer</option>
<option>Data Engineer</option>
<option>Data Scientist</option>
<option>ML Engineer</option>
```

Add `Forward Deployed Engineer` **between AI Engineer and Software Engineer** so it sits near the top of the dropdown (it's a higher-priority target than Data/ML roles for the current applicant):

```html
<option>AI Engineer</option>
<option>Forward Deployed Engineer</option>
<option>Software Engineer</option>
<option>Data Engineer</option>
<option>Data Scientist</option>
<option>ML Engineer</option>
```

### File: `routes/jobs.js` (around line 16-22)

Current `ROLE_QUERIES`:
```js
const ROLE_QUERIES = {
  'AI Engineer':       'AI engineer OR machine learning engineer',
  'Software Engineer': 'software engineer',
  'Data Engineer':     'data engineer',
  'Data Scientist':    'data scientist',
  'ML Engineer':       'machine learning engineer OR ML engineer',
};
```

Add the FDE entry in the same position (between AI Engineer and Software Engineer):

```js
const ROLE_QUERIES = {
  'AI Engineer':                'AI engineer OR machine learning engineer',
  'Forward Deployed Engineer':  'forward deployed engineer OR FDE OR applied engineer',
  'Software Engineer':          'software engineer',
  'Data Engineer':              'data engineer',
  'Data Scientist':             'data scientist',
  'ML Engineer':                'machine learning engineer OR ML engineer',
};
```

**Important:** the query intentionally does NOT include "solutions engineer." That phrase pulls in pre-sales SE roles which are not the same job and would dilute results. Don't add it.

## Change 2: Fix the seniority filter

The bug is in `routes/jobs.js` lines 339–347 (the post-filter block after `expCapMonths`).

### Current behavior (broken)

```js
const expCapMonths = (() => {
  if (opts.expLevel === 'junior_only') return 24;
  if (opts.expLevel === 'under_3')     return 36;
  if (opts.expLevel === 'under_5')     return 60;
  return null;
})();
if (expCapMonths != null) {
  filtered = filtered.filter(j => j.expMonths == null || j.expMonths <= expCapMonths);
}
```

Two issues compound: (a) JSearch returns null for `job_required_experience.required_experience_in_months` on the majority of senior listings, so `expMonths == null` keeps them; (b) the filter never looks at the title.

### Fix

Add a senior-title regex at module scope (top of file, near the other module-level constants like `KNOWN_TECH`), then use it in the post-filter:

```js
// Conservative senior-title regex. Catches the unambiguous keywords without
// false-positive on mid-level titles. Lowercase compare via the /i flag.
// Used by the post-filter to exclude senior-titled jobs when the user selects
// a junior/mid experience cap — JSearch's expMonths field is null on most
// senior listings, so title detection is the reliable signal.
const SENIOR_TITLE = /\b(senior|sr\.?|staff|principal|lead|distinguished|director|head\s+of|vp|chief)\b/i;
```

Then replace the post-filter:

```js
if (expCapMonths != null) {
  filtered = filtered.filter(j => {
    // Hard exclude on senior titles regardless of expMonths.
    if (SENIOR_TITLE.test(j.title)) return false;
    // Otherwise: explicit months wins; null is kept (no signal != fail).
    return j.expMonths == null || j.expMonths <= expCapMonths;
  });
}
```

That single line — the `SENIOR_TITLE.test(j.title)` short-circuit — fixes the Principal Data Scientist case directly.

**Don't change** the scoring function's senior penalty (the `-5` at line 90 of the original). The score-level signal stays useful even for titles that pass the filter (e.g., a senior-skewed listing surfacing via no-expLevel-filter search).

### Optional minor refactor (do this if it's clean, skip if it adds noise)

The scoring function at line 90 currently uses its own inline regex `/\b(senior|staff|principal|lead)\b/`. Once `SENIOR_TITLE` exists at module scope, replace that inline regex with `SENIOR_TITLE.test(tl)` so the seniority-detection logic has one source of truth. If this refactor requires you to expand the regex match in the scoring function (since the new `SENIOR_TITLE` includes more keywords), update the comment in the score function to reflect the broader detection.

## Verification before commit

1. The Node app boots clean: `node server.js` should start without error, then curl the API:
   ```bash
   curl 'http://localhost:3000/api/jobs/categories'
   ```
   Should include `"Forward Deployed Engineer"` in the categories array.
2. Manual smoke check in the browser at `http://localhost:3000`:
   - Search tab → Role Type dropdown shows Forward Deployed Engineer second.
   - Search "AI Engineer / 0–3 years" — no titles starting with Senior / Sr / Staff / Principal / Lead / Distinguished / Director / Head of / VP / Chief in the results.
   - Search "Forward Deployed Engineer / NYC / 0–3 years" — returns 0–N actual FDE / applied engineer listings.
3. `node tests/ai.test.js` — 47 tests still pass.

## Commit plan (pre-authorized — proceed without re-confirming)

Two commits:

```
jobs: add Forward Deployed Engineer role lookup
jobs: exclude senior titles from junior/mid experience-cap filter
```

For the FDE commit, include a one-line body explaining why "solutions engineer" was deliberately excluded.

For the filter commit, include a body explaining the root cause (JSearch returns null for `expMonths` on most senior listings, so title detection is the reliable signal — score-level penalty is insufficient because the filter never looks at the score).

Push to `origin/main` after both land:
```bash
git push origin main
```

## What to do AFTER this lands

1. Surface anything you discovered that wasn't in this brief — e.g., other roles that bias toward seniority (sometimes "Engineer III" reads senior at certain companies), other filter edge cases.
2. **Don't** add new filter UI options on your own (e.g., a "Hide senior titles" toggle). That's a Cowork decision.
3. **Don't** change the scoring formula. Just the filter.

## Operating model reminder

Cowork sessions write briefs like this. You (Claude Code) execute. If you find yourself wanting to make a strategic call — change the role taxonomy, restructure the filter UI, modify the scoring algorithm — write the finding into a short note and stop, don't decide. The user takes findings back to Cowork.

---

End of brief. Read `package.json` and `routes/jobs.js` first, then proceed with Change 1.
