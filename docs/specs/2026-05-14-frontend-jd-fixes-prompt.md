# Claude Code Working Brief — ClaudeJob: hybrid-title classification + skill budget + JD-keyword preservation + fallback visibility

**Date:** 2026-05-14
**Working directory:** `/Users/sahilmehtx/Desktop/Internships and Resume/ClaudeJob/files`
**Branch:** `main`
**Repo remote:** `https://github.com/sahilmehta17/claudejob.git`
**Supersedes:** `docs/specs/2026-05-14-tailoring-fallback-visibility-prompt.md` (do not fire that one — this brief incorporates its fixes plus a new one).
**Parallel context:** Sahil is actively applying to jobs. Don't ask him questions mid-execution; surface findings at the end.

## Context

After the tailoring prompt restructure (commit `7a6a8a3`) and base verb-diversity pass, a Box "Frontend Engineer II, AI Experiences" submission exposed four related bugs:

**Bug 1 — Hybrid-flavor titles mis-classified.** Box's title contains "AI Experiences" but the JD body describes React/React Native frontend work. The new JD FOCUS DETECTION rule classified it as `ai_infra` (because of the title keyword) → subsection reordering didn't fire → AI Copilot stayed above Custom Reports for a frontend role.

**Bug 2 — Skills section grew to 5 lines.** The tailoring prompt restructure inadvertently allowed splitting Frameworks/Backend into separate Frontend & UI + Backend & APIs categories for frontend JDs. Base resume has 4 skill lines; tailored grew to 5. Extra line pushed total content past 1 page → 3-tier fallback fired → BASE got rendered → user thinks they submitted tailored, actually submitted base.

**Bug 3 — Verb-diversity rewrite collapses JD-keyword anchors.** Earlier tailored version for Box opened Copilot bullet 1 with "Built a React + TypeScript frontend UI for an AI assistant..." — explicit React signal. The new tailoring rewrote to "Shipped an AI assistant enabling natural-language queries..." to satisfy verb diversity, BUT also dropped the "React + TypeScript frontend UI" anchor entirely. The verb rule made the LLM simplify, losing JD-specific framing during rewrite.

**Bug 4 — Render fallback is silent.** When the 3-tier fallback fires (any tier), the UI continues showing tailored output while the PDF saved is something else (default-spacing tailored OR BASE). User submits the wrong artifact thinking it's tailored. Critical UX bug.

## Standing rules

1. **Read `routes/ai.js` end-to-end before editing.** Focus on `buildResumePrompt` (resume tailoring) and the JD FOCUS DETECTION + RULES blocks. Cover letter and Q&A prompts are off-limits.
2. **Read `routes/pdfRender.js`** for the 3-tier fallback (`renderResumePdf`). The fallback metadata needs to surface upward.
3. **Read `routes/saveBundle.js`** for how render results are returned to the API layer.
4. **No emojis. Default to no comments unless WHY is non-obvious.**
5. **Don't auto-commit until told.** Pre-authorized commits in §"Commit plan" — proceed without re-confirming.
6. **Don't change `RESUME_BASE_JSON`** (it was just edited for verb diversity).
7. **Run `node tests/ai.test.js` after each fix.** 47/47 must pass throughout.

## Fix 1 — JD focus tiebreaker for hybrid-flavor titles

### File: `routes/ai.js` (JD FOCUS DETECTION section)

The current classification weights JD bullet density. For hybrid-flavor titles ("Frontend Engineer II, AI Experiences," "Software Engineer, AI Platform," "Backend Engineer, ML Infra"), the title contains AI keywords but the BODY describes frontend/backend work primarily. The LLM picks the title-based bucket and reorders wrong.

Add a tiebreaker subsection to JD FOCUS DETECTION (insert after the existing classification rules, before STRICT RULES):

```
TIEBREAKER FOR HYBRID-FLAVOR TITLES:
If the JD title contains AI keywords (AI, ML, LLM, GenAI, Agentic, Intelligent) BUT primarily describes one of the other focus areas in the body, classify based on the BODY, not the title. Specifically:
  - "Frontend Engineer" / "UI Engineer" / "Mobile Engineer" / "Web Developer" / "Web Engineer" in the title (with or without AI qualifier) → classify as 'frontend' UNLESS the body explicitly says >50% of the work is on AI/ML infrastructure (model serving, vector DB ops, agent orchestration as primary).
  - "Backend Engineer" / "Platform Engineer" / "Infrastructure Engineer" in the title (with or without AI qualifier) → classify as 'backend' under the same rule.
  - "AI Experiences" / "AI Features" / "AI Platform" / "Intelligent X" qualifier in a frontend/backend title means "this team builds AI-flavored features" — the engineering work itself is still frontend/backend.
  - 'ai_infra' is reserved for roles where the JD body describes BUILDING the AI/ML platform itself (LLM serving, RAG indexing, agent runtimes, evaluation harnesses) as primary work.
  - When in doubt between two buckets, weight by the "WHAT YOU'LL DO" section: count keywords for each area (frontend: React, UI, mobile, accessibility, components; backend: services, databases, APIs, scaling; ai_infra: LLM, RAG, agents, MLOps, eval harness).
```

