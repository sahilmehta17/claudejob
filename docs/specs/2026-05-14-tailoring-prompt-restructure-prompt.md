# Claude Code Working Brief — ClaudeJob: resume tailoring prompt restructure (verb diversity + JD-focus-aware reordering)

**Date:** 2026-05-14
**Working directory:** `/Users/sahilmehtx/Desktop/Internships and Resume/ClaudeJob/files`
**Branch:** `main`
**Repo remote:** `https://github.com/sahilmehta17/claudejob.git`
**Parallel context:** Sahil is actively applying to jobs while you run this. Don't ask him questions mid-execution; surface findings at the end.

## Context

The current resume tailoring prompt in `routes/ai.js` does bullet-level rewrites within a fixed structure. It can rephrase bullets and swap in JD keywords. It cannot:

1. Detect verb monotony — the banned-cliché regex catches AI-resume tropes but doesn't flag verb repetition. Tailored resumes routinely have 7+ bullets starting with "Built" out of ~13 total, which the recruiter audit explicitly flagged as a weakness ("verb monotony Built/Built/Built").
2. Reorder Experience subsections based on JD focus. For a Frontend Engineer II JD at Box, leading with Custom Reports (React, complex UI) is the right move; for an AI Engineer JD at Anthropic, leading with the AI Copilot is right. Current prompt preserves fixed order regardless of JD.
3. Reorder bullets within a subsection. Currently bullet ordering is fixed across all tailored variants — the LLM rephrases but doesn't promote/demote.

This brief adds those three rules to the tailoring prompt. Pure prompt-engineering — no new logic in `ai.js`, just additions to the existing prompt's RULES block plus a new VARIED_VERBS list the LLM can draw from.

## Standing rules

1. **Read `routes/ai.js` end-to-end before editing.** Focus on the resume tailoring prompt — NOT the cover letter prompt at ~line 414 or the Q&A prompt at ~line 456. The resume tailoring prompt is the one that takes `RESUME_BASE_JSON` + JD and produces a per-JD modified JSON.
2. **No emojis. Default to no comments unless WHY is non-obvious.**
3. **Don't auto-commit until told.** Pre-authorized commit in §"Commit plan" — proceed without re-confirming.
4. **Don't touch the cover letter prompt or the Q&A prompt.** This brief is resume-only.
5. **Don't change the source-fact validator or banned-cliché regex.** Those are working; adding rules to the PROMPT doesn't require touching the VALIDATOR.
6. **Don't change `RESUME_BASE_JSON`.** Base content is canonical; this brief is about how tailoring transforms it.
7. **Run `node tests/ai.test.js` after edits.** 47/47 must pass.

## Fix 1 — Verb diversity rule + varied-verb pool

### File: `routes/ai.js` (resume tailoring prompt)

Locate the RESUME tailoring prompt's RULES block (where instructions like "preserve all factual claims," "limit each bullet to X words," etc. live). Add this rule:

```
VERB DIVERSITY (hard requirement — output is rejected if violated):
- Across the entire resume, no more than 2 bullets may start with the same verb.
- Avoid the default "Built" lead. Specifically: rephrase bullets so the resume uses a variety of opening verbs. Draw from this pool, picking the verb that most accurately describes what the candidate did for that bullet:
  Architected, Authored, Designed, Drove, Engineered, Established, Hardened, Implemented, Instrumented, Integrated, Launched, Led, Migrated, Optimized, Owned, Productionized, Refactored, Reduced, Replaced, Shipped, Scaled, Stabilized, Streamlined.
- If a bullet's most accurate verb truly is "Built" or "Created," that is fine — but use it sparingly (max 2 across the whole resume).
- Do not fabricate scope to fit a verb. "Architected" implies design authority; "Led" implies you directed others. Use accurately.
```

