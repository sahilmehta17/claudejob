# Claude Code Working Brief — ClaudeJob: single source of truth for candidate facts

**Date:** 2026-05-11
**Working directory:** `/Users/sahilmehtx/Desktop/Internships and Resume/ClaudeJob/files`
**Branch:** `main`
**Repo remote:** `https://github.com/sahilmehta17/claudejob.git`
**Parallel context:** Sahil is actively applying to jobs while you run this. Don't ask him questions mid-execution; surface findings at the end.

## Context

The §9.3 resume restructure (April 2026) trimmed two stats — GSPANN's 97% accuracy and Orahi's 15% latency — from the resume. The cover letter prompt and Q&A prompt in `routes/ai.js` still had those stats hardcoded until commit `d2b2f70` (today, 2026-05-11) synced them manually.

This is the **second time** the prompts drifted from the resume. Code's post-execution finding flagged it: "A small CANDIDATE_FACTS constant in resumeContent.js interpolated into both prompts would prevent it." That's correct, and worth doing as a correctness-class refactor — not optimization, since the failure mode has now happened twice and will happen again on the next resume edit.

This brief implements that single source of truth. Plus two small cleanups.

## Standing rules

1. **Read `routes/resumeContent.js` and `routes/ai.js` end-to-end before editing.** The resume content file is the canonical data; `ai.js` has TWO prompts (cover letter at ~line 414 and Q&A at ~line 456) that both consume the same candidate facts.
2. **No emojis. Default to no comments unless WHY is non-obvious.**
3. **Don't auto-commit until told.** Pre-authorized commits in §"Commit plan" — proceed without re-confirming.
4. **Don't change the prompts' `TONE:` directives or banned-phrase lists.** Tone is parked per council verdict.
5. **Don't add new candidate facts that aren't already in the resume.** This is a refactor, not a content change. If you find facts in the existing prompts that AREN'T in `RESUME_BASE_JSON`, flag them at the end — don't silently include them.
6. **Run `node tests/ai.test.js` after edits.** 47 tests should pass.

## Fix 1 — Extract `CANDIDATE_FACTS` constant

### File: `routes/resumeContent.js`

Add a `CANDIDATE_FACTS` constant near the top of the file (after the `PHONE` declaration, before `RESUME_BASE_JSON`). Structure it as readable plain text that can be interpolated directly into prompts:

```js
// ─────────────────────────────────────────────────────────────────────────────
// CANDIDATE_FACTS — single source of truth for facts the AI prompts cite.
//
// Both the cover letter prompt and Q&A prompt in routes/ai.js interpolate this
// constant. When the resume content changes, edit this string AND update the
// corresponding bullets in RESUME_BASE_JSON. Both must stay in sync.
//
// Discovered after §9.3 (April 2026) and again 2026-05-11: the prompts
// hardcoded stats that had been trimmed from the resume. Centralizing the
// facts here makes drift visible as a single-file diff.
// ─────────────────────────────────────────────────────────────────────────────
const CANDIDATE_FACTS = `
- B.S. Computer Science + B.S. Data Science, UW-Madison (graduated May 2025; ~1 year full-time experience since)
- Full-time SWE at Enidus USA LLC (June 2025 - present): sole engineer on three plugins for T-Mobile for Business enterprise portal
- DOMAIN EXPERIENCE: ships production AI against regulated enterprise telecom data — billing account numbers (BANs), device SKUs/IMEIs, line state transitions (active/suspended/ported/cancelled), multi-tenant reseller hierarchies (resellers managing enterprise customer accounts). Real audit-traceable state-mutating operations on real customer data, not toy datasets. The kind of regulatory-shaped work that maps cleanly to financial services, healthcare, and other regulated-enterprise AI domains.
- Plugin 1 — Agentic AI Copilot: 53 intents, 43 Pydantic-typed tool handlers, stage-and-confirm safety pattern (every write requires user approval), 52 pytest cases parametrized to 400+ invocations, zero LLM-hallucination incidents in pilot with 15 reseller tenants / 25+ enterprise customers / 100+ daily portal users. Stack: FastAPI, Python, Qdrant per-tenant collections, Claude / GPT-4 function-calling, PostgreSQL with row-level security, 8-role RBAC.
- Plugin 2 — Custom Reports & Dashboards: full-stack self-serve analytics product built end-to-end alone over the same enterprise customer data. React + Vite frontend, Node.js + Express backend, SQL Server with stored procedures. Hardened via stored-procedure CRUD contracts, two-layer filter validation, runtime tenant-clause injection, JWT + per-session CSRF, strict CSP, AES-256-CBC encryption.
- Plugin 3 — Carrier API Gateway (BFF): Node.js + Express, OAuth + per-request PoP token generation, sole integration layer to T-Mobile carrier APIs.
- RAG capstone (UW-Madison, Jan-May 2025): 22K+ documents, 300K+ embeddings, hybrid retrieval (BM25 + TF-IDF) with semantic re-ranking, 73% QA accuracy, 40% query-latency reduction. Stack: TypeScript, TimescaleDB, Docker, S3, OpenAI APIs. Led Agile delivery of 25+ production features.
- Orahi internship (Jul-Aug 2024): K-means clustering algorithm for dynamic bus route adjustment, 80% reduction in manual student-assignment effort. Flask REST APIs for telemetry ingestion.
- GSPANN internship (Jun-Aug 2023): CNN-based pneumonia detection on chest X-rays; iterated on preprocessing and data augmentation to improve generalization.
- Core skills: Python, TypeScript, JavaScript, FastAPI, Node.js, Express, React, Anthropic Claude, OpenAI APIs, tool calling, RAG, Qdrant, Pydantic, PostgreSQL, SQL, Docker, AWS S3, PyTorch, JWT/OAuth, RBAC, streaming/SSE.
`.trim();
```