This should fix Box's classification (title says "AI Experiences" but body is React/RN frontend → classify as `frontend`).

## Fix 2 — Hard 4-line skills section budget

### File: `routes/ai.js` (resume tailoring prompt STRICT RULES)

Add to STRICT RULES:

```
SKILLS SECTION LINE COUNT (hard requirement — output is rejected if violated):
- The TECHNICAL SKILLS section must contain EXACTLY 4 category lines, matching the base resume's structure. The base has: AI / LLM Systems, Languages, Frameworks, Infra & Tools.
- You may RENAME and REORDER categories to match JD focus (e.g., "Frontend & Mobile: ..." instead of "Frameworks: ..." for frontend roles) but you may NOT add a 5th category line.
- If you need to surface both frontend AND backend frameworks for a fullstack JD, combine them under a single line: "Frameworks & APIs: React, Node.js, Express, FastAPI, ...".
- Total skills section height must fit within the 4-line budget the base resume uses. Adding a 5th line overflows the page and triggers fallback to base.
```

## Fix 3 — Preserve JD-keyword anchors during bullet rewriting

### File: `routes/ai.js` (resume tailoring prompt STRICT RULES)

The verb-diversity rule combined with bullet rewriting can collapse JD-specific framing. Earlier Box tailoring had "Built a React + TypeScript frontend UI for an AI assistant"; the new rules rewrote to "Shipped an AI assistant" — losing the React anchor.

Add a new strict rule:

```
JD-KEYWORD ANCHOR PRESERVATION (hard requirement):
When rewriting bullets for verb diversity or JD-focus reordering, PRESERVE any technology / framework keywords from the JD's required-skills section in the bullet text. Specifically:
- Identify the top 5-8 technology keywords from the JD's "What you'll be doing" / "Who you are looking for" / "Qualifications" sections (e.g., React, React Native, TypeScript, GraphQL, REST, accessibility, A/B testing, feature flags).
- For each Enidus subsection, ensure at least ONE bullet within that subsection mentions a relevant JD keyword in its body text (not just the skills section at the bottom of the resume — recruiters scan bullets, not just skills lists).
- If a bullet's original phrasing included a JD keyword (e.g., "React + TypeScript frontend UI"), DO NOT drop that keyword during the verb-diversity rewrite. Find a way to keep it in the new phrasing.
- Acceptable: "Shipped a React + TypeScript frontend for the AI assistant..." (preserved React+TS).
- Unacceptable: "Shipped an AI assistant enabling natural-language queries..." (lost React+TS anchor that was in the JD).
- The skills section listing is necessary but not sufficient. Bullets must demonstrate use of the JD keywords, not just claim them.
```

This is the most consequential fix — it prevents the verb rewrite from making the output worse for keyword-sensitive JDs (which is most frontend / backend / data / specialist roles).

## Fix 4 — Surface render fallback to the UI

### File: `routes/pdfRender.js`

`renderResumePdf` currently returns the output path string. Change to return an object with fallback metadata:

```js
return {
  path: outPath,
  fallback: 'none' | 'default-spacing' | 'base-content',
  fillPct: number,
};
```

Each tier sets the appropriate `fallback`:
- Tier 1 (adjusted gaps + lineH): `fallback: 'none'`
- Tier 2 (default spacing): `fallback: 'default-spacing'`
- Tier 3 (RESUME_BASE_JSON): `fallback: 'base-content'`

### File: `routes/saveBundle.js`

Update the call site to consume the new return shape. Plumb `fallback` into the bundle response:

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

### Find the route handler that calls saveBundle

Probably in `routes/ai.js` (the SSE-streaming pipeline endpoint) or `routes/apply.js`. When `renderInfo.resumeFallback !== 'none'`, emit an SSE event:

```js
send({
  step: 'resume',
  status: 'warning',
  fallback: resumeResult.fallback,
  message: resumeResult.fallback === 'base-content'
    ? 'Tailored content was too long for 1 page — fell back to BASE resume. The PDF saved is your canonical base, not the tailored version shown above.'
    : 'Tailored content overflowed at adjusted spacing — fell back to default spacing. PDF is tailored but with reduced page fill.',
});
```

### File: `public/index.html` (or wherever the SSE consumer renders steps)