This is a soft constraint in the prompt (no programmatic verb-count enforcement yet — that's a follow-up if drift is observed). The LLM should self-police using the pool.

## Fix 2 — JD-focus-aware subsection reordering

### File: `routes/ai.js` (resume tailoring prompt)

Add a new section to the prompt, near the top of the instruction block (before the RULES), explaining JD-focus detection:

```
JD FOCUS DETECTION:
Before generating the tailored resume, classify the TARGET role's primary focus into ONE of these buckets:
  - frontend: roles emphasizing React, UI/UX, mobile, accessibility, design systems (e.g., "Frontend Engineer", "UI Engineer", "Mobile Engineer", "Web Developer").
  - backend: roles emphasizing services, databases, APIs, distributed systems, infrastructure (e.g., "Backend Engineer", "Platform Engineer", "Infrastructure Engineer", "Site Reliability Engineer").
  - ai_infra: roles emphasizing LLM systems, agents, RAG, vector DBs, MLOps (e.g., "AI Engineer", "ML Engineer", "Applied AI", "Forward Deployed Engineer at AI shop").
  - fullstack: roles requiring both frontend and backend (e.g., "Software Engineer" with no specialization, "Full-Stack Engineer", "Founding Engineer").
  - data: roles emphasizing data pipelines, analytics, modeling, statistics (e.g., "Data Engineer", "Data Scientist", "ML Engineer with pipeline focus").

Classify based on the JD's bullet density — count how many JD bullets describe each area, pick the dominant one.
```

Then add this rule to the RULES block:

```
SUBSECTION REORDERING (JD-focus-aware):
Within the "Software Developer, Enidus USA LLC." experience item, the Enidus subsections (AI Chatbot & Agentic Copilot, Custom Reports & Dashboards Platform, and any others) should be ordered based on JD FOCUS:
  - frontend → lead with Custom Reports & Dashboards Platform (React frontend), then AI Copilot.
  - backend → lead with AI Copilot (FastAPI backend depth), then Reports.
  - ai_infra → lead with AI Copilot (the headline agentic work), then Reports.
  - fullstack → lead with AI Copilot, then Reports (both have full-stack but AI is the marquee).
  - data → lead with Reports (data infra + multi-tenant analytics), then AI Copilot.
Do not invent new subsections; reorder existing ones.
```

## Fix 3 — JD-focus-aware bullet ordering within subsections

Add this rule to the RULES block:

```
BULLET ORDERING WITHIN SUBSECTIONS (JD-focus-aware):
Within each subsection, order bullets to lead with the most JD-aligned content:
  - frontend → lead with bullets that mention React, TypeScript, UI, UX, mobile, accessibility. Demote backend infra bullets (hybrid retrieval, RLS, RBAC, SQL templates, validators) to the bottom of the subsection — or omit entirely if the subsection has 5+ bullets and the backend-infra one is the weakest signal for this JD.
  - backend → lead with bullets about services, databases, APIs, distributed systems. Demote pure-frontend bullets.
  - ai_infra → lead with bullets about agentic systems, LLM safety, evaluation, retrieval, governance. Demote pure-frontend bullets.
  - fullstack → preserve current ordering (both signals matter); minor tweaks only.
  - data → lead with bullets about data pipelines, transformations, analytics. Demote pure-frontend or pure-AI-eval bullets.

When demoting, do not delete bullets unless asked. Reordering only.
```

## What stays the same

- Source-fact validation: untouched, still catches fabrication.
- Banned-cliché regex: untouched, still catches AI tropes.
- Layout constraints (1-page guard, widow guard, 95% fill): untouched.
- Cover letter prompt: untouched.
- Q&A prompt: untouched.
- `RESUME_BASE_JSON`: untouched.

## Verification before commit

1. `node tests/ai.test.js` — 47/47 pass.
2. Restart `node server.js`. Run the pipeline against a saved JD with a clear frontend focus (Box Frontend Engineer II at /Users/sahilmehtx/Desktop/Internships and Resume/JobApplications/Box_Frontend-Engineer-II_*, or paste the Box JD into "Paste JD" if no saved bundle).
3. Open the rendered tailored PDF. Verify:
   - Custom Reports & Dashboards Platform appears BEFORE AI Copilot in the Enidus section.
   - Bullets within AI Copilot lead with React/TypeScript/UI content; hybrid-retrieval and RLS/RBAC bullets are at the bottom (or absent).
   - Across the whole resume, no more than 2 bullets start with "Built" (count manually — should be max 2-3 since the LLM can't be precisely held to "2," but should be a clear reduction from the current 7+).
4. Run the pipeline against an AI Engineer JD (e.g., the Amex AI Engineer II from tracker, or any Anthropic / Cursor JD). Verify:
   - AI Copilot appears BEFORE Custom Reports.
   - Hybrid retrieval + safety bullets lead.
   - This confirms the JD-focus detection works in both directions.

## Commit plan (pre-authorized — proceed without re-confirming)

Single commit:

```
ai: resume tailoring prompt — verb diversity, JD-focus-aware subsection + bullet reordering
```

Body line: Adds three rules to the resume tailoring prompt to address verb monotony ("Built / Built / Built" repetition flagged in recruiter audit) and structural rigidity (subsections + bullets in fixed order regardless of JD focus). JD-focus detection classifies into frontend/backend/ai_infra/fullstack/data buckets; subsection and bullet ordering adapt accordingly. Soft constraints in the prompt — no new validator logic. Banned-cliché regex and source-fact validator remain unchanged.

Push to `origin/main`:
```bash
git push origin main
```

## What to do AFTER this lands

1. Surface anything you discovered:
   - If the LLM ignores the verb-diversity rule (still produces 5+ "Built" bullets), flag — may need stronger imperative wording or a programmatic count check.
   - If subsection reordering is inconsistent (sometimes follows the rule, sometimes doesn't), flag with example JDs.
   - If the JD-focus classification picks the wrong bucket on edge cases (e.g., a JD that mentions React AND AI heavily), flag with the actual classification it chose.
2. **Do not** modify the source-fact validator.
3. **Do not** add new banned-cliché regex patterns.
4. **Do not** change layout constants (TARGET_FILL_PCT, MAX_GAP_MULTIPLIER, etc.).

## Operating model reminder

Cowork writes briefs. You execute. Sahil is applying in parallel — surface findings concisely at the end.

---

End of brief. Read the resume tailoring prompt in `routes/ai.js` first, then proceed with Fix 1.