Export it alongside the other exports at the bottom of the file:

```js
module.exports = {
  RESUME_BASE_JSON,
  CANDIDATE_FACTS,
  renderResumeText,
  ADJACENCY_MAP,
  applyAdjacency,
  extractUserSkills,
};
```

### File: `routes/ai.js`

Import `CANDIDATE_FACTS` at the top of the file (alongside the existing `RESUME_BASE_JSON` import):

```js
const { RESUME_BASE_JSON, CANDIDATE_FACTS } = require('./resumeContent');
```

Then replace the inline `CANDIDATE (use ONLY these facts...)` block in BOTH prompts with the imported constant.

**Cover letter prompt (around line 414):**

Current pattern:
```js
const coverPrompt = `Write a cover letter for Sahil Mehta applying to ${job.title} at ${job.company}.

CANDIDATE (use ONLY these facts — do not invent):
- CS + Data Science grad, UW-Madison, May 2025
- ~1 year full-time SWE at Enidus USA LLC: Node.js BFF for T-Mobile carrier APIs...
- RAG capstone: 22K+ docs, 300K+ embeddings, 73% QA accuracy, 40% latency reduction
- Orahi internship: dynamic route algo (80% manual effort reduction), Flask REST APIs
- Core skills: ${job.tags.join(', ')}, Node.js, TypeScript, Python, PostgreSQL, AWS S3, PyTorch, Apache Spark

TARGET: ${job.title} at ${job.company}
...`;
```

New pattern:
```js
const coverPrompt = `Write a cover letter for Sahil Mehta applying to ${job.title} at ${job.company}.

Current date: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}.

CANDIDATE FACTS (use ONLY these — do not invent):
${CANDIDATE_FACTS}

JD-specific tech tags from this listing: ${job.tags.join(', ')}.

TARGET: ${job.title} at ${job.company}
...`;
```

Keep the rest of the prompt (TONE: Confident & direct, banned phrases, RULES block) UNCHANGED EXCEPT for one addition described in Fix 1c below.

**Q&A prompt (around line 456):**

Same pattern — replace the inline CANDIDATE FACTS block with the imported constant. The Q&A prompt has slightly different structure but the replacement is identical: swap the inline list for `${CANDIDATE_FACTS}`.

Keep the `${defaultQs.map(...)}` and rules sections UNCHANGED EXCEPT for the same addition described in Fix 1c below.

### Fix 1c — Domain-aware surfacing in cover letter + Q&A prompts

Both the cover letter prompt and the Q&A prompt should add a domain-awareness rule that tells the LLM to surface the candidate's regulated-enterprise-data experience when the JD is in a domain where that's a differentiator.

In the cover letter prompt's RULES block (the one with the banned-phrase list and "3 tight paragraphs" rule), add this rule as a new bullet:

```
- If the TARGET company is in a regulated-enterprise domain (financial services, banking, telecom, healthcare, insurance, government, fintech, regtech, compliance tech), explicitly highlight in one body paragraph that the candidate has shipped production AI against regulated enterprise data (T-Mobile billing accounts, device identifiers, line state transitions, multi-tenant reseller hierarchies, audit-traceable state-mutating operations). This is a 0-3yr engineer differentiator — most candidates at this level have only touched toy datasets. Do NOT include this paragraph if the TARGET is a pure AI-research shop or general-purpose tooling company where regulated-data experience isn't load-bearing.
```

In the Q&A prompt's RULES block, add this rule similarly:

```
- For questions about your background or fit, if the company is in a regulated-enterprise domain (financial services, telecom, healthcare, insurance, government, fintech), explicitly note the candidate's production experience with regulated enterprise data — billing data, customer identifiers, audit-traceable transactions, multi-tenant reseller hierarchies. This is rare experience at the 0-3yr level and a real differentiator for these domains.
```