Find the existing step-status handler. Add a `'warning'` branch that renders a yellow/amber banner with the warning message. The banner should be:
- Visually impossible to miss (top of the resume section, yellow background, bold text)
- NOT auto-dismissable — user must click "Acknowledge" or "Re-run pipeline" before the submit button enables
- Contain a "Re-run pipeline" action that re-triggers tailoring (non-deterministic — second run often produces different output that fits)

If the frontend SSE consumer lives in a separate file, update there. Find existing patterns for step rendering and follow them.

## Verification before commit

1. `node tests/ai.test.js` — 47/47 pass.
2. Restart `node server.js`. Run the pipeline against the Box JD (saved in `data/tracker.json` or paste fresh). Verify:
   - Output classifies as `frontend` (subsection order: Reports BEFORE AI Copilot).
   - AI Copilot bullets — at least 1 mentions React or TypeScript explicitly (anchor preservation working).
   - Skills section has EXACTLY 4 lines.
   - PDF saved matches UI preview (no fallback fires).
   - Console logs `[pdfRender] page filled at NN%` with NN ≥ 90 and `fallback: 'none'`.
3. Run pipeline against an AI Engineer JD (Amex AI Engineer II from tracker, or any Anthropic JD). Verify:
   - Classifies as `ai_infra` (AI Copilot BEFORE Reports — correct for AI roles).
   - 4 skill lines.
   - No fallback fires.
4. **Force a fallback for the UI test:** create a contrived JD with maximum padding (or temporarily lower the `MAX_GAP_MULTIPLIER` cap to trigger overflow). Verify:
   - SSE stream emits `status: 'warning'`.
   - UI banner appears, yellow, undismissable.
   - Submit button is gated until user acknowledges.
   - "Re-run pipeline" button works.
   - After ack, revert the cap.

## Commit plan (pre-authorized — proceed without re-confirming)

Four commits, in order:

```
ai: hybrid-title tiebreaker — classify by body, not title keyword
ai: hard 4-line skills section budget
ai: preserve JD-keyword anchors during bullet rewriting (verb diversity / JD-focus reorder must not drop tech keywords)
pdfRender + saveBundle + ui: surface 3-tier fallback to user, yellow banner, gated submit
```

For commit 1, body line: Box "Frontend Engineer II, AI Experiences" was being classified as ai_infra because of the title's AI keyword, even though the body described React/React Native frontend work. Tiebreaker now weights body content over title keywords for hybrid-flavor titles.

For commit 2, body line: The tailoring prompt restructure (commit 7a6a8a3) inadvertently let the skills section grow to 5 lines on frontend JDs (split Backend & Frameworks into two). Base resume budget is 4 lines; 5 lines overflow page 1 and trigger silent BASE fallback. Constrained to 4.

For commit 3, body line: Verb-diversity rewriting was collapsing JD-keyword anchors in bullet text (e.g., "Built a React + TypeScript frontend UI" → "Shipped an AI assistant" dropped React+TS). Added an anchor-preservation rule requiring tailored bullets to retain top JD tech keywords within experience bullets (not just skills section).

For commit 4, body line: 3-tier render fallback was silent — UI showed tailored output while PDF saved could be default-spacing tailored OR BASE. Plumbed fallback tier through saveBundle into SSE events; UI now shows a yellow banner when fallback fires and gates the submit button until acknowledged.

Push to `origin/main`:
```bash
git push origin main
```

If push is blocked by branch protection, surface to user — they'll push from their Terminal.

## What to do AFTER this lands

1. Surface anything you discovered:
   - If hybrid-title tiebreaker mis-classifies on edge cases ("Founding Engineer" or "Software Engineer" without specialization), flag the JDs that landed in the wrong bucket.
   - If anchor preservation doesn't fully work (LLM still drops keywords), flag a specific bullet that should have kept a keyword but didn't.
   - If the UI banner is dismissable too easily or visually weak, flag.
2. **Do not** modify `RESUME_BASE_JSON` or `CANDIDATE_FACTS`.
3. **Do not** modify the source-fact validator or banned-cliché regex.
4. **Do not** touch cover letter or Q&A prompts.
5. **Do not** change layout constants (TARGET_FILL_PCT, MAX_GAP_MULTIPLIER, etc.).

## Operating model reminder

Cowork writes briefs. You execute. Sahil is applying in parallel — surface findings concisely at the end.

---

End of brief. Read `routes/ai.js` (buildResumePrompt + JD FOCUS DETECTION + STRICT RULES), `routes/pdfRender.js` (renderResumePdf + 3-tier fallback), `routes/saveBundle.js`, and the relevant frontend SSE consumer first. Then proceed with Fix 1.