Why this works: rather than ALWAYS surfacing the domain experience (which would dilute it for non-regulated targets like Anthropic / Cursor / general AI startups), the LLM makes the call based on the TARGET company. Amex, Capital One, Stripe, Plaid → domain experience surfaces. Anthropic, Cursor, Sierra → agentic AI specifics lead instead.

### After the swap

Both prompts now pull from the same source. Any future resume change requires editing exactly TWO places: `RESUME_BASE_JSON` (resume rendering) and `CANDIDATE_FACTS` (AI prompts). They live in the same file, so the diff is visible in one place.

**Important:** the `RESUME_BASE_JSON` structure and `CANDIDATE_FACTS` string are intentionally NOT auto-generated from each other. The resume needs concise bullet-style phrasing; the prompts need narrative facts the LLM can quote. They are sibling representations of the same underlying truth, kept in sync by discipline (a comment block at the top of `CANDIDATE_FACTS` calls this out — that's the safeguard).

## Fix 2 — Bundle in the testing-rigor detail to the cover letter prompt

Code's Finding 3 from the last brief flagged that the cover letter prompt's CANDIDATE block had less detail than the Q&A prompt — specifically missing the "8 RBAC roles, 52 pytest cases parametrized to 400+ invocations" specifics. With Fix 1 above, both prompts now share `CANDIDATE_FACTS`, so this concern resolves automatically — the testing rigor detail is in the shared facts and both prompts get it.

Verify after Fix 1 lands: the new `CANDIDATE_FACTS` includes the line `52 pytest cases parametrized to 400+ invocations, zero LLM-hallucination incidents in pilot...`. ✓ Already in the proposed string above.

No separate code change needed for this fix — it's a structural side effect of Fix 1.

## Fix 3 — `.gitignore` cleanup

### File: `.gitignore`

Add a single line to ignore `*.bak` backup files anywhere in the repo. `routes/ai.js.bak` has been sitting untracked for multiple sessions; this stops future ones from appearing in `git status`.

Append at the bottom of `.gitignore`:

```
# Editor / refactor backups
*.bak
```

After saving, run `git status` to confirm `routes/ai.js.bak` is no longer in the untracked-files list. (If it was previously tracked, you'd need `git rm --cached` first — verify it's not tracked first via `git ls-files routes/ai.js.bak`. If that returns the file, run `git rm --cached routes/ai.js.bak` and include in commit 3.)

## Verification before commit

1. `node tests/ai.test.js` — 47 tests pass.
2. Restart `node server.js`. Run the pipeline against any saved job listing (Amex, the most recent one in `data/tracker.json` — Sahil already applied to it). Spot-check the rendered cover letter PDF:
   - Same content shape as before (no regression on facts cited)
   - "graduated May 2025" or similar past-tense (commit `c2a3003` covers this — re-verify nothing regressed)
   - No `[object Object]` (commit `ea8b774` covers this — re-verify)
3. Spot-check the Q&A output for the same job. The shared facts should produce content equivalent to the pre-refactor Q&A.
4. Confirm `git status` shows the `.bak` file gone from untracked list.

## Commit plan (pre-authorized — proceed without re-confirming)

Three commits, in order:

```
resumeContent: extract CANDIDATE_FACTS as single source of truth for AI prompts
ai: consume shared CANDIDATE_FACTS in cover-letter + Q&A prompts
gitignore: ignore *.bak refactor backups
```

For commit 1, include a body explaining the motivation: this is the second time the prompts drifted from the resume (§9.3 in April, and again 2026-05-11). Centralizing here makes the next drift visible in a single-file diff.

For commit 2, body short: replaces duplicated CANDIDATE blocks with the imported constant; no behavior change expected for in-band candidate facts; one-source guarantee for future resume edits.

For commit 3, no body needed.

Push to `origin/main` after all three land:
```bash
git push origin main
```

## What to do AFTER this lands

1. Surface anything you discovered:
   - Facts that were in the prompts but NOT in the resume (would have been overclaims — flag these so Cowork can decide to remove from CANDIDATE_FACTS or add to resume)
   - Any place else in the codebase that hardcodes candidate-fact strings (e.g. README, tests)
2. **Do not** touch the portfolio repo — that's a separate next brief.
3. **Do not** update `HANDOVER.md` — that's a Cowork artifact, separate work.
4. **Do not** start the JSearch ATS fan-out (vetoed) or the resume fork (vetoed).
5. **Do not** add prompt version stamps (low value, skipped per prior decision).

## Operating model reminder

Cowork writes briefs like this. You execute. Sahil is applying in parallel — don't interrupt him mid-flow. Surface findings concisely at the end of your run.

---

End of brief. Read `resumeContent.js` and `ai.js` first, then proceed with Fix 1.
